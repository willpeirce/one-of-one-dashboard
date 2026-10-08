import { appConfig } from '../src/config.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import { parseExport, columns, ImportError, type ParcelRow } from '../src/fulfilment/parser.js';
import { actualPence, knownService, despatchDay, emptyModel, estimateOrder, learn, leaveOneOutModels, gbpMinor, normaliseService, leastSquares, mixKey, parcelFlags, quantities, warehouseFor, monthlyReminder, type Parcel } from '../src/fulfilment/model.js';
import { confirmImport, previewImport, readEstimates, readParcels, readUploads, refreshFulfilment, fulfilmentSummary } from '../src/fulfilment/store.js';
import { cleanOrder, type Order } from '../src/shopify/model.js';
import { orderFields } from '../src/shopify/client.js';
import { fixture } from '../src/shopify/sample.js';
import { ShopifyStore } from '../src/shopify/store.js';
import { defaultSettings, readSettings, validateSettings } from '../src/settings.js';
import { createTestDatabase } from './helpers/database.js';
import { createApp } from '../src/app.js';
import { readRuntime } from '../src/runtime.js';
const now=new Date('2026-09-30T12:00:00Z');
const settings={...defaultSettings(),flatFulfilmentUkGbp:5,flatFulfilmentUsGbp:8};
const csv=(overrides:Partial<Record<(typeof columns)[number],string>>={})=>columns.join(',')+'\n'+columns.map(c=>({...{'Despatched':'2026-09-30 14:00:00','Reference':'990001','Boxed Weight':'1.388 kg','Postage Method':'Royal Mail Tracked 48','Postage Charge':'3.20','Line Total':'4.8051','Fulfilment Centre':'Northampton 2','Carrier':'Royal Mail','Country':'GB','Customer Postage Cost':'2.00'},...overrides})[c]).join(',');
async function order(number='990001',us=false):Promise<Order> {
  const o=cleanOrder((await fixture('order')).data.order) as Order;
  return {...o,id:'gid://shopify/Order/'+number,orderNumber:number,country:us?'US':'GB',market:us?'US':'UK',region:us?'OH':'ENG',fulfillments:[],lines:[{...o.lines[0]!,sku:'sample-a',quantity:1}]};
}
const parcel=(row:ParcelRow,orderId:string|null):Parcel=>({...row,id:'sample',orderId,gbpPerUsd:0.754,uploadId:'sample',replacedEstimatePence:null,rateBaselinePence:null,flags:[]});
async function fits() {
  const f=JSON.parse(await readFile(new URL('fixtures/fulfilment/fits.json',import.meta.url),'utf8')) as {warehouse:'uk'|'us';a:number;b:number;grams:number;pickPack:number}[];
  const orders:Order[]=[],parcels:Parcel[]=[];
  for(const [i,r] of f.entries()) {
    const o=await order(String(991000+i),r.warehouse==='us');
    o.lines=[...r.a?[{...o.lines[0]!,sku:'sample-a',quantity:r.a}]:[],...r.b?[{...o.lines[0]!,id:'gid://shopify/LineItem/991999',sku:'sample-b',quantity:r.b}]:[]];
    orders.push(o);const p=parcel(parseExport(csv())[0]!,o.id);
    Object.assign(p,{id:String(i),orderNumber:o.orderNumber,warehouse:r.warehouse,currency:r.warehouse==='uk'?'GBP':'USD',service:r.warehouse==='uk'?'Royal Mail Tracked 48':'Ground Advantage',country:o.country,boxedGrams:r.grams,pickPackMinor:r.pickPack,postageMinor:r.warehouse==='uk'?320:r.grams<=500?600:800});parcels.push(p);
  }
  return {orders,parcels};
}

