import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import type { Database } from '../src/db.js';
import type { AdInsight, CatalogueEntry } from '../src/creatives/model.js';
import { saveCatalogue, saveInsights } from '../src/creatives/store.js';
import { readAttributeRows } from '../src/creatives/attribute-store.js';
import { resolveAttribute } from '../src/creatives/attributes.js';
import { runCreativeScans, readScanHealth, scanImageMime, scanRequestReserve, scanRetryAt, scanSystemText, type ScanOptions } from '../src/creatives/scan.js';
import { scanSpendToday } from '../src/creatives/scan-health.js';
import { defaultSettings } from '../src/settings.js';
import { createTestDatabase } from './helpers/database.js';

// Every identifier, byte fixture, copy line, price, token count and credential is invented.
const account = 'invented-scan-account', now = new Date('2026-10-14T12:00:00Z');
const inventedCredential = 'invented-scan-key-1', rotatedCredential = 'invented-scan-key-2';
const jpeg = (id = 0) => new Uint8Array([0xff, 0xd8, 0xff, id]);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 12]);
const settings = () => ({ ...defaultSettings(), creativeScanInputPrice: 1, creativeScanOutputPrice: 2 });
const options = (changes: Partial<ScanOptions> = {}): ScanOptions => ({ mode: 'live', accountId: account, clock: () => now, ...changes });
const attributes = { childInShot: { value: 'yes', confidence: 0.8, reason: 'Invented visible child drawing a card' } };
const answer = (text = JSON.stringify({ attributes }), input = 100, output = 50) => new Response(JSON.stringify({
  stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: input, output_tokens: output },
}), { headers: { 'content-type': 'application/json' } });
let db: Database;
const originalFlag = process.env.CREATIVE_SCAN_ENABLED, originalKey = process.env.ANTHROPIC_API_KEY;
before(async () => { db = await createTestDatabase(); });
beforeEach(async () => {
  await db.query('TRUNCATE pulse.media_groups CASCADE');
  process.env.CREATIVE_SCAN_ENABLED = 'true'; process.env.ANTHROPIC_API_KEY = inventedCredential;
});
after(async () => {
  await db.close();
  if (originalFlag === undefined) delete process.env.CREATIVE_SCAN_ENABLED; else process.env.CREATIVE_SCAN_ENABLED = originalFlag;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalKey;
});
function entry(id: string, video = false, created = now): CatalogueEntry {
  return { ad: {
    id: `ad-${id}`, accountId: account, name: `Invented ad ${id}`, status: 'ACTIVE', effectiveStatus: 'ACTIVE',
    createdAt: created.toISOString(), adSetId: 'invented-set', adSetName: 'Invented UK set', campaignId: 'invented-campaign',
    campaignName: 'Invented UK campaign', owner: 'ours', market: 'uk', creativeId: `creative-${id}`,
    creativeType: video ? 'video' : 'image', body: `Invented drawing kit ${id}`, title: 'Invented headline', callToAction: 'SHOP_NOW',
    linkUrl: null, utmContent: null, lastSeen: now.toISOString(), facebookUrl: null, instagramUrl: null,
    objectStoryId: null, instagramMediaId: null,
  }, media: { id, kind: video ? 'video' : 'image', key: `media-${id}`, title: `Invented media ${id}`,
    lengthSeconds: video ? 12 : null, width: 600, height: 600, firstSeen: created.toISOString(), alternates: [],
    thumbnail: jpeg(), poster: video ? jpeg(99) : null, frames: video ? Array.from({ length: 9 }, (_, i) => jpeg(i + 1)) : [] } };
}
async function seed(entries: CatalogueEntry[], spend = 60, targetAccount = account) {
  await saveCatalogue(db, targetAccount, entries, now);
  const insights: AdInsight[] = entries.map(row => ({ adId: row.ad.id, adSetId: row.ad.adSetId, day: '2026-10-13', spend,
    impressions: 100, reach: 80, frequency: 1.25, linkClicks: 10, threeSecondPlays: 8, threeSecondSource: 'video_view', plays: 10,
    thruPlays: 4, plays25: 6, plays50: 5, plays75: 4, plays100: 3, averagePlayTime: 4, addsToCart: 2, purchases: 1, purchaseValue: 30 }));
  await saveInsights(db, targetAccount, '2026-10-13', '2026-10-13', insights, now);
}
const rows = async () => (await db.query<any>('SELECT * FROM pulse.creative_scans ORDER BY sequence')).rows;
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('flag off, missing key, sample mode and either missing price make no request or scan row', async t => {
  await seed([entry('disabled')]);
  let calls = 0; const logs: unknown[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args));
  const fetch: typeof globalThis.fetch = async () => { calls++; return answer(); };
  process.env.CREATIVE_SCAN_ENABLED = 'false';
  assert.equal((await runCreativeScans(db, settings(), options({ fetch }))).state, 'off');
  process.env.CREATIVE_SCAN_ENABLED = 'true'; delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await runCreativeScans(db, settings(), options({ fetch }))).state, 'off');
  assert.equal((await readScanHealth(db, settings(), options())).status, 'waiting_for_keys');
  process.env.ANTHROPIC_API_KEY = inventedCredential;
  assert.equal((await runCreativeScans(db, settings(), options({ fetch, mode: 'sample' }))).state, 'off');
  for (const key of ['creativeScanInputPrice', 'creativeScanOutputPrice'] as const) {
    const config = { ...settings(), [key]: 0 };
    const result = await runCreativeScans(db, config, options({ fetch }));
    assert.equal(result.state, 'prices'); assert.equal(result.message, 'Set the scan prices in Settings');
    assert.equal((await readScanHealth(db, config, options())).message, 'Set the scan prices in Settings');
  }
  assert.equal(calls, 0); assert.deepEqual(logs, []); assert.deepEqual(await rows(), []);
});

