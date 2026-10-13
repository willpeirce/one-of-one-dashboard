import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { addDays } from '../src/hero-range.js';
import { defaultSettings } from '../src/settings.js';
import { syncSourceHealth } from '../src/sources.js';
import { ShopifyError } from '../src/shopify/http.js';
import { shopifyHero } from '../src/shopify/metrics.js';
import { SampleShopify } from '../src/shopify/sample.js';
import { ShopifyWorker } from '../src/shopify/worker.js';
import { createTestDatabase } from './helpers/database.js';

type Block = { from: string; to: string };
type GrossState = {
  first: string;
  last: string;
  next: string;
  filled: Block[];
  skipped: Block[];
  logged: Block[];
  retry: (Block & { count: number }) | null;
  idle: boolean;
  outcome: 'filled' | 'retry' | 'skipped' | 'idle';
};
const empty = () => ({ columns: [], rows: [] });
const columns = (names = ['day', 'orders', 'net_sales', 'total_sales']) =>
  names.map(name => ({ name, dataType: name === 'day' ? 'DATE' : 'DECIMAL', displayName: name }));
const block = (from: string, to: string): Block => ({ from, to });

class GrossReader extends SampleShopify {
  reads: Block[] = [];
  reply: (range: Block) => Promise<unknown> = async () => empty();
  override async report(query: string): Promise<any> {
    assert.match(query, /^FROM sales SHOW orders, net_sales, total_sales GROUP BY day /);
    const from = /SINCE (\d{4}-\d{2}-\d{2})/.exec(query)?.[1],
      to = /UNTIL (\d{4}-\d{2}-\d{2})/.exec(query)?.[1];
    assert.ok(from && to);
    const range = block(from, to);
    this.reads.push(range);
    return this.reply(range);
  }
}

async function harness(t: TestContext, olderFrom = '2026-09-01', olderTo = '2026-09-14') {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const env = { SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() },
    reader = new GrossReader();
  let clock = new Date('2026-10-12T12:00:00Z');
  const workers: ShopifyWorker[] = [];
  function makeWorker() {
    const value = new ShopifyWorker(db, env, 'https://pulse.example.test', {
      reader, clock: () => clock, sleep: async () => {},
    });
    workers.push(value);
    return value;
  }
  let worker = makeWorker();
  t.after(async () => { for (const value of workers) await value.stop(); });
  await syncSourceHealth(db, env);
  await db.query("UPDATE pulse.source_health SET status='healthy',last_attempt_at=$1,last_success_at=$1,consecutive_failures=0 WHERE source='shopify'", [clock]);
  await worker.initialize();
  await db.query("UPDATE pulse.shopify_jobs SET next_run_at='9999-01-01' WHERE mode='live' AND name <> 'gross_history'");
  await db.query("UPDATE pulse.shopify_jobs SET state=$1 WHERE mode='live' AND name='backfill'", [JSON.stringify({
    from: '2026-09-25', olderFrom, olderTo, allOrders: false, ordersDone: true, historyDone: true,
  })]);
  return {
    db, reader,
    now: () => new Date(clock),
    tick: () => worker.tick(),
    async runDue() {
      const row = (await db.query<{ next_run_at: Date }>("SELECT next_run_at FROM pulse.shopify_jobs WHERE mode='live' AND name='gross_history'")).rows[0]!;
      clock = new Date(row.next_run_at);
      await worker.tick();
    },
    async restart() { await worker.stop(); worker = makeWorker(); await worker.initialize(); },
    async job() {
      return (await db.query<{ state: GrossState; next_run_at: Date; failures: number }>("SELECT state,next_run_at,failures FROM pulse.shopify_jobs WHERE mode='live' AND name='gross_history'")).rows[0]!;
    },
    async reset(state: unknown = {}) {
      await db.query("UPDATE pulse.shopify_jobs SET state=$1,next_run_at=$2,failures=0 WHERE mode='live' AND name='gross_history'", [JSON.stringify(state), clock]);
    },
    async sales(day: string, values: Record<string, unknown> = {}, mode = 'live') {
      const data: Record<string, unknown> = { day, orders: 0, netSalesPence: 0, provenance: 'shopifyql', market: 'unknown', ...values };
      await db.query(`INSERT INTO pulse.shopify_records(mode,kind,source_id,data,fetched_at,source_updated_at)
        VALUES($1,'sales',$2,$3,$4,$4) ON CONFLICT(mode,kind,source_id) DO UPDATE SET data=EXCLUDED.data`, [mode, day, JSON.stringify(data), clock]);
      return data;
    },
    async order(day: string, id = `invented-order-${day}`, mode = 'live') {
      await db.query("INSERT INTO pulse.shopify_records(mode,kind,source_id,data,fetched_at,source_updated_at) VALUES($1,'order',$2,$3,$4,$4)", [mode, id, JSON.stringify({ day, id }), clock]);
    },
    async saved() {
      return (await db.query<{ source_id: string; data: Record<string, unknown> }>("SELECT source_id,data FROM pulse.shopify_records WHERE mode='live' AND kind='sales' ORDER BY source_id")).rows;
    },
    async health() {
      return (await db.query("SELECT status,last_attempt_at,last_success_at,consecutive_failures,updated_at FROM pulse.source_health WHERE source='shopify'")).rows[0]!;
    },
    async hero(day = '2026-09-01') {
      return shopifyHero(await worker.store.facts(clock), clock.toISOString().slice(0, 10), day, day, defaultSettings());
    },
  };
}