test('ExportOrders parser handles blank first lines, BOM, quoted cells, kg/g, four decimal totals and drops unknown columns at read',()=>{
  const basic=csv(), lines=basic.split('\n');
  const p=parseExport('\n\uFEFF'+lines[0]+',Dropped Column\r\n'+lines[1]+',"invented,discard-me"\r\n\r\n')[0]!;
  assert.equal(p.boxedGrams,1388);assert.equal(p.postageMinor,320);assert.equal(p.pickPackMinor,161);assert.equal(p.customerPaidPence,200);
  assert.ok(!JSON.stringify(p).includes('discard-me'));assert.equal(Object.keys(p).length,12);
  assert.equal(parseExport(csv({'Boxed Weight':'74 g'}))[0]!.boxedGrams,74);
  const us=parseExport(csv({'Fulfilment Centre':'Columbus','Postage Method':'Ground Advantage'}))[0]!;
  assert.equal(despatchDay({...us, despatchedAt:'2026-09-30 23:00:00'}),'2026-10-01');
  assert.equal(despatchDay({...us, despatchedAt:'2026-10-31 23:00:00'}),'2026-11-01');
  assert.equal(us.currency,'USD');assert.equal(us.customerPaidPence,200);
  assert.equal(parseExport(csv({'Fulfilment Centre':'Invented Centre'}))[0]!.currency,null);
  for(const bad of ['2026-02-30 12:00:00','2026-09-30 25:00:00'])assert.throws(()=>parseExport(csv({'Despatched':bad})),ImportError);
  assert.throws(()=>parseExport(csv({'Line Total':'2.0000'})),ImportError);
  assert.throws(()=>parseExport(basic.replace('Reference','Missing')),ImportError);
});

test('order numbers use Shopify name digits; warehouse uses fulfilment first, crown dependencies and unknown destinations',async()=>{
  assert.match(orderFields(true),/\bid name createdAt/);
  const raw=(await fixture('order')).data.order;raw.name='#00990001';assert.equal(cleanOrder(raw).orderNumber,'990001');raw.name='invalid';assert.equal(cleanOrder(raw).orderNumber,null);
  const o=await order();for(const country of ['GB','JE','GG','IM'])assert.equal(warehouseFor({...o,country}),'uk');
  assert.equal(warehouseFor({...o,country:'US'}),'us');assert.equal(warehouseFor({...o,country:'FR'}),'unknown');
  assert.equal(warehouseFor({...o,fulfillmentStatus:'FULFILLED',fulfillments:[]}),'unknown');
  assert.equal(warehouseFor({...o,fulfillments:[{id:'sample',status:'SUCCESS',createdAt:now.toISOString(),updatedAt:now.toISOString(),locationId:'gid://shopify/Location/106790781262',lines:[]}]}),'us');
});

test('fixture fits base plus per-item ladder and independent per-SKU boxed weights with sorted aggregated mixes',async()=>{
  const {orders,parcels}=await fits(),m=learn(parcels,orders);
  for(const w of ['uk','us'] as const) {
    assert.ok(Math.abs(m.warehouses[w]!.ladder.base-100)<1e-6);assert.ok(Math.abs(m.warehouses[w]!.ladder.coefficients.items!-30)<1e-6);
    assert.ok(Math.abs(m.warehouses[w]!.weight.base-.2)<1e-6);assert.ok(Math.abs(m.warehouses[w]!.weight.coefficients['sample-a']!-.1)<1e-6);assert.ok(Math.abs(m.warehouses[w]!.weight.coefficients['sample-b']!-.15)<1e-6);
  }
  const repeated={...orders[0]!,lines:[...orders[0]!.lines,...orders[0]!.lines]};assert.equal(quantities(repeated)!['sample-a'],2);
  assert.equal(mixKey({b:2,a:1}),mixKey({a:1,b:2}));
  const singular=leastSquares([{x:{items:1},y:130},{x:{items:1},y:130}]);assert.equal(singular.base,130);assert.equal(singular.coefficients.items,0);
});

test('source selection actual, exact, ladder, flat, unknown, and US weight-band/state selection',async()=>{
  const {orders,parcels}=await fits(),m=learn(parcels,orders),o=orders[0]!;
  assert.equal(estimateOrder(o,parcels,m,settings).source,'actual');
  assert.equal(estimateOrder({...o,id:'new'},[],m,settings).source,'exact');
  const ladder=estimateOrder({...o,id:'new',lines:[{...o.lines[0]!,quantity:3}]},[],m,settings);assert.equal(ladder.source,'ladder');assert.equal(ladder.costPence,510);assert.equal(ladder.guess,true);
  assert.equal(estimateOrder(o,[],emptyModel(),settings).source,'flat');assert.equal(estimateOrder(o,[],emptyModel(),defaultSettings()).source,'unknown');
  assert.equal(estimateOrder({...o,country:'FR'},[],m,settings).source,'unknown');
  const us=orders[4]!;assert.equal(estimateOrder({...us,id:'new'},[],m,settings).source,'exact');
  const band=estimateOrder({...us,id:'new',region:'CA'},[],m,settings);assert.equal(band.source,'ladder');assert.equal(band.costPence,550);
  assert.equal(estimateOrder({...us,id:'new',region:null},[],m,settings).source,'unknown');
  assert.equal(estimateOrder({...us,id:'new',lines:[{...us.lines[0]!,sku:'unlearned'}]},[],m,settings).source,'unknown');
  const extra={...parcels[0]!,id:'extra',postageMinor:100};assert.equal(estimateOrder(o,[parcels[0]!,extra],m,settings).costPence,680);
});