test('video sends poster plus six ordered frames and newest merged copy; validated model rows preserve Will and never expose the key', async t => {
  const parent = entry('video', true, new Date('2026-10-12T12:00:00Z')), child = entry('child', false);
  await seed([parent, child], 30);
  await db.query('UPDATE pulse.media_groups SET merged_into_id=$1 WHERE id=$2', ['video', 'child']);
  await db.query(`INSERT INTO pulse.media_attributes(id,mode,account_id,media_group_id,attribute_key,value,source,recorded_at)
    VALUES('invented-will-row','live',$1,'video','childInShot','{"value":"no"}','will',$2)`, [account, now]);
  const logs: unknown[] = [], requests: any[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args));
  const raw = JSON.stringify({ attributes: {
    ...attributes, childInShot: { value: 'yes', confidence: 0.8, reason: 'invented-scan-key-1 visible caption' },
    slabEarly: { value: 'yes', confidence: 0.4, reason: 'Invented uncertain frame' },
    hookType: { value: 'forbidden', confidence: 0.9 }, voiceOver: { value: 'yes', confidence: 1 },
    unknownField: { value: 'yes', confidence: 1 }, captions: { value: 'yes', confidence: 2 },
  }, padding: '£'.repeat(12_000) });
  const result = await runCreativeScans(db, settings(), options({ fetch: async (url, init) => {
    assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-api-key'), process.env.ANTHROPIC_API_KEY);
    assert.equal(headers.get('anthropic-version'), '2023-06-01'); assert.equal(headers.get('content-type'), 'application/json');
    requests.push(JSON.parse(String(init?.body))); return answer(raw, 120, 30);
  } }));
  assert.deepEqual(result, { state: 'done', attempts: 1, done: 1, failed: 0 });
  const body = requests[0], content = body.messages[0].content;
  assert.equal(body.model, settings().creativeScanModel); assert.equal('temperature' in body, false); assert.equal(body.max_tokens, 1500);
  assert.equal(content.length, 8);
  assert.deepEqual(content.slice(0, 7).map((block: any) => Buffer.from(block.source.data, 'base64').at(-1)), [99, 1, 2, 3, 4, 5, 6]);
  assert.ok(content.slice(0, 7).every((block: any) => block.source.media_type === 'image/jpeg'));
  assert.match(content[7].text, /Invented drawing kit child/); assert.match(content[7].text, /Invented headline/); assert.match(content[7].text, /SHOP_NOW/);
  for (const forbidden of ['whoSpeaks', 'voiceOver', 'music:', 'spokenCallToAction']) assert.ok(!body.system.includes(forbidden));
  assert.match(body.system, /Do not identify, name or describe any person/);
  const saved = (await rows())[0];
  assert.equal(Number(saved.input_tokens), 120); assert.equal(Number(saved.output_tokens), 30); assert.equal(Number(saved.cost_gbp), 0.00018);
  assert.equal(saved.poster_only, false); assert.equal(saved.dropped_count, 4); assert.equal(saved.status, 'done');
  assert.ok(Buffer.byteLength(saved.raw_response) <= 20_480); assert.ok(!saved.raw_response.endsWith('\uFFFD'));
  const tags = await readAttributeRows(db, 'live', account, 'video');
  assert.equal(tags.length, 3); assert.equal(resolveAttribute('video', 'childInShot', tags)?.value, 'no');
  assert.equal(resolveAttribute('video', 'slabEarly', tags)?.unsure, true);
  assert.ok(!JSON.stringify([saved, tags, result, logs]).includes(process.env.ANTHROPIC_API_KEY!));
  assert.deepEqual(logs, []);
  const health = await readScanHealth(db, settings(), options({ clock: undefined }));
  assert.equal(health.scanned, 1); assert.equal(health.failed, 0); assert.equal(health.status, 'healthy');
});