function captureLogs(t: TestContext) {
  const logs: string[] = [];
  for (const method of ['error', 'warn', 'info'] as const)
    t.mock.method(console, method, (...parts: unknown[]) => { logs.push(parts.map(String).join(' ')); });
  return logs;
}

test('an exact empty report fills seven measured zero days and falls back to olderFrom without sales evidence', async t => {
  const h = await harness(t), health = await h.health();
  await h.tick();
  assert.deepEqual(h.reader.reads, [block('2026-09-01', '2026-09-07')]);
  const rows = await h.saved();
  assert.equal(rows.length, 7);
  for (let index = 0; index < 7; index++) assert.deepEqual(rows[index]!.data, {
    day: addDays('2026-09-01', index), orders: 0, netSalesPence: 0, grossSalesPence: 0,
    provenance: 'shopifyql', market: 'unknown',
  });
  const job = await h.job();
  assert.equal(job.state.first, '2026-09-01'); assert.equal(job.state.last, '2026-09-14');
  assert.equal(job.state.next, '2026-09-08'); assert.equal(job.state.outcome, 'filled');
  assert.equal(job.state.idle, false); assert.deepEqual(job.state.filled, [block('2026-09-01', '2026-09-07')]);
  assert.equal(new Date(job.next_run_at).getTime() - h.now().getTime(), 60_000);
  assert.deepEqual(await h.health(), health);
});

test('earliest live order evidence sets the first block and leaves all earlier cached days untouched', async t => {
  const h = await harness(t, '2026-09-01', '2026-09-20');
  const before = await h.sales('2026-09-01', { grossSalesPence: 0, marker: 'invented cached zero' });
  await h.sales('2026-09-03', { grossSalesPence: 0 });
  await h.order('2026-08-01', 'invented-sample-order', 'sample');
  await h.order('2026-09-08'); await h.order('2026-09-04');
  await h.tick();
  assert.deepEqual(h.reader.reads, [block('2026-09-04', '2026-09-10')]);
  assert.equal((await h.job()).state.first, '2026-09-04');
  assert.deepEqual((await h.saved()).find(row => row.source_id === '2026-09-01')!.data, before);
  assert.equal((await h.saved()).find(row => row.source_id === '2026-09-03')!.data.grossSalesPence, 0);
});