test('USD actual conversion retains upload rate when current setting changes; GBP is unchanged',async()=>{
  const o=await order('990002',true),p=parcel(parseExport(csv({'Reference':'990002','Fulfilment Centre':'Columbus','Line Total':'10.0000','Postage Charge':'8.00'}))[0]!,o.id);
  p.gbpPerUsd=.8;assert.equal(actualPence(p),800);
  assert.equal(estimateOrder(o,[p],emptyModel(),{...settings,jjGbpPerUsd:.5}).costPence,800);
  assert.equal(actualPence({...p,currency:'GBP'}),1000);assert.equal(actualPence({...p,currency:null}),null);
  assert.equal(validateSettings({...settings,jjGbpPerUsd:.754321}).jjGbpPerUsd,.754321);
  assert.throws(()=>validateSettings({...settings,jjGbpPerUsd:0}));
});

test('each parcel Needs you rule excludes rate checks for unknown services',async()=>{
  const o=await order(),p=parcel(parseExport(csv())[0]!,o.id),m=learn([p],[o]);
  assert.deepEqual(parcelFlags({...p,service:'Invented Service',rateBaselinePence:1,postageMinor:10000,pickPackMinor:10000},o,m),['Unknown service']);
  assert.ok(parcelFlags({...p,warehouse:'us',service:'Ground Advantage'},o,m).includes('Wrong warehouse for destination'));
  assert.ok(parcelFlags({...p,warehouse:'unknown'},o,m).includes('Unknown fulfilment centre'));
  assert.ok(parcelFlags({...p,rateBaselinePence:100,postageMinor:150},o,m).includes('Cost more than 25% off its rate'));
  assert.ok(parcelFlags({...p,pickPackMinor:1000},o,m).includes('Possible new surcharge'));
  assert.ok(!parcelFlags({...p,rateBaselinePence:400,postageMinor:339},o,m).includes('Cost more than 25% off its rate'));

});

test('confirmation matches and adds second parcels, records MAE, refreshes new orders, isolates modes and reuploads idempotently',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());
  const o=await order();await new ShopifyStore(db,'live').put('order',o.id,o,now);
  await db.query('INSERT INTO pulse.settings (values) VALUES ($1)',[JSON.stringify(settings)]);
  const rows=parseExport(csv());
  const preview=await previewImport(db,'live',rows,.754);assert.deepEqual(preview.matched,['990001']);assert.equal((await readUploads(db,'live')).length,0);
  const first=await confirmImport(db,'live',rows,'invented.csv',.754,now);assert.equal(first.saved,1);
  assert.equal((await readUploads(db,'live'))[0]!.errorPence,19);assert.equal((await readEstimates(db,'live'))[0]!.source,'actual');
  assert.equal((await confirmImport(db,'live',[...rows,...rows],'invented.csv',.754,now)).saved,0);
  const extra={...rows[0]!,despatchedAt:'2026-09-30 16:00:00'};
  await confirmImport(db,'live',[extra],'invented-extra.csv',.754,new Date(now.getTime()+1000));
  assert.equal((await readParcels(db,'live')).length,2);assert.equal((await readEstimates(db,'live'))[0]!.costPence,962);assert.equal((await readUploads(db,'live')).length,2);
  assert.equal((await readParcels(db,'sample')).length,0);
  const unmatched={...rows[0]!,orderNumber:'990009'};
  await confirmImport(db,'live',[unmatched],'invented-unmatched.csv',.754,new Date(now.getTime()+2000));assert.equal((await fulfilmentSummary(db,'live',now)).unmatched.length,1);
  const raw=(await fixture('order')).data.order;raw.id='gid://shopify/Order/990009';raw.name='#990009';await new ShopifyStore(db,'live').orders([raw],now);
  assert.equal((await fulfilmentSummary(db,'live',now)).unmatched.length,0);assert.equal((await readEstimates(db,'live')).find(e=>e.orderId===raw.id)!.source,'actual');
  await db.query("UPDATE pulse.settings SET values=jsonb_set(values,'{jjGbpPerUsd}','0.8')");
  await assert.rejects(confirmImport(db,'live',[{...extra,despatchedAt:'2026-09-30 17:00:00'}],'invented-stale.csv',.754,now),ImportError);
  await refreshFulfilment(db,'live',now);assert.equal((await readEstimates(db,'live'))[0]!.costPence,962);
});

