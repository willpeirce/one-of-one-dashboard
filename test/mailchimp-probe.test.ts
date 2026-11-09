import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { appConfig } from '../src/config.js';
import { MAILCHIMP_API_VERSION, MailchimpClient, MailchimpReadError, type MailchimpReader } from '../src/mailchimp/client.js';
import { runMailchimpProbe } from '../src/mailchimp/probe.js';
import { probeMailchimpCommand } from '../scripts/probe-mailchimp.js';

const campaign = (id = 'invented_campaign_a') => ({id,type:'regular',status:'sent',title:'Invented hidden campaign',subject:'Invented hidden subject',sentAt:'2026-11-06T12:00:00Z'});
const read = <T>(data: T, fieldNames: string[]) => ({data,fieldNames,requestId:'invented-private-request-id'});
function fakeReader(calls: string[] = []): MailchimpReader {
  return {
    campaigns: async()=>{calls.push('campaigns');return read([campaign()],['campaigns.id','campaigns.settings.subject_line']);},
    campaign: async id=>{calls.push(`campaign:${id}`);return read(campaign(id),['id','settings.subject_line']);},
    report: async id=>{calls.push(`report:${id}`);return read({id,emailsSent:23,orders:4,revenueUsd:170,currency:'USD'},['id','ecommerce.total_revenue']);},
    orders: async id=>{calls.push(`orders:${id}`);return read([{id:'invented_private_order',campaignId:id,total:27,currency:'GBP',date:'2026-11-06T13:00:00Z'}],['orders.id','orders.order_total']);},
    audience: async()=>{calls.push('audience');return read({id:'invented_private_list',contacts:44,subscribers:40,unsubscribed:3,cleaned:1},['id','stats.total_contacts']);},
  };
}

test('probe reads each endpoint independently and prints only generic endpoints, schema paths and coverage',async()=>{
  const lines:string[]=[],calls:string[]=[];
  const result=await runMailchimpProbe(fakeReader(calls),{line:line=>lines.push(line)});
  assert.deepEqual(calls,['campaigns','report:invented_campaign_a','campaign:invented_campaign_a','orders:invented_campaign_a','audience']);
  assert.equal(result.complete,true);assert.equal(result.flowCoverage,'unknown');
  assert.equal(result.checks.length,5);
  for(const path of ['/campaigns','/reports/{id}','/campaigns/{id}','/ecommerce/orders?campaign_id={id}','/lists/{id}'])
    assert.ok(lines.some(line=>line.startsWith(`GET /${MAILCHIMP_API_VERSION}${path}: answered; fields:`)));
  assert.doesNotMatch(JSON.stringify(result)+lines.join('\n'),/invented_campaign_a|Invented hidden|invented_private|private-request|170|GBP|USD/);
  assert.match(lines.at(-1)!,/Flow email coverage: unknown/);
});

test('empty campaign listing skips campaign endpoints, still probes audience, and never treats a configured flow id as a campaign',async()=>{
  const calls:string[]=[],reader=fakeReader(calls),lines:string[]=[];
  reader.campaigns=async()=>{calls.push('campaigns');return read([],['campaigns','total_items']);};
  const result=await runMailchimpProbe(reader,{line:line=>lines.push(line)});
  assert.deepEqual(calls,['campaigns','audience']);
  assert.equal(result.checks.filter(check=>check.state==='skipped').length,3);
  assert.equal(result.complete,false);assert.equal(result.flowCoverage,'unknown');
  assert.match(lines.join('\n'),/no campaign id was available/);
});

test('failed campaign listing does not block explicit campaigns, failed report does not block details, orders or audience',async()=>{
  const calls:string[]=[],reader=fakeReader(calls),lines:string[]=[],secret=randomBytes(24).toString('hex');
  reader.campaigns=async()=>{calls.push('campaigns');throw new Error(`invented upstream body ${secret}`);};
  reader.report=async id=>{calls.push(`report:${id}`);const error=new MailchimpReadError('http',503);error.message=`invented upstream body ${secret}`;throw error;};
  const result=await runMailchimpProbe(reader,{campaignIds:['invented_explicit'],line:line=>lines.push(line)});
  assert.deepEqual(calls,['campaigns','report:invented_explicit','campaign:invented_explicit','orders:invented_explicit','audience']);
  assert.equal(result.complete,false);assert.equal(result.checks.filter(check=>check.state==='answered').length,3);
  assert.ok(!lines.join('\n').includes(secret));assert.doesNotMatch(lines.join('\n'),/invented upstream|invented_explicit/);
  assert.match(lines.join('\n'),/failed \(http 503\)/);
});

test('probe bounds API-discovered campaign checks, removes duplicate ids and never claims flow coverage from campaign success',async()=>{
  const calls:string[]=[],reader=fakeReader(calls);
  reader.campaigns=async()=>read(Array.from({length:8},(_,index)=>campaign(`invented_${index}`)),['campaigns.id']);
  const result=await runMailchimpProbe(reader);
  assert.equal(calls.filter(call=>call.startsWith('report:')).length,3);
  assert.equal(result.flowCoverage,'unknown');
  calls.length=0;
  await runMailchimpProbe(reader,{campaignIds:['invented_explicit','invented_explicit']});
  assert.equal(calls.filter(call=>call.startsWith('report:')).length,1);
});