test('each nonzero stored sales measure supplies earlier evidence and that startup boundary survives zero fills and restart', async t => {
  for (const values of [{ netSalesPence: -135 }, { orders: 1 }, { grossSalesPence: 245 }]) {
    await t.test(Object.keys(values)[0]!, async sub => {
      const h = await harness(sub, '2026-09-01', '2026-09-17');
      const before = await h.sales('2026-09-01', { grossSalesPence: 0 });
      await h.sales('2026-09-03', values); await h.order('2026-09-05');
      await h.tick();
      assert.deepEqual(h.reader.reads, [block('2026-09-03', '2026-09-09')]);
      assert.equal((await h.job()).state.first, '2026-09-03');
      assert.deepEqual((await h.saved())[0]!.data, before);
      await h.restart(); await h.runDue();
      assert.deepEqual(h.reader.reads[1], block('2026-09-10', '2026-09-16'));
      assert.equal((await h.job()).state.first, '2026-09-03');
    });
  }
});

test('evidence is clamped to olderFrom and legacy next-only cursors align to the new block boundary', async t => {
  await t.test('earlier evidence', async sub => {
    const h = await harness(sub);
    await h.order('2026-08-28'); await h.tick();
    assert.equal((await h.job()).state.first, '2026-09-01');
    assert.deepEqual(h.reader.reads[0], block('2026-09-01', '2026-09-07'));
  });
  for (const next of ['2026-08-20', '2026-09-09']) {
    await t.test(`legacy cursor ${next}`, async sub => {
      const h = await harness(sub, '2026-09-01', '2026-09-20');
      await h.order('2026-09-04'); await h.reset({ next }); await h.tick();
      assert.deepEqual(h.reader.reads[0], block('2026-09-04', '2026-09-10'));
      assert.equal((await h.job()).state.next, '2026-09-11');
    });
  }
});

test('a populated report uses its named columns, stores exact values and zero-fills only its block', async t => {
  const h = await harness(t), names = ['total_sales', 'day', 'net_sales', 'orders', 'invented_extra'];
  const before = await h.sales('2026-08-31', { netSalesPence: 310, orders: 1, grossSalesPence: 380 });
  h.reader.reply = async () => ({ columns: columns(names), rows: [['18.50', '2026-09-01', '12.30', '2', 'invented']] });
  await h.tick();
  const rows = await h.saved(), actual = rows.find(row => row.source_id === '2026-09-01')!.data;
  assert.equal(actual.grossSalesPence, 1850); assert.equal(actual.netSalesPence, 1230); assert.equal(actual.orders, 2);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0]!.data, before);
  assert.ok(rows.filter(row => row.source_id > '2026-09-01').every(row => row.data.grossSalesPence === 0));
  assert.equal((await h.job()).state.next, '2026-09-08');
});

test('malformed empty schemas and invalid populated values retry silently without changing cached money', async t => {
  const h = await harness(t), logs = captureLogs(t);
  const original = await h.sales('2026-09-01', { orders: 3, netSalesPence: 2700, grossSalesPence: 3280 });
  const cases = [
    { columns: columns(['day', 'orders', 'net_sales']), rows: [] },
    { columns: columns(['day', 'orders', 'net_sales']), rows: [['2026-09-01', 1, '12.00']] },
    { columns: null, rows: [] },
    { columns: [], rows: [['2026-09-01', 1, '12.00', '14.40']] },
    { columns: columns(), rows: null },
    { columns: columns(), rows: [['2026-09-01', 1, '12.00', '14.40'], ['2026-09-02', 1, 'invalid', '14.40']] },
    ...[
      ['2026-09-01', 1, 'invalid', '14.40'],
      ['2026-09-01', 1, '12.00'],
      ['2026-09-01', 1, '12.00', null],
      ['2026-09-01', -1, '12.00', '14.40'],
      ['2026-09-01', 1.5, '12.00', '14.40'],
      ['2026-09-01', null, '12.00', '14.40'],
      ['2026-09-31', 1, '12.00', '14.40'],
      ['2026-10-01', 1, '12.00', '14.40'],
    ].map(row => ({ columns: columns(), rows: [row] })),
  ];
  for (const table of cases) {
    await h.reset(); h.reader.reply = async () => table; await h.tick();
    const job = await h.job();
    assert.equal(job.state.outcome, 'retry'); assert.equal(job.state.next, '2026-09-01');
    assert.deepEqual(job.state.retry, { from: '2026-09-01', to: '2026-09-07', count: 1 });
    assert.equal(new Date(job.next_run_at).getTime() - h.now().getTime(), 60_000);
    assert.deepEqual((await h.saved()).map(row => row.data), [original]);
    assert.deepEqual(logs, []);
  }
});

