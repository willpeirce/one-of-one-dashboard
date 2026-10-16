import assert from 'node:assert/strict';
import test from 'node:test';
import {addDays} from '../src/hero-range.js';
import {defaultSettings} from '../src/settings.js';
import {judgeAdSet,type SetDay,type RuleContext} from '../src/meta-adsets/rules.js';
import type {StoredAdSet} from '../src/meta-adsets/catalogue.js';
const s=()=>defaultSettings();
const set=(extra:Partial<StoredAdSet>={}):StoredAdSet=>({id:'invented-set',campaignId:'invented-campaign',name:'Invented — UK — Fern',status:'ACTIVE',effectiveStatus:'ACTIVE',dailyBudget:2000,lifetimeBudget:null,currency:'GBP',createdTime:'2026-10-09T08:00:00Z',updatedTime:'2026-10-09T08:00:00Z',learningStage:null,lastSignificantEdit:null,market:'uk',firstSeen:'2026-10-09T08:00:00Z',lastSeen:'2026-10-16T08:00:00Z',lastRead:'2026-10-16T08:00:00Z',campaignName:'Invented Fern UK',owner:'ours',...extra});
const days=(extra:Partial<SetDay>={}):SetDay[]=>Array.from({length:7},(_,i)=>({day:addDays('2026-10-09',i),spend:18,purchases:1,addsToCart:2,...extra}));
const judge=(rows: SetDay[],extra:Partial<StoredAdSet>={},settings=s(),context:RuleContext={})=>judgeAdSet(set(extra),rows,settings,'2026-10-16',context)!;
const fires=(rule:string,rows:SetDay[],extra:Partial<StoredAdSet>={},settings=s(),context:RuleContext={})=>judge(rows,extra,settings,context).reasons.some(r=>r.rule===rule);
test('purchase-cost kill needs its inclusive floor and a cost over the bar; unknown is not no purchase',()=>{
 assert.equal(fires('purchase-cost',days({spend:30})),true);
 assert.equal(fires('purchase-cost',days({spend:26})),false);
 assert.equal(fires('purchase-cost',days({spend:5,purchases:0})),false);
 assert.equal(fires('purchase-cost',days({spend:75/7,purchases:0})),true);
 assert.equal(fires('purchase-cost',days({spend:30,purchases:null})),false);
 assert.equal(fires('purchase-cost',days({spend:30}).slice(1)),true);
});
test('ATC kill has a two-full-day minimum, spend floor and strict cost bar',()=>{
 assert.equal(fires('atc-cost',days({spend:20,addsToCart:1})),true);
 assert.equal(fires('atc-cost',days({spend:15,addsToCart:1})),false);
 assert.equal(fires('atc-cost',[{day:'2026-10-15',spend:80,purchases:1,addsToCart:0}],{createdTime:'2026-10-15T08:00:00Z'}),false);
 assert.equal(fires('atc-cost',days({spend:5,addsToCart:0})),false);
});
test('zero day uses half the correct weekday budget and excludes the first day',()=>{
 const d=days();d[6]={...d[6]!,spend:10,addsToCart:0};assert.equal(fires('zero-day',d),true);
 d[6]!.spend=9;assert.equal(fires('zero-day',d),false);
 d[6]!.spend=10;const settings=s();settings.adRules.uk.upliftPercent=20;assert.equal(fires('zero-day',d,{},settings),false);
 assert.equal(fires('zero-day',[{day:'2026-10-15',spend:50,purchases:1,addsToCart:0}],{createdTime:'2026-10-15T08:00:00Z'}),false);
});
test('first-day pattern uses complete life totals with three full days and positive first-day ATCs',()=>{
 const d=days({addsToCart:0});d[0]!.addsToCart=3;assert.equal(fires('first-day-pattern',d),true);
 d[2]!.addsToCart=1;assert.equal(fires('first-day-pattern',d),false);
 assert.equal(fires('first-day-pattern',days({addsToCart:0})),false);
 assert.equal(fires('first-day-pattern',d.slice(0,2)),false);
});
test('name kill requires both thresholds and complete life data, case insensitively',()=>{
 const named={name:'Invented UK KILL at 14 ATC / 7 purch'};
 assert.equal(fires('name-line',days(),named),true);
 assert.equal(fires('name-line',days({purchases:0}),named),false);
 assert.equal(fires('name-line',days().slice(1),named),false);
 assert.equal(fires('name-line',days(),{name:'Invented UK kill at 14 ATC'}),false);
});
test('slipping is a lower-priority verdict with a three-day floor and strict multiplier',()=>{
 const settings=s();settings.adRules.killFloorGbp=1000;
 assert.equal(judge(days({spend:40}),{},settings).verdict,'Slipping');
 assert.equal(fires('slipping',days({spend:30}),{},settings),false);
 assert.equal(fires('slipping',days({spend:29,purchases:0}),{},settings),false);
 assert.equal(fires('slipping',days({spend:30,purchases:0}),{},settings),true);
});
test('step uses two clean full days, nearest 50p, 20/30 percent and blocks changes or spike dates',()=>{
 let v=judge(days(),{dailyBudget:2130});assert.equal(v.verdict,'Step');assert.equal(v.proposedBase,25.5);assert.equal(v.stepPercent,20);
 v=judge(days({spend:16}),{dailyBudget:2000});assert.equal(v.proposedBase,26);assert.equal(v.stepPercent,30);
 assert.equal(fires('two-clean-days',days(),{updatedTime:'2026-10-14T23:30:00Z'}),false,'UK date is 15 Oct');
 assert.equal(fires('two-clean-days',days(),{},s(),{changes:['2026-10-14T08:00:00Z']}),false);
 assert.equal(fires('two-clean-days',days(),{lastSignificantEdit:'2026-10-15T08:00:00Z'}),false);
 assert.equal(fires('two-clean-days',days(),{market:'us'}),false,'15th in prior two days is a US spike');
 const shifted=days().map(r=>({...r,day:addDays(r.day,8)}));
 assert.equal(judgeAdSet(set(),shifted,s(),'2026-10-24')!.reasons.some(r=>r.rule==='two-clean-days'),false,'today spike');
 assert.equal(judgeAdSet(set(),shifted,s(),'2026-10-26')!.includesSpikeDays,true);
});
test('delivery flags observed review age, under-half delivery and learning duration',()=>{
 assert.equal(fires('ad-review',days(),{},s(),{ads:[{effectiveStatus:'PENDING_REVIEW',statusSince:'2026-10-13T08:00:00Z'}]}),true);
 assert.equal(fires('ad-review',days(),{},s(),{ads:[{effectiveStatus:'PENDING_REVIEW',statusSince:'2026-10-15T08:00:00Z'}]}),false);
 assert.equal(fires('under-budget',days({spend:9})),true);assert.equal(fires('under-budget',days({spend:10})),false);
 assert.equal(fires('learning',days(),{learningStage:'LEARNING_LIMITED'}),true);
 assert.equal(fires('learning',days(),{learningStage:'LEARNING',createdTime:'2026-10-08T08:00:00Z'}),true);
 assert.equal(fires('learning',days(),{learningStage:'LEARNING'}),false);
});
test('test-share uses our market denominator, cap and strictly younger than 14 days',()=>{
 const settings=s();settings.metaOwners=[{campaignId:'invented-campaign',owner:'ours',test:true}];
 assert.equal(fires('test-share',days(),{},settings,{ourMarketSpendYesterday:60}),true);
 assert.equal(fires('test-share',days(),{},settings,{ourMarketSpendYesterday:72}),false);
 assert.equal(fires('test-share',days(),{createdTime:'2026-10-02T08:00:00Z'},settings,{ourMarketSpendYesterday:60}),false);
});
test('clean verdict, all firing reasons ordered, freelancer/unassigned/inactive excluded',()=>{
 const d=days({spend:21});assert.equal(judge(d).verdict,'Clear');
 const v=judge(days({spend:40,addsToCart:0}),{learningStage:'LEARNING_LIMITED'});assert.equal(v.verdict,'Kill');assert.ok(v.reasons.length>=4);
 for(const owner of ['freelancer','unassigned'] as const)assert.equal(judgeAdSet(set({owner}),d,s(),'2026-10-16'),null);
 assert.equal(judgeAdSet(set({effectiveStatus:'PAUSED'}),d,s(),'2026-10-16'),null);
});