test('image MIME comes from stored full bytes; missing video frames refill or keep a poster-only attempt', async () => {
  const refill = entry('refill', true); refill.media.lengthSeconds = 18;
  await seed([entry('full'), entry('poster', true), refill]);
  await db.query('UPDATE pulse.media_groups SET full_image=$1 WHERE id=$2', [png, 'full']);
  await db.query("UPDATE pulse.media_groups SET frames='{}' WHERE kind='video'");
  const pictures: Record<string, any[]> = {}, reads: string[] = [];
  for (const groupId of ['full', 'poster', 'refill']) {
    await runCreativeScans(db, settings(), options({ groupId,
      reader: { imageBytes: async () => { throw new Error('unused'); }, videoFrames: async key => {
        reads.push(key); if (key === 'media-poster') throw new Error('Invented refusal'); return [png, jpeg(4)];
      } }, fetch: async (_url, init) => {
        pictures[groupId] = JSON.parse(String(init?.body)).messages[0].content.filter((block: any) => block.type === 'image'); return answer();
      } }));
  }
  assert.equal(pictures.full?.[0]?.source.media_type, 'image/png');
  assert.equal(pictures.poster?.length, 1); assert.equal(pictures.refill?.length, 3);
  assert.deepEqual(reads, ['media-poster', 'media-refill']);
  assert.deepEqual((await rows()).map(row => row.poster_only), [false, true, false]);
  assert.equal(scanImageMime(Buffer.from('GIF89a invented')), 'image/gif');
  assert.equal(scanImageMime(Buffer.from('RIFF0000WEBP invented')), 'image/webp');
  assert.equal(scanImageMime(Buffer.from('<svg>invented</svg>')), null);
});