test('authenticated upload API requires preview and confirmation, never persists dropped columns, blocks foreign origins',async t=>{
  const db=await createTestDatabase();const config=readRuntime({NODE_ENV:'test',DATABASE_URL:'postgresql://localhost/pulse_test',APP_ORIGIN:'https://pulse.example.test'});
  const app=await createApp(db,config);t.after(async()=>{await app.close();await db.close();});
  for(const url of ['/api/fulfilment','/api/fulfilment/preview','/api/fulfilment/confirm']) {
    const response=await app.inject({method:url.endsWith('/fulfilment')?'GET':'POST',url,headers:{origin:config.origin},payload:url.endsWith('/fulfilment')?undefined:{}});assert.equal(response.statusCode,401);
  }
  const secret=(await db.query<{value:Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const id=randomBytes(32).toString('base64url'),token=randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials (id,public_key) VALUES ($1,$2)',[id,randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions (token_hash,credential_id,expires_at) VALUES ($1,$2,now()+interval '30 days')",[createHmac('sha256',Buffer.from(secret.value)).update(token).digest('hex'),id]);
  const headers={cookie:`__Host-pulse_session=${token}`,origin:config.origin};
  assert.equal((await app.inject({method:'POST',url:'/api/fulfilment/confirm',headers,payload:{token:'invented'}})).statusCode,400);
  const lines=csv().split('\n'),privateMarker='invented-discard-only';
  const raw=lines[0]+',Extra Column\n'+lines[1]+','+privateMarker;
  const count=(await readParcels(db,'sample')).length;
  const response=await app.inject({method:'POST',url:'/api/fulfilment/preview',headers,payload:{fileName:'invented.csv',csv:raw}});assert.equal(response.statusCode,200,response.body);assert.ok(!response.body.includes(privateMarker));
  assert.equal((await readParcels(db,'sample')).length,count);
  assert.equal((await app.inject({method:'POST',url:'/api/fulfilment/confirm',headers:{...headers,origin:'https://wrong.example.test'},payload:{token:response.json().token}})).statusCode,403);
  const saved=await app.inject({method:'POST',url:'/api/fulfilment/confirm',headers,payload:{token:response.json().token,completePeriod:true,coverageFrom:'2000-01-01',coverageTo:'2099-12-31'}});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().saved,1);
  const uploaded=(await readUploads(db,'sample')).find(u=>u.id===saved.json().uploadId)!;
  assert.equal(uploaded.coverageFrom,'2026-09-30');assert.equal(uploaded.coverageTo,'2026-09-30');
  assert.ok(!JSON.stringify(await readParcels(db,'sample')).includes(privateMarker));
  assert.match((await app.inject({url:'/fulfilment',headers})).body,/Sample data/);
});

test('stored USD parcels keep earlier invoice rates and concurrent confirmations deduplicate atomically',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());
  const o=await order('990002',true);await new ShopifyStore(db,'live').put('order',o.id,o,now);
  await db.query('INSERT INTO pulse.settings (values) VALUES ($1)',[JSON.stringify({...settings,jjGbpPerUsd:.8})]);
  const row=parseExport(csv({'Reference':'990002','Fulfilment Centre':'Columbus','Postage Method':'Ground Advantage','Country':'US','Postage Charge':'8.00','Line Total':'10.0000'}));
  const results=await Promise.all([confirmImport(db,'live',row,'invented-us.csv',.8,now),confirmImport(db,'live',row,'invented-us.csv',.8,now)]);
  assert.equal(results.reduce((s,r)=>s+r.saved,0),1);assert.equal((await readUploads(db,'live')).length,1);
  await db.query("UPDATE pulse.settings SET values=jsonb_set(values,'{jjGbpPerUsd}','0.5')");
  await refreshFulfilment(db,'live',now);
  const stored=(await readParcels(db,'live'))[0]!;assert.equal(stored.currency,'USD');assert.equal(stored.gbpPerUsd,.8);assert.equal(stored.postageMinor,800);assert.equal(stored.pickPackMinor,200);assert.equal(stored.customerPaidPence,200);
  assert.equal((await readEstimates(db,'live'))[0]!.costPence,800);
  assert.equal((await fulfilmentSummary(db,'live',now)).averages[1]!.gbpPence,800);
  assert.equal((await readUploads(db,'live'))[0]!.gbpPerUsd,.8);
  const complete=await confirmImport(db,'live',row,'invented-us.csv',.5,now,undefined,true);
  assert.equal(complete.saved,0);assert.equal((await readUploads(db,'live')).filter(u=>u.coverageFrom==='2026-09-30'&&u.coverageTo==='2026-09-30').length,1);
  const repeated=await confirmImport(db,'live',row,'invented-us.csv',.5,now,undefined,true);assert.equal(repeated.uploadId,null);

});


