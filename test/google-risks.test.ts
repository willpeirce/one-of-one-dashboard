import assert from 'node:assert/strict';
import test from 'node:test';
import { googleRisks } from '../src/ad-spend/risks.js';
import { addDays } from '../src/hero-range.js';
import { emptyGoogleFacts } from '../src/google-ads/store.js';
import type { GoogleConversionDay, GoogleFacts, GoogleNetworkSlice } from '../src/google-ads/model.js';
import { defaultSettings } from '../src/settings.js';

const today = '2032-04-20', from = '2032-04-13', yesterday = '2032-04-19';
const at = '2032-04-20T11:00:00Z', campaignId = '9911001';
const settings = () => ({...defaultSettings(), expectedGoogleCampaigns:[{campaignId}],
  googleContentShareMaxPct:2, googleContentSpendFloorGbp:5, googleNoSaleSpendFloorGbp:25,
  googleBreakEvenReturnUk:1.5, googleBreakEvenReturnUs:2});
function facts(): GoogleFacts {
  return {...emptyGoogleFacts('live','9911000'), currency:'GBP',
    campaigns:[{id:campaignId,name:'Invented search UK',status:'ENABLED',channelType:'SEARCH',
      biddingStrategyType:'MAXIMIZE_CONVERSION_VALUE',targetRoas:1.5,budgetMicros:'40000000',targetCountries:['US']}],
    jobs:['campaigns','networks','conversions'].map(kind => ({kind:kind as 'campaigns'|'networks'|'conversions',
      lastAttemptAt:at,lastSuccessAt:at,error:null,failures:0,currency:'GBP',coverage:{from,to:yesterday,basis:'uk'}}))};
}
const network = (overrides: Partial<GoogleNetworkSlice> = {}): GoogleNetworkSlice => ({campaignId,day:yesterday,
  network:'CONTENT',spendMicros:'5000000',conversionValueMicros:'25000000',conversions:1,...overrides});
const conversion = (overrides: Partial<GoogleConversionDay> = {}): GoogleConversionDay => ({campaignId,day:yesterday,
  spendMicros:'40000000',conversionValueMicros:'40000000',conversions:0,...overrides});
const newFlags = (value: GoogleFacts, configured = settings()) => googleRisks(value,configured,today)
  .filter(need => /^(?:google-content-share|google-nosale:|google-under:)/.test(need.id));

test('content share uses a strict percentage bar and inclusive content spend floor, with both shares and the largest campaign', () => {
  const value = facts();
  value.campaigns.push({...value.campaigns[0]!,id:'9911002',name:'Invented content US',targetCountries:['US']});
  value.networks = [network({campaignId:'9911002'}),network({network:'SEARCH',spendMicros:'195000000'})];
  const flagged = newFlags(value).find(need => need.id === 'google-content-share')!;
  assert.ok(flagged);
  assert.deepEqual(flagged.figure,{value:'2.50%',label:'Display / content · last complete UK day'});
  assert.match(flagged.why,/Invented content US had the most content spend/);
  assert.match(flagged.why,/last complete UK day 2032-04-19: 2\.50%/);
  assert.match(flagged.why,/7 complete UK days 2032-04-13–2032-04-19: 2\.50%/);
  assert.equal(flagged.googleFlag?.kind,'content-share');
  assert.equal(flagged.googleFlag?.measure?.value,2.5);
  assert.equal(flagged.googleFlag?.measure?.bar,2);
  assert.match(flagged.googleFlag!.sourceLine,/2032-04-20T11:00:00Z/);
  assert.equal(newFlags(value,{...settings(),googleContentShareMaxPct:2.5}).length,0,'exactly at the share bar stays quiet');
  assert.equal(newFlags(value,{...settings(),googleContentShareMaxPct:100}).length,0);
  value.networks[0]!.spendMicros='4999999';
  assert.equal(newFlags(value).length,0,'one micro below the content spend floor stays quiet');
  value.networks[0]!.spendMicros='5000000';
  assert.equal(newFlags(value).length,1,'exactly at the spend floor can warn');
});