test('all errors count across restarts, skip on the third minute, preserve net/orders and never change source health', async t => {
  const h = await harness(t), logs = captureLogs(t), health = await h.health();
  const cached = await h.sales('2026-09-01', { orders: 2, netSalesPence: 4100, grossSalesPence: 4920, marker: 'invented retained data' });
  const withoutGross = await h.sales('2026-09-02', { orders: 1, netSalesPence: 1500 });
  const heroBefore = await h.hero();
  assert.equal(heroBefore.gross, 49.20); assert.equal(heroBefore.grossUnavailable, false);
  assert.equal(heroBefore.net.n, 41); assert.equal(heroBefore.net.unavailable, undefined);
  const errors = [new Error('invented-private-one'), new ShopifyError('denied'), new Error('invented-private-three')];
  h.reader.reply = async () => { throw errors.shift()!; };
  for (let count = 1; count <= 3; count++) {
    if (count === 1) await h.tick(); else { await h.restart(); await h.runDue(); }
    const job = await h.job();
    assert.equal(new Date(job.next_run_at).getTime() - h.now().getTime(), 60_000);
    assert.deepEqual(await h.health(), health);
    if (count < 3) {
      assert.equal(job.state.outcome, 'retry'); assert.equal(job.state.next, '2026-09-01');
      assert.equal(job.state.retry?.count, count); assert.deepEqual(logs, []);
      assert.deepEqual((await h.saved()).map(row => row.data), [cached, withoutGross]);
      assert.equal((await h.hero()).grossUnavailable, false);
    } else {
      assert.equal(job.state.outcome, 'skipped'); assert.equal(job.state.next, '2026-09-08');
      assert.equal(job.state.retry, null); assert.equal(job.state.idle, false);
      assert.deepEqual(job.state.skipped, [block('2026-09-01', '2026-09-07')]);
      assert.deepEqual(job.state.logged, [block('2026-09-01', '2026-09-07')]);
      const { grossSalesPence: _gross, ...retained } = cached;
      assert.deepEqual((await h.saved()).map(row => row.data), [retained, withoutGross]);
      assert.equal(logs.length, 1); assert.match(logs[0]!, /2026-09-01.*2026-09-07/);
      assert.doesNotMatch(logs[0]!, /invented-private|denied|unknown|invalid|http/i);
      const heroAfter = await h.hero();
      assert.equal(heroAfter.grossUnavailable, true);
      assert.equal(heroAfter.net.n, heroBefore.net.n); assert.equal(heroAfter.net.unavailable, heroBefore.net.unavailable);
      assert.equal(heroAfter.orders.n, heroBefore.orders.n); assert.equal(heroAfter.orders.unavailable, heroBefore.orders.unavailable);
    }
  }
  assert.deepEqual(h.reader.reads, Array.from({ length: 3 }, () => block('2026-09-01', '2026-09-07')));
});