test('real ExportOrders services train, including FedEx IOSS, while unknown carriers stay excluded',async()=>{
  const services=['Royal Mail Tracked 48','DPD V2 Parcel Next Day','DPD Two Day','DPD V2 Parcel Two Day','USPS GroundAdvantage','USPS Ground Advantage','UPS Ground','FedEx International Connect Plus IOSS','FedEx IOSS Economy'];
  const orders:Order[]=[],parcels:Parcel[]=[];
  for (const [i,service] of [...services,'Invented Service','FedEx Invented Service'].entries()) {
    const us=service.startsWith('USPS') || service.startsWith('UPS'),o=await order(String(992000+i),us);
    const row=parseExport(csv({'Reference':o.orderNumber!,'Postage Method':service,'Fulfilment Centre':us?'Columbus':'Northampton 2','Country':us?'US':'FR'}))[0]!;
    const p={...parcel(row,o.id),id:String(i)};orders.push(o);parcels.push(p);
    assert.equal(knownService(p.warehouse,service),i<services.length);
    assert.equal(parcelFlags(p,o,emptyModel()).includes('Unknown service'),i>=services.length);
  }
  const model=learn(parcels,orders);
  assert.equal(model.rates.reduce((n,r)=>n+r.count,0),services.length);
  for (const service of services) assert.ok(model.rates.some(r=>r.service.replace(/\s/g,'').toLowerCase()===service.replace(/\s/g,'').toLowerCase()));
});

test('bad CSV cells name physical 1-based row and allowlisted column without exposing values',()=>{
  for (const column of columns) {
    const bad=csv({[column]:'invented-private-value@invalid'}).split('\n')[1]!;
    const input='\n\uFEFF'+columns.join(',')+'\n'+csv().split('\n')[1]+'\n'+bad;
    assert.throws(()=>parseExport(input),error=>error instanceof ImportError && error.message===`Row 4, ${column}: invalid format.`);
  }
  assert.throws(()=>parseExport(csv({'Line Total':'2.0000'})),{message:'Row 2, Line Total: must cover Postage Charge.'});
  const header=columns.join(',')+',Discarded Column';
  const first=csv().split('\n')[1]+',"invented\nignored"';
  const bad=csv({'Boxed Weight':'private-invalid-weight'}).split('\n')[1]+',ignored';
  assert.throws(()=>parseExport(header+'\n'+first+'\n'+bad),{message:'Row 4, Boxed Weight: invalid format.'});
  assert.throws(()=>parseExport(csv().replace('1.388 kg','"private-invalid')),error=>error instanceof ImportError && error.message==='Row 2, Boxed Weight: invalid CSV quoting.');
});