test('content share judges each covered complete UK window and chooses its strongest qualifying share', () => {
  const value=facts();
  value.networks=[network({day:from,spendMicros:'10000000'}),network({day:from,network:'SEARCH',spendMicros:'90000000'}),
    network({network:'SEARCH',spendMicros:'100000000'}),network({day:today,spendMicros:'900000000'}),
    network({day:addDays(from,-1),spendMicros:'800000000'})];
  let flagged=newFlags(value)[0]!;
  assert.deepEqual(flagged.figure,{value:'5.00%',label:'Display / content · 7 complete UK days'});
  assert.match(flagged.why,/2032-04-19: 0\.00%/);
  assert.match(flagged.why,/Invented search UK had the most content spend/);
  value.jobs.find(job=>job.kind==='networks')!.coverage!.from=yesterday;
  assert.equal(newFlags(value).length,0,'uncovered earlier content cannot raise the weekly check');
  value.networks.push(network({spendMicros:'5000000'}));
  flagged=newFlags(value)[0]!;
  assert.match(flagged.figure!.label,/last complete UK day/);
  assert.match(flagged.why,/7 complete UK days .*unknown · coverage incomplete/);
  value.jobs.find(job=>job.kind==='networks')!.coverage!.to=addDays(yesterday,-1);
  assert.equal(newFlags(value).length,0,'without yesterday neither window is judged');
});

test('only CONTENT contributes to the content-share numerator; unknown and YouTube spend stay in the account total', () => {
  const value=facts();
  value.networks=['YOUTUBE_WATCH','YOUTUBE_SEARCH','MIXED','INVENTED_NETWORK','SEARCH_PARTNERS'].map(kind=>network({network:kind}));
  assert.equal(newFlags(value).length,0);
  value.networks.push(network({spendMicros:'5000000'}));
  assert.ok(newFlags(value).some(need=>need.id==='google-content-share'));
  assert.ok(Math.abs(newFlags(value)[0]!.googleFlag!.measure!.value-100/6)<0.000001);
  value.networks=[];
  assert.equal(newFlags(value,{...settings(),googleContentSpendFloorGbp:0,googleContentShareMaxPct:0}).length,0);
});

test('no-sale uses an inclusive spend floor and fewer than 0.01 conversions over seven complete UK days', () => {
  const value=facts(), configured={...settings(),googleBreakEvenReturnUk:0};
  value.conversions=[conversion({spendMicros:'25000000',conversions:0.009})];
  let flagged=newFlags(value,configured)[0]!;
  assert.equal(flagged.id,`google-nosale:${campaignId}`);
  assert.match(flagged.why,/0\.009 Google conversions/);
  assert.equal(flagged.googleFlag!.measure!.value,25);
  assert.equal(flagged.googleFlag!.measure!.bar,25);
  assert.equal(flagged.figure!.value,'£25.00');
  value.conversions[0]!.spendMicros='24999999';
  assert.equal(newFlags(value,configured).length,0);
  value.conversions[0]!.spendMicros='25000000'; value.conversions[0]!.conversions=0.01;
  assert.equal(newFlags(value,configured).length,0,'exactly 0.01 is a conversion');
  value.conversions=[conversion({spendMicros:'25000000',conversions:0.009}),conversion({day:from,spendMicros:'0',conversions:0.001})];
  assert.equal(newFlags(value,configured).length,0,'decimal fractions summing to 0.01 are not no-sale');
  value.conversions=[conversion({spendMicros:'25000000'}),conversion({day:today,conversions:20}),conversion({day:addDays(from,-1),conversions:20})];
  assert.equal(newFlags(value,configured)[0]!.id,`google-nosale:${campaignId}`,'today and earlier days do not mask a complete-window flag');
  assert.equal(newFlags(value,{...configured,googleNoSaleSpendFloorGbp:100}).length,0);
  value.conversions=[conversion({spendMicros:'0'})];
  assert.equal(newFlags(value,{...configured,googleNoSaleSpendFloorGbp:0}).length,0,'zero spend is not junk even when the floor is zero');
});