test('malformed answers wait until next UK day; repeated failure also waits one UK day and later success recovers health', async t => {
  await seed([entry('retry')]);
  const logs: string[] = []; t.mock.method(console, 'error', (line: string) => logs.push(line));
  let instant = new Date('2026-10-24T12:00:00Z'), calls = 0;
  const opts = options({ groupId: 'retry', clock: () => instant, fetch: async () => { calls++; return answer('invented malformed'); } });
  assert.equal((await runCreativeScans(db, settings(), opts)).state, 'failed');
  assert.equal(new Date((await rows())[0].retry_after).toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal((await runCreativeScans(db, settings(), opts)).state, 'cooldown'); assert.equal(calls, 1);
  instant = new Date('2026-10-24T23:00:00Z');
  await runCreativeScans(db, settings(), opts);
  assert.equal(new Date((await rows())[1].retry_after).toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal((await readScanHealth(db, settings(), { mode: 'live', accountId: account, now: instant })).failed, 1);
  instant = new Date('2026-10-26T00:00:00Z');
  await runCreativeScans(db, settings(), { ...opts, fetch: async () => answer() });
  let health = await readScanHealth(db, settings(), { mode: 'live', accountId: account, now: instant });
  assert.equal(health.scanned, 1); assert.equal(health.failed, 0); assert.equal(health.consecutiveFailures, 0);
  await runCreativeScans(db, settings(), { ...opts, fetch: async () => answer() });
  health = await readScanHealth(db, settings(), { mode: 'live', accountId: account, now: instant });
  assert.equal(health.scanned, 1, 'manual rescan does not inflate distinct-parent counts');
  assert.equal(scanRetryAt(new Date('2026-03-28T22:00:00Z')).toISOString(), '2026-03-29T00:00:00.000Z');
  assert.equal(scanRetryAt(new Date('2026-03-29T12:00:00Z')).toISOString(), '2026-03-29T23:00:00.000Z');
  assert.deepEqual(logs, ['Creative scan failed (malformed (http 200))', 'Creative scan failed (malformed (http 200))']);
});

test('429 stores its safe provider code, stops without retrying and recovers next UK day', async t => {
  await seed([entry('older', false, new Date('2026-10-12T12:00:00Z')), entry('newer')]);
  const logs: string[] = [], waits: number[] = []; let calls = 0, instant = now;
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  const opts=options({clock:()=>instant,groupId:'newer',sleep:async ms=>{waits.push(ms);},fetch:async()=>{
    calls++;return calls===1?Response.json({error:{type:'rate_limit_error',message:process.env.ANTHROPIC_API_KEY}},{status:429}):answer();
  }});
  assert.equal((await runCreativeScans(db,settings(),opts)).failed,1);
  assert.equal(calls,1);assert.deepEqual(waits,[]);
  const saved=await rows();assert.equal(saved[0].http_status,429);assert.equal(saved[0].provider_code,'rate_limit_error');
  assert.match((await readScanHealth(db,settings(),options())).line,/1 failed · refused \(http 429, rate_limit_error\)/);
  assert.equal((await runCreativeScans(db,settings(),opts)).state,'cooldown');assert.equal(calls,1);
  instant=scanRetryAt(now);assert.equal((await runCreativeScans(db,settings(),opts)).done,1);assert.equal(calls,2);
  assert.deepEqual(logs,['Creative scan failed (refused (http 429, rate_limit_error))']);
  assert.ok(!JSON.stringify([saved,logs]).includes(process.env.ANTHROPIC_API_KEY!));
  assert.equal((await readScanHealth(db,settings(),options())).failed,0);
});

test('5xx stops the pass and repeated failures remain eligible each next UK day', async t => {
  await seed([entry('server')]);t.mock.method(console,'error',()=>{});
  let instant=now,calls=0;const waits:number[]=[];
  const opts=options({clock:()=>instant,sleep:async ms=>{waits.push(ms);},fetch:async()=>{calls++;return new Response('invented outage',{status:503});}});
  await runCreativeScans(db,settings(),opts);assert.equal(calls,1);assert.deepEqual(waits,[]);
  assert.equal((await runCreativeScans(db,settings(),opts)).state,'cooldown');
  instant=scanRetryAt(now);await runCreativeScans(db,settings(),opts);assert.equal(calls,2);
  const saved=await rows();assert.equal(saved.length,2);assert.equal(saved[1].failure_reason,'refused');
  assert.equal(new Date(saved[1].retry_after).toISOString(),scanRetryAt(instant).toISOString());
});

test('preflight cap stops before an unaffordable request, charges actual usage and resumes next UK day', async () => {
  await seed([entry('cap-first'), entry('cap-next', false, new Date('2026-10-13T12:00:00Z'))]);
  const config = settings(), copy = 'Ad body: Invented drawing kit cap-first\nAd title: Invented headline\nCall to action: SHOP_NOW';
  config.creativeScanCapGbp = scanRequestReserve(config, scanSystemText('image'), copy, 1, 'image') + 0.0001;
  let calls = 0;
  const opts = options({ fetch: async () => { calls++; return answer(); } });
  assert.equal((await runCreativeScans(db, config, opts)).state, 'cap'); assert.equal(calls, 1);
  assert.equal((await runCreativeScans(db, { ...config, creativeScanCapGbp: 100 }, { ...opts, groupId: 'cap-first' })).state, 'cap',
    'an account cap stop also blocks another manual candidate for the rest of the UK day');
  assert.equal(calls, 1);
  assert.match((await readScanHealth(db, { ...config, creativeScanModel: 'claude-invented-next' }, { accountId: account, mode: 'live', now })).message!, /cap reached/);
  const saved = await rows(); assert.equal(saved[1].failure_reason, 'cap'); assert.equal(Number(saved[1].cost_gbp), 0);
  assert.equal((await readScanHealth(db, config, { accountId: account, mode: 'live', now })).failed, 0);
  assert.equal((await runCreativeScans(db, config, opts)).state, 'cap'); assert.equal(calls, 1);
  assert.equal(await scanSpendToday(db, opts, now), 0.0002);
  const tomorrow = new Date('2026-10-14T23:00:00Z');
  assert.equal(await scanSpendToday(db, opts, tomorrow), 0);
  assert.equal((await runCreativeScans(db, config, { ...opts, clock: () => tomorrow })).state, 'done'); assert.equal(calls, 2);
});

test('a next-day retry still checks the cap before calling the provider', async t => {
  await seed([entry('retry-cap')]);t.mock.method(console,'error',()=>{});
  let instant=now,calls=0;const opts=options({clock:()=>instant,fetch:async()=>{calls++;return Response.json({error:{type:'overloaded_error'}},{status:503});}});
  await runCreativeScans(db,settings(),opts);assert.equal(calls,1);
  instant=scanRetryAt(now);
  assert.equal((await runCreativeScans(db,{...settings(),creativeScanCapGbp:0.000001},opts)).state,'cap');
  assert.equal(calls,1);
  const health=await readScanHealth(db,settings(),{accountId:account,mode:'live',now:instant});
  assert.equal(health.failed,1);assert.equal(health.consecutiveFailures,1);assert.equal(health.reason,'refused');
  assert.match(health.message!,/cap reached/);
});

test('worker and manual runs share the account guard, cap at twenty sequential requests and skip already completed parents', async () => {
  await seed(Array.from({ length: 21 }, (_, i) => entry(`batch-${String(i).padStart(2, '0')}`, false, new Date(now.getTime() + i * 1000))));
  const entered = gate(), release = gate(); let calls = 0, inflight = 0, maximum = 0;
  const opts = options({ fetch: async () => {
    calls++; inflight++; maximum = Math.max(maximum, inflight);
    if (calls === 1) { entered.resolve(); await release.promise; }
    inflight--; return answer();
  } });
  const running = runCreativeScans(db, settings(), opts);
  await entered.promise;
  assert.equal((await runCreativeScans(db, settings(), { ...opts, groupId: 'batch-19' })).state, 'busy');
  release.resolve();
  assert.equal((await running).attempts, 20); assert.equal(maximum, 1); assert.equal(calls, 20);
  assert.equal((await rows())[0].media_group_id, 'batch-20');
  assert.equal((await runCreativeScans(db, settings(), opts)).attempts, 1); assert.equal(calls, 21);
  assert.equal((await runCreativeScans(db, settings(), opts)).state, 'idle'); assert.equal(calls, 21);
});

test('missing or unsupported images fail safely; network and abort errors expose only safe reason codes', async t => {
  await seed([entry('missing'), entry('network'), entry('timeout')]);
  await db.query('UPDATE pulse.media_groups SET thumbnail=$1 WHERE id=$2', [Buffer.from('<svg>invented</svg>'), 'missing']);
  const logs: string[] = []; t.mock.method(console, 'error', (line: string) => logs.push(line));
  let calls = 0;
  for (const groupId of ['missing', 'network', 'timeout']) await runCreativeScans(db, settings(), options({ groupId, fetch: async () => {
    calls++; if (groupId === 'timeout') throw new DOMException(process.env.ANTHROPIC_API_KEY, 'AbortError');
    throw new Error(process.env.ANTHROPIC_API_KEY);
  } }));
  assert.equal(calls, 2); assert.deepEqual(logs, ['Creative scan failed (unsupported type)', 'Creative scan failed (network)', 'Creative scan failed (timeout)']);
  assert.deepEqual((await rows()).map(row => row.failure_reason), ['unsupported type', 'network', 'timeout']);
  assert.ok(!JSON.stringify([await rows(), logs]).includes(process.env.ANTHROPIC_API_KEY!));
});

test('each call reads the current key; other account attempts and costs stay isolated', async () => {
  await seed([entry('rotation')]);
  const headers: string[] = [];
  const opts = options({ groupId: 'rotation', fetch: async (_url, init) => {
    headers.push(new Headers(init?.headers).get('x-api-key')!); return answer();
  } });
  await runCreativeScans(db, settings(), opts);
  process.env.ANTHROPIC_API_KEY = rotatedCredential;
  await runCreativeScans(db, settings(), opts);
  assert.deepEqual(headers, ['invented-scan-key-1', 'invented-scan-key-2']);
  const foreign = { mode: 'live' as const, accountId: 'invented-other-account', now };
  assert.equal((await readScanHealth(db, settings(), foreign)).scanned, 0);
  assert.equal(await scanSpendToday(db, foreign, now), 0);
  assert.equal((await runCreativeScans(db, settings(), { ...opts, accountId: foreign.accountId })).state, 'idle');
});

test('JSON-escaped credential echoes are removed after decoding and before saving model reasons or raw text', async () => {
  await seed([entry('escaped')]);
  const encoded = [...process.env.ANTHROPIC_API_KEY!].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const text = `{"attributes":{"childInShot":{"value":"yes","confidence":1,"reason":"${encoded}"}}}`;
  await runCreativeScans(db, settings(), options({ fetch: async () => answer(text) }));
  const saved = await rows(), tags = await readAttributeRows(db, 'live', account);
  assert.ok(!JSON.stringify([saved, tags]).includes(process.env.ANTHROPIC_API_KEY!));
  assert.ok(!saved[0].raw_response.includes(encoded));
  assert.equal((tags[0]?.value as any).reason, '[redacted]');
});

test('refused and missing-usage envelopes scrub Unicode key echoes before their early failure returns', async t => {
  await seed([entry('encoded-error'), entry('encoded-usage'), entry('encoded-malformed')]);
  t.mock.method(console, 'error', () => {});
  const key = process.env.ANTHROPIC_API_KEY!;
  const encoded = [...key].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const nested = `{"attributes":{"childInShot":{"value":"yes","confidence":1,"reason":"${encoded}"}}}`;
  const replies = [new Response(`{"error":{"message":"${encoded}"}}`, { status: 403 }),
    new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: nested }] })),
    answer(`not JSON: ${encoded}`)];
  for (const groupId of ['encoded-error', 'encoded-usage', 'encoded-malformed']) await runCreativeScans(db, settings(), options({ groupId,
    fetch: async () => replies.shift()! }));
  const saved = await rows();
  assert.deepEqual(saved.map(row => row.failure_reason), ['refused', 'malformed', 'malformed']);
  for (const row of saved) {
    assert.ok(!row.raw_response.includes(key)); assert.ok(!row.raw_response.includes(encoded));
    assert.equal(row.raw_response, '');
  }
  assert.deepEqual(await readAttributeRows(db, 'live', account), []);
});