test('rebuild clears stale flags and baselines on all parcels; unknown Needs group by spelling and count',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());
  const orders=[await order('993001'),await order('993002'),await order('993003'),await order('993004')];
  const store=new ShopifyStore(db,'live');for (const o of orders) await store.put('order',o.id,o,now);
  const rows=orders.map((o,i)=>parseExport(csv({'Reference':o.orderNumber!,'Postage Method':i<2?'Invented Service':'Royal Mail Tracked 48','Fulfilment Centre':i<2?'Northampton 2':'Invented Centre'}))[0]!);
  await confirmImport(db,'live',rows,'invented-review.csv',.754,now);
  const summary=await fulfilmentSummary(db,'live',now);
  const services=summary.needs.filter(n=>n.title==='Unknown service'),centres=summary.needs.filter(n=>n.title==='Unknown fulfilment centre');
  assert.equal(services.length,1);assert.equal(services[0]!.why,'Invented Service · 2 parcels');
  assert.equal(centres.length,1);assert.equal(centres[0]!.why,'Invented Centre · 2 parcels');
  assert.equal(summary.model.rates.length,0);
  const configuredServices=appConfig.fulfilment.knownServices.uk as unknown as string[];
  configuredServices.push('Invented Service');
  try {
    await db.query("UPDATE pulse.fulfilment_parcels SET rate_baseline_pence=1 WHERE mode='live'");
    await refreshFulfilment(db,'live',now);
    const stored=await readParcels(db,'live');
    for (const p of stored.filter(p=>p.service==='Invented Service')) {assert.ok(!p.flags.includes('Unknown service'));assert.equal(p.rateBaselinePence,481);assert.ok(!p.flags.includes('Cost more than 25% off its rate'));}
    assert.equal((await fulfilmentSummary(db,'live',now)).needs.filter(n=>n.title==='Unknown service').length,0);
  } finally {configuredServices.pop();}
  await refreshFulfilment(db,'live',now);
  for (const p of (await readParcels(db,'live')).filter(p=>p.service==='Invented Service')) {assert.ok(p.flags.includes('Unknown service'));assert.equal(p.rateBaselinePence,null);}
  assert.equal((await fulfilmentSummary(db,'live',now)).model.rates.length,0);
});


test('order ingest without affected parcels updates estimates without relearning invoice models',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());
  const store=new ShopifyStore(db,'live'),o=await order();await store.put('order',o.id,o,now);
  await confirmImport(db,'live',parseExport(csv()),'invented.csv',.754,now);
  const before=(await db.query<{updated_at:Date}>('SELECT updated_at FROM pulse.fulfilment_models WHERE mode=$1',['live'])).rows[0]!.updated_at;
  const raw=(await fixture('order')).data.order;raw.id='gid://shopify/Order/994001';raw.name='#994001';
  await store.orders([raw],new Date(now.getTime()+60000));
  const after=(await db.query<{updated_at:Date}>('SELECT updated_at FROM pulse.fulfilment_models WHERE mode=$1',['live'])).rows[0]!.updated_at;
  assert.equal(new Date(after).getTime(),new Date(before).getTime());
  assert.ok((await readEstimates(db,'live')).some(e=>e.orderId===raw.id));
  assert.equal((await fulfilmentSummary(db,'live',now)).orderCount,2);
  const estimates=await readEstimates(db,'live');
  await store.orders([{...raw,updatedAt:'2020-01-01T00:00:00Z',shippingAddress:{countryCodeV2:'US',provinceCode:'CA'}}],new Date(now.getTime()+120000));
  assert.deepEqual(await readEstimates(db,'live'),estimates);
});


test('service comparison ignores spaces and case and combines rate rows without changing parcels',async()=>{
  for (const service of ['USPS GroundAdvantage','USPS Ground Advantage',' usps  groundadvantage ','dpd v2 parcel two day','DPD V2 Parcel Two Day']) assert.equal(knownService('us',service),true);
  assert.equal(knownService('us','Invented Experimental'),false);
  const o=await order('995001',true),p=parcel(parseExport(csv({'Postage Method':'USPS GroundAdvantage','Fulfilment Centre':'Columbus'}))[0]!,o.id);
  const other={...p,id:'second',service:'usps ground advantage'};
  const model=learn([p,other],[o]);assert.equal(model.rates.length,1);assert.equal(model.rates[0]!.count,2);
  assert.equal(p.service,'USPS GroundAdvantage');assert.equal(other.service,'usps ground advantage');
});