test('short rule windows do not wait for older missing history',()=>{
 const recent=days({spend:40}).slice(-3);assert.equal(fires('slipping',recent),true);assert.equal(fires('purchase-cost',recent),true);
 const clean=days({spend:16}).slice(-2);const v=judge(clean);assert.equal(v.verdict,'Step');assert.equal(v.stepPercent,20);
 const yesterday=days({spend:20,addsToCart:0}).slice(-1);assert.equal(fires('zero-day',yesterday),false);
});

test('Step takes precedence over Delivery when both fire, independently of Home card ordering',()=>{
 const v=judge(days({spend:16}),{dailyBudget:10000});
 assert.equal(v.verdict,'Step');assert.deepEqual(v.reasons.map(r=>r.verdict),['Step','Delivery']);
});

test('partial action windows judge matching spend after two complete days and name missing dates',()=>{
 const data=days({spend:40,purchases:null,addsToCart:null});
 for(const i of [0,1,3,4])data[i]={...data[i]!,purchases:1,addsToCart:3};
 const v=judge(data);assert.equal(v.verdict,'Kill');assert.equal(v.spend,160);assert.equal(v.cpp,40);
 assert.match(v.reason,/no action data for 3 of 7 days \(2026-10-11, 2026-10-14, 2026-10-15\)/);
 assert.equal(fires('purchase-cost',[data[0]!]),false);
});