test('rate-limit deferment and malformed schema paths are reported safely without response values',async()=>{
  const reader=fakeReader(),lines:string[]=[],secret=randomBytes(24).toString('hex');
  reader.report=async()=>{throw new MailchimpReadError('rate_limit',429,Date.parse('2026-11-09T12:00:00Z'));};
  reader.audience=async()=>read({id:secret,contacts:10,subscribers:8,unsubscribed:1,cleaned:1},['stats.total_contacts',`\n${secret}`,'https://invented.invalid/private','stats.total_contacts','orders[].id']);
  const result=await runMailchimpProbe(reader,{line:line=>lines.push(line)});
  assert.equal(result.checks.find(check=>check.endpoint.includes('/reports/'))?.state,'deferred');
  assert.match(lines.join('\n'),/next permitted attempt 2026-11-09T12:00:00.000Z/);
  assert.deepEqual(result.checks.at(-1)?.fieldNames,['orders[].id','stats.total_contacts']);
  assert.ok(!lines.join('\n').includes(secret));assert.doesNotMatch(lines.join('\n'),/invented.invalid/);
});

test('probe command never instantiates a client without a key and rejects unknown or excessive arguments without echoing values',async()=>{
  const lines:string[]=[],factory=()=>{throw new Error('unexpected client construction');};
  assert.equal(await probeMailchimpCommand([],{},line=>lines.push(line),factory),0);
  assert.match(lines[0]!,/waiting for MAILCHIMP_API_KEY; no requests made/);
  const privateArg=randomBytes(24).toString('hex');
  assert.equal(await probeMailchimpCommand(['--unexpected',privateArg],{},line=>lines.push(line),factory),2);
  assert.ok(!lines.join('\n').includes(privateArg));
  assert.equal(await probeMailchimpCommand(['--campaign','a','--campaign','b','--campaign','c','--campaign','d'],{},()=>{},factory),2);
  assert.equal(await probeMailchimpCommand(['--help'],{},()=>{},factory),0);
});

test('probe command passes the environment key only to the client and returns failure when an endpoint cannot answer',async()=>{
  const token=randomBytes(24).toString('hex'),lines:string[]=[],reader=fakeReader();
  reader.orders=async()=>{throw new MailchimpReadError('http',404);};
  const exit=await probeMailchimpCommand(['--campaign','invented_explicit'],{MAILCHIMP_API_KEY:token},line=>lines.push(line),received=>{assert.equal(received,token);return reader;});
  assert.equal(exit,1);assert.ok(!lines.join('\n').includes(token));assert.doesNotMatch(lines.join('\n'),/invented_explicit/);
  assert.match(lines.join('\n'),/ecommerce\/orders\?campaign_id=\{id\}: failed \(http 404\)/);
  assert.match(lines.join('\n'),/lists\/\{id\}: answered/);
});


test('fixture probe runs through the real GET-only client with limited ecommerce fields and never emits response values',async()=>{
  const names=['campaigns','campaign','report','orders','audience'] as const;
  const fixtures=Object.fromEntries(await Promise.all(names.map(async name=>[name,JSON.parse(await readFile(new URL(`fixtures/mailchimp/${name}.json`,import.meta.url),'utf8'))])));
  const token=randomBytes(24).toString('hex'),lines:string[]=[],paths:string[]=[];
  const client=new MailchimpClient(token,{sleep:async()=>{},log:()=>{},fetch:async(input,init)=>{
    const url=new URL(String(input));paths.push(url.pathname);
    assert.equal(init?.method,'GET');assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(url.hostname,`${appConfig.mailchimp.server}.api.mailchimp.com`);
    assert.ok(url.searchParams.has('fields'));
    const path=url.pathname.slice(`/${MAILCHIMP_API_VERSION}/`.length);
    const name=path==='campaigns'?'campaigns':path.startsWith('campaigns/')?'campaign':path.startsWith('reports/')?'report':path==='ecommerce/orders'?'orders':'audience';
    if(name==='orders'){
      assert.ok(url.searchParams.has('campaign_id'));
      assert.deepEqual(url.searchParams.get('fields')!.split(',').sort(),['orders.id','orders.campaign_id','orders.order_total','orders.currency_code','orders.processed_at_foreign','total_items'].sort());
    }
    if(name==='audience')assert.equal(path,`lists/${appConfig.mailchimp.listId}`);
    return new Response(JSON.stringify(fixtures[name]),{headers:{'x-request-id':'invented-probe-request'}});
  }});
  const result=await runMailchimpProbe(client,{line:line=>lines.push(line)});
  assert.equal(result.complete,true);assert.equal(result.flowCoverage,'unknown');
  assert.ok(paths.some(path=>path.endsWith('/ecommerce/orders')));
  const output=lines.join('\n');assert.ok(!output.includes(token));assert.ok(!output.includes('invented-probe-request'));
  const campaignRows=fixtures.campaigns.campaigns as {id:string;settings?:{title?:string;subject_line?:string}}[];
  for(const row of campaignRows)for(const value of [row.id,row.settings?.title,row.settings?.subject_line])if(value)assert.ok(!output.includes(value));
  assert.ok(!output.includes(fixtures.audience.id));
});