test('three failed refreshes remove a previously filled block and clear only its cached Gross', async t => {
  const h = await harness(t), logs = captureLogs(t),
    first = block('2026-09-01', '2026-09-07'), later = block('2026-09-08', '2026-09-14');
  const cached = await h.sales('2026-09-01', { orders: 2, netSalesPence: 4300, grossSalesPence: 5200, marker: 'invented retained data' });
  const otherBlock = await h.sales('2026-09-08', { orders: 1, netSalesPence: 1800, grossSalesPence: 2200 });
  await h.reset({ first: first.from, last: later.to, next: first.from,
    filled: [first, later], skipped: [], logged: [], retry: null, idle: false, outcome: 'filled' });
  h.reader.reply = async () => { throw new Error('invented-private-refresh-error'); };
  await h.tick(); await h.runDue();
  assert.deepEqual((await h.job()).state.filled, [first, later]);
  assert.deepEqual((await h.saved()).map(row => row.data), [cached, otherBlock]);
  assert.deepEqual(logs, []);
  await h.restart(); await h.runDue();
  const state = (await h.job()).state;
  assert.equal(state.outcome, 'skipped'); assert.equal(state.next, later.from); assert.equal(state.retry, null);
  assert.deepEqual(state.filled, [later]); assert.deepEqual(state.skipped, [first]); assert.deepEqual(state.logged, [first]);
  const { grossSalesPence: _gross, ...retained } = cached;
  assert.deepEqual((await h.saved()).map(row => row.data), [retained, otherBlock]);
  assert.equal(logs.length, 1); assert.match(logs[0]!, /2026-09-01.*2026-09-07/);
  assert.doesNotMatch(logs[0]!, /invented-private-refresh-error/);
});

test('a skipped block cannot starve later fills; idle rotation retries it and keeps unique block records and one safe log', async t => {
  const h = await harness(t), logs = captureLogs(t);
  let failFirst = true;
  h.reader.reply = async range => {
    if (failFirst && range.from === '2026-09-01') throw new ShopifyError('denied');
    return empty();
  };
  await h.tick(); await h.runDue(); await h.runDue();
  assert.equal((await h.job()).state.next, '2026-09-08');
  await h.runDue();
  let state = (await h.job()).state;
  assert.equal(state.next, '2026-09-15'); assert.equal(state.idle, false); assert.equal(state.outcome, 'filled');
  assert.deepEqual(state.filled, [block('2026-09-08', '2026-09-14')]);
  assert.equal((await h.saved()).length, 7);
  const reads = h.reader.reads.length;
  await h.runDue();
  assert.equal(h.reader.reads.length, reads, 'finishing a pass performs no extra report read');
  state = (await h.job()).state;
  assert.equal(state.idle, true); assert.equal(state.outcome, 'idle'); assert.equal(state.next, state.first);
  assert.equal(new Date((await h.job()).next_run_at).getTime() - h.now().getTime(), 3_600_000);
  await h.restart(); await h.runDue(); await h.runDue(); await h.runDue();
  state = (await h.job()).state;
  assert.equal(state.outcome, 'skipped'); assert.equal(state.skipped.length, 1); assert.equal(state.logged.length, 1);
  assert.equal(logs.length, 1, 'the same failed date block is logged once across passes and restart');
  await h.runDue(); await h.runDue();
  assert.equal((await h.job()).state.filled.length, 1, 'a repeated successful block does not create duplicate records');
  await h.runDue();
  assert.equal((await h.job()).state.retry?.count, 1);
  failFirst = false;
  await h.runDue();
  state = (await h.job()).state;
  assert.equal(state.outcome, 'filled'); assert.deepEqual(state.skipped, []); assert.equal(state.retry, null);
  assert.deepEqual([...state.filled].sort((a, b) => a.from.localeCompare(b.from)), [
    block('2026-09-01', '2026-09-07'), block('2026-09-08', '2026-09-14'),
  ], 'adjacent date blocks remain distinct');
  assert.equal((await h.saved()).length, 14); assert.equal(logs.length, 1);
});