test('the 60-second timer aborts the request and stores only the safe timeout reason', async t => {
  await seed([entry('aborted')]); t.mock.method(console, 'error', () => {});
  const realTimeout = globalThis.setTimeout, durations: number[] = [];
  t.mock.method(globalThis, 'setTimeout', ((callback: (...args: any[]) => void, ms?: number, ...args: any[]) => {
    if (ms === 60_000) durations.push(ms);
    return realTimeout(callback, ms === 60_000 ? 0 : ms, ...args);
  }) as typeof setTimeout);
  let signal: AbortSignal | null | undefined;
  const result = await runCreativeScans(db, settings(), options({ fetch: async (_url, init) => {
    signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort',
      () => reject(new DOMException('invented request aborted', 'AbortError')), { once: true }));
  } }));
  assert.deepEqual(durations, [60_000]); assert.equal(signal?.aborted, true);
  assert.equal(result.state, 'failed'); assert.equal((await rows())[0].failure_reason, 'timeout');
});

test('an answer with no kept attribute is failed and leaves prior model values untouched', async t => {
  await seed([entry('no-values')]); t.mock.method(console, 'error', () => {});
  const opts = options({ groupId: 'no-values', fetch: async () => answer() });
  await runCreativeScans(db, settings(), opts);
  const before = await readAttributeRows(db, 'live', account);
  const result = await runCreativeScans(db, settings(), { ...opts, fetch: async () => answer(JSON.stringify({ attributes: {
    childInShot: { value: 'forbidden', confidence: 1 }, music: { value: 'yes', confidence: 1 },
  } })) });
  assert.equal(result.state, 'failed'); assert.deepEqual(await readAttributeRows(db, 'live', account), before);
  const saved = (await rows())[1]; assert.equal(saved.failure_reason, 'malformed'); assert.equal(saved.dropped_count, 2);
});