test('under break-even uses campaign-day return, its market bar, an inclusive spend floor and a strict return comparison', () => {
  const value=facts(), configured={...settings(),googleNoSaleSpendFloorGbp:100};
  value.conversions=[conversion({conversionValueMicros:'59999999',conversions:1})];
  let flagged=newFlags(value,configured)[0]!;
  assert.equal(flagged.id,`google-under:${campaignId}`);
  assert.equal(flagged.googleFlag!.measure!.bar,1.5,'the capital UK name wins over US country targeting');
  assert.match(flagged.why,/£40\.00 spent/);
  value.conversions[0]!.conversionValueMicros='60000000';
  assert.equal(newFlags(value,configured).length,0,'exact break-even is not under');
  value.conversions[0]!.spendMicros='39999999'; value.conversions[0]!.conversionValueMicros='0';
  assert.equal(newFlags(value,configured).length,0,'one micro below the shared spend floor is quiet');
  value.conversions[0]!.spendMicros='40000000';
  assert.equal(newFlags(value,configured).length,1);
  assert.equal(newFlags(value,{...configured,googleBreakEvenReturnUk:0}).length,0,'zero switches this market off');
  value.campaigns[0]!.name='Invented search US';
  flagged=newFlags(value,configured)[0]!;
  assert.equal(flagged.googleFlag!.measure!.bar,2);
  assert.match(flagged.why,/ · US:/);
  value.campaigns[0]!.name='Invented neutral'; value.campaigns[0]!.targetCountries=['GB','US'];
  assert.equal(newFlags(value,configured).length,0,'ambiguous market is skipped');
  value.campaigns=[];
  assert.equal(newFlags(value,configured).length,0,'a missing campaign cannot supply its market');
});

test('new Google observations require their own GBP complete coverage and never enter sample mode', () => {
  const value=facts();
  value.networks=[network()];value.conversions=[conversion()];
  assert.deepEqual(newFlags(value).map(need=>need.googleFlag!.kind),['content-share','nosale','under']);
  assert.deepEqual(newFlags({...value,mode:'sample'}),[]);
  for (const kind of ['networks','conversions'] as const) {
    const affected=kind==='networks'?['content-share']:['nosale','under'];
    for (const change of [
      {coverage:null}, {lastSuccessAt:null}, {currency:'USD'},
      {coverage:{from,to:addDays(yesterday,-1),basis:'uk' as const}},
    ]) {
      const missing=structuredClone(value);Object.assign(missing.jobs.find(job=>job.kind===kind)!,change);
      assert.ok(newFlags(missing).every(need=>!affected.includes(need.googleFlag!.kind)),`${kind}: incomplete input raises no flag`);
    }
  }
  const missingWeek=structuredClone(value);
  missingWeek.jobs.find(job=>job.kind==='conversions')!.coverage!.from=addDays(from,1);
  assert.ok(newFlags(missingWeek).every(need=>need.googleFlag!.kind==='content-share'));
  const retained=structuredClone(value);
  googleRisks(value,settings(),today);
  assert.deepEqual(value,retained,'risk calculations do not mutate stored facts');
});

test('existing Google needs carry structured rule and source details alongside their unchanged Home figures', () => {
  const value=facts();
  value.networks=[network({network:'SEARCH',spendMicros:'40000000',conversionValueMicros:'40000000'})];
  value.campaigns[0]!.channelType='PERFORMANCE_MAX'; value.campaigns[0]!.targetRoas=null;
  const configured=settings();
  const needs=googleRisks(value,configured,today);
  assert.equal(needs.find(need=>need.id===`google-bidding:${campaignId}`)!.googleFlag!.kind,'bidding');
  const networkNeed=needs.find(need=>need.id===`google-network:${campaignId}:SEARCH`)!;
  assert.deepEqual(networkNeed.figure,{value:'1.00×',label:'Google ROAS · 7 days'});
  assert.equal(networkNeed.googleFlag!.measure!.value,1);
  assert.equal(networkNeed.googleFlag!.measure!.bar,configured.googleNetworkRoasFloor);
  assert.equal(googleRisks(value,{...configured,expectedGoogleCampaigns:[{campaignId:'9911009'}]},today)
    .find(need=>need.id===`google-unexpected:${campaignId}`)!.googleFlag!.kind,'unexpected');
  assert.equal(googleRisks(value,{...configured,expectedGoogleCampaigns:[]},today)
    .find(need=>need.id==='google-expected-list')!.googleFlag!.kind,'expected-list');
  for (const need of needs) {
    assert.equal(need.state,'warn');assert.equal(need.source,'google-ads');assert.equal(need.link,'/settings');
    assert.ok(need.googleFlag!.rule);assert.match(need.googleFlag!.sourceLine,/Google Ads/);
  }
});