test('monthly reminder starts at first working day 09:00 UK and requires complete gap-free month coverage',()=>{
  assert.equal(monthlyReminder(new Date('2026-10-01T07:59:59Z'),[]),false);
  assert.equal(monthlyReminder(new Date('2026-10-01T08:00:00Z'),[]),true);
  // November starts on Sunday; August starts on Saturday. Bank holidays are ignored.
  for (const instant of ['2026-11-01T12:00:00Z','2026-11-02T08:59:59Z','2026-08-01T12:00:00Z','2026-08-02T12:00:00Z','2026-08-03T07:59:59Z']) assert.equal(monthlyReminder(new Date(instant),[]),false);
  for (const instant of ['2026-11-02T09:00:00Z','2026-08-03T08:00:00Z']) assert.equal(monthlyReminder(new Date(instant),[]),true);
  const at=new Date('2026-11-02T09:00:00Z');
  assert.equal(monthlyReminder(at,[{coverageFrom:'2026-10-01',coverageTo:'2026-10-31'}]),false);
  assert.equal(monthlyReminder(at,[{coverageFrom:'2026-10-01',coverageTo:'2026-10-30'}]),true);
  assert.equal(monthlyReminder(at,[{coverageFrom:'2026-10-01',coverageTo:'2026-10-15'},{coverageFrom:'2026-10-16',coverageTo:'2026-10-31'}]),false);
  assert.equal(monthlyReminder(at,[{coverageFrom:'2026-10-01',coverageTo:'2026-10-15'},{coverageFrom:'2026-10-17',coverageTo:'2026-10-31'}]),true);
  assert.equal(monthlyReminder(at,[{coverageFrom:null,coverageTo:null}]),true);
  assert.equal(monthlyReminder(new Date('2027-01-01T09:00:00Z'),[]),true);
});

test('startup rebuild clears stale flags and unknown baselines in every stored mode without re-upload',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());
  for (const mode of ['sample','live'] as const) {
    const o=await order('995002'),store=new ShopifyStore(db,mode);await store.put('order',o.id,o,now);
    const rows=['Royal Mail Tracked 48','DPD V2 Parcel Two Day','Invented Experimental'].map((service,i)=>parseExport(csv({'Postage Method':service,'Despatched':`2026-09-30 ${14+i}:00:00`,'Postage Charge':i===2?'99.00':'3.20','Line Total':i===2?'199.0000':'4.8000'}))[0]!);
    await confirmImport(db,mode,rows,'invented-startup.csv',.754,now);
    const unknown=(await readParcels(db,mode)).find(p=>p.service==='Invented Experimental')!;
    assert.equal(unknown.rateBaselinePence,null);assert.deepEqual(unknown.flags,['Unknown service']);
    await db.query('UPDATE pulse.fulfilment_parcels SET flags=$2,rate_baseline_pence=1 WHERE mode=$1',[mode,JSON.stringify(['Unknown service','Cost more than 25% off its rate','Possible new surcharge'])]);
  }
  const config=readRuntime({NODE_ENV:'test',DATABASE_URL:'postgresql://localhost/pulse_test',APP_ORIGIN:'https://pulse.example.test'});
  const app=await createApp(db,config);t.after(()=>app.close());
  await app.listen({host:'127.0.0.1',port:0});
  await app.startBackgroundWork();
  for (const mode of ['sample','live'] as const) {
    const rows=await readParcels(db,mode);
    assert.deepEqual(rows.find(p=>p.service==='Invented Experimental')!.flags,['Unknown service']);
    assert.equal(rows.find(p=>p.service==='Invented Experimental')!.rateBaselinePence,null);
    assert.ok(!rows.find(p=>p.service==='DPD V2 Parcel Two Day')!.flags.includes('Unknown service'));
  }
});