test('oversized media stores a reason without a model call and the common failure is named', async t=>{
  await seed([entry('oversize-a'),entry('oversize-b'),entry('unsupported')]);t.mock.method(console,'error',()=>{});
  await db.query("UPDATE pulse.media_groups SET thumbnail=$1 WHERE id IN ('oversize-a','oversize-b')",[Buffer.alloc(5*1024*1024+1)]);
  await db.query("UPDATE pulse.media_groups SET thumbnail=$1 WHERE id='unsupported'",[Buffer.from('invented unsupported bytes')]);
  let calls=0;const opts=options({fetch:async()=>{calls++;return answer();}});
  assert.equal((await runCreativeScans(db,settings(),opts)).failed,3);assert.equal(calls,0);
  assert.deepEqual((await rows()).map(r=>r.failure_reason).sort(),['media too large','media too large','unsupported type']);
  assert.match((await readScanHealth(db,settings(),opts)).line,/3 failed · media too large/);
  assert.equal((await runCreativeScans(db,settings(),opts)).state,'cooldown');
});

test('structured output schemas stay within 24 optional keys and prohibit extra properties',async()=>{
 const {scanOutputSchema}=await import('../src/creatives/scan.js');
 for(const kind of ['image','video'] as const){
  const schema=scanOutputSchema(kind),attributes=schema.properties.attributes;
  assert.ok(Object.keys(attributes.properties).length<=24,`${kind} exceeds the API optional-property limit`);
  assert.deepEqual(schema.required,['attributes']);assert.equal(schema.additionalProperties,false);assert.equal(attributes.additionalProperties,false);
  for(const property of Object.values(attributes.properties)){
   assert.equal(property.additionalProperties,false);assert.deepEqual(property.required,['value','confidence','reason']);
   assert.deepEqual(property.properties.confidence,{type:'number'});assert.ok(property.properties.value.enum.length);
  }
 }
});

test('thinking precedes valid text; requests use structured format and Claude 5 low effort only',async()=>{
 await seed([entry('structured')]);
 for(const model of ['claude-haiku-5-5','claude-opus-5-5','claude-sonnet-4-5']){
  const result=await runCreativeScans(db,{...settings(),creativeScanModel:model},options({groupId:'structured',fetch:async(_,init)=>{
   const body=JSON.parse(String(init?.body));assert.equal(body.output_config.format.type,'json_schema');
   assert.equal(body.output_config.effort,model.includes('-5-5')?'low':undefined);
   for(const key of ['tool_choice','temperature','top_p','top_k'])assert.equal(key in body,false);
   assert.equal(body.max_tokens,1500);
   return Response.json({stop_reason:'end_turn',content:[{type:'thinking',thinking:'Invented ignored thought'},{type:'text',text:JSON.stringify({attributes})}],usage:{input_tokens:100,output_tokens:50}});
  }}));assert.equal(result.done,1);
 }
});

test('truncation, refusal category, absent text and dropped attributes persist shape without reply text',async t=>{
 t.mock.method(console,'error',()=>{});
 for(const [id,reply,code,reason,dropped] of [
  ['truncated',{stop_reason:'max_tokens',content:[{type:'text',text:'invented partial reply'}]},'max_tokens','malformed',0],
  ['refusal',{stop_reason:'refusal',stop_details:{category:'reasoning_extraction'},content:[{type:'text',text:'invented refusal'}]},'refusal reasoning_extraction','refused',0],
  ['no-text',{stop_reason:'end_turn',content:[{type:'thinking',thinking:'invented thought'}]},'no text','malformed',0],
  ['dropped',{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({attributes:{childInShot:{value:'invented-invalid',confidence:1,reason:'Invented evidence'}}})}]},'all dropped','malformed',1],
 ] as const){
  await db.query('TRUNCATE pulse.media_groups CASCADE');
  await seed([entry(id)]);
  await runCreativeScans(db,settings(),options({groupId:id,fetch:async()=>Response.json({...reply,usage:{input_tokens:20,output_tokens:1500}})}));
  const row=(await rows()).at(-1);assert.equal(row.failure_reason,reason);assert.equal(row.provider_code,code);assert.equal(row.raw_response,'');assert.equal(row.dropped_count,dropped);
  assert.match((await readScanHealth(db,settings(),options())).line,new RegExp(`${reason} \\(http 200, ${code}\\)`));
 }
});