function review(p:Parcel,o:Order|undefined,model:ReturnType<typeof learn>) {
  const q=o&&quantities(o);
  const rate=q&&model.rates.find(r=>r.warehouse===p.warehouse&&normaliseService(r.service)===normaliseService(p.service)&&r.mix===mixKey(q)&&r.state===(p.warehouse==='us'?o!.region:''));
  const fallback=o?estimateOrder({...o,fulfillments:[],fulfillmentStatus:'UNFULFILLED',country:p.warehouse==='uk'?'GB':p.warehouse==='us'?'US':null,market:p.warehouse==='uk'?'UK':p.warehouse==='us'?'US':'unknown'},[],model,{...settings,jjGbpPerUsd:p.gbpPerUsd}):null;
  const baseline=!knownService(p.warehouse,p.service)?null:rate?gbpMinor(rate.postage+rate.pickPack,p.currency,p.gbpPerUsd):fallback&&['exact','ladder'].includes(fallback.source)?fallback.costPence:null;
  return {baseline,flags:parcelFlags({...p,rateBaselinePence:baseline},o,model)};
}

test('bounded leave-one-out baselines and flags equal the original fixture refits',async()=>{
  const {orders,parcels}=await fits();
  parcels.push({...parcels[0]!,id:'invented-outlier',pickPackMinor:1400,gbpPerUsd:.8});
  parcels.push({...parcels[4]!,id:'invented-alias',service:'groundadvantage',postageMinor:1600});
  parcels.push({...parcels[0]!,id:'invented-unknown',service:'Invented Experimental'});
  parcels.push({...parcels[0]!,id:'invented-unmatched',orderId:null});
  const peersFor=leaveOneOutModels(parcels,orders);
  for (const p of parcels) {
    const o=orders.find(o=>o.id===p.orderId);
    assert.deepEqual(review(p,o,peersFor(p)),review(p,o,learn(parcels.filter(other=>other.id!==p.id),orders)),p.id);
  }
  // Exercise service-count ties, singleton groups and disappearing SKU columns.
  for (const p of parcels) {
    const subset=parcels.filter(other=>other.warehouse===p.warehouse).slice(0,2);
    if (!subset.includes(p)) continue;
    assert.deepEqual(review(p,orders.find(o=>o.id===p.orderId),leaveOneOutModels(subset,orders)(p)),review(p,orders.find(o=>o.id===p.orderId),learn(subset.filter(other=>other.id!==p.id),orders)));
  }
});

test('transaction reads are serial and one bulk update persists every parcel review and match',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());
  const {orders,parcels}=await fits();
  parcels.push({...parcels[0]!,id:'invented-unmatched',orderNumber:'998002',orderId:null});
  parcels.push({...parcels[0]!,id:'invented-unknown',orderNumber:'998003',orderId:null,service:'Invented Experimental'});
  const store=new ShopifyStore(db,'live');for (const o of orders) await store.put('order',o.id,o,now);
  let updates=0;
  const serial=(connection:typeof db):typeof db=>({
    ...connection,
    query:async(text,values)=>{
      assert.equal(busy,false,'a transaction client must have only one query in flight');
      busy=true;
      if (text.startsWith('UPDATE pulse.fulfilment_parcels')) updates++;
      try { return await connection.query(text,values); } finally {busy=false;}
    },
    transaction:fn=>connection.transaction(tx=>fn(serial(tx))),
  });
  let busy=false;
  const tracked={...db,transaction:<T>(fn:(tx:typeof db)=>Promise<T>)=>db.transaction(tx=>fn(serial(tx)))};
  await confirmImport(tracked,'live',parcels,'invented-fits.csv',.754,now);
  assert.equal(updates,1);
  const stored=await readParcels(db,'live');
  for (const p of stored) {
    const expected=review(p,orders.find(o=>o.id===p.orderId),learn(stored.filter(other=>other.id!==p.id),orders));
    assert.equal(p.rateBaselinePence,expected.baseline);assert.deepEqual(p.flags,expected.flags);
  }
  assert.equal(stored.length,parcels.length);
  const before=await readEstimates(db,'live');
  updates=0;
  await db.query("UPDATE pulse.fulfilment_parcels SET flags='[\"Unknown service\"]',rate_baseline_pence=1,order_id=null WHERE mode='live'");
  await refreshFulfilment(tracked,'live',now);
  assert.equal(updates,1);
  assert.deepEqual(await readEstimates(db,'live'),before);
  assert.deepEqual(await readParcels(db,'live'),stored);
  // The unaffected ingest branch also uses serial model/settings reads.
  const raw=(await fixture('order')).data.order;raw.id='gid://shopify/Order/998001';raw.name='#998001';
  await new ShopifyStore(tracked,'live').orders([raw],now);
  assert.equal(updates,1);
});
