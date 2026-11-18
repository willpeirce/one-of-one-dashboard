import assert from 'node:assert/strict';
import {test} from 'node:test';
import {KIT_BODY_LIMIT, KIT_ROW_LIMIT, KIT_ORDER_LIMIT, parseKits, parseKitOrders} from '../src/kits/model.js';
import {sampleKitFacts} from '../src/kits/sample.js';
import {homeKits} from '../src/kits/presentation.js';

const kit = (id = 'box-a') => ({id, name: 'Box A', series: 'Invented collection', status: 'in flight', gate: 2,
  launch_target: '2032-08-14', launch_label: 'Invented launch', brief_due: '2032-05-01', milestone: 'Review the proof',
  next_action: 'Check the sample', owner: 'Will', with: 'the kit maker', waiting_since: '2032-04-01', note: 'Invented note'});
const order = (id = 'order-a') => ({id, kit: 'Box A', supplier: 'a supplier', item: 'Invented cartons', qty: 2400,
  date: '2032-04-02', eta: '2032-06-14', status: 'In production', ref: 'Must never be retained'});

test('kit files accept the two envelopes and retain only the explicit permitted fields', () => {
  for (const wrapped of [false, true]) {
    const kits = parseKits(JSON.stringify(wrapped ? {updated: '2032-04-07T13:00:00+01:00', rows: [kit()], ignored: 'drop'} : [kit()]));
    assert.equal(kits.readable, true); assert.equal(kits.rows.length, 1);
    assert.equal(kits.updatedAt, wrapped ? '2032-04-07T12:00:00.000Z' : null);
    assert.deepEqual(kits.rows[0], {id: 'box-a', name: 'Box A', series: 'Invented collection', status: 'in flight', gate: 2,
      launchTarget: '2032-08-14', launchLabel: 'Invented launch', briefDue: '2032-05-01', milestone: 'Review the proof',
      nextAction: 'Check the sample', owner: 'Will', with: 'the kit maker', waitingSince: '2032-04-01', note: 'Invented note'});
    const orders = parseKitOrders(JSON.stringify(wrapped ? {updated: '2032-04-07T12:00:00Z', rows: [order()]} : [order()]));
    assert.equal(orders.rows.length, 1); assert.equal(orders.rows[0]!.qty, 2400);
    assert.equal(JSON.stringify(orders).includes('ref'), false);
    assert.equal(JSON.stringify(orders).includes('Must never'), false);
  }
  const extra = parseKits(JSON.stringify([{...kit(), ref: 'Do not store', token: 'Do not store', arbitrary: {name: 'Do not store'}}]));
  assert.equal(JSON.stringify(extra).includes('Do not store'), false);
});

test('kit strings are trimmed, stripped of controls and capped in Unicode characters at each field bound', () => {
  const limits = {id: 40, name: 40, series: 80, status: 30, launch_label: 60, milestone: 120,
    next_action: 200, owner: 20, with: 120, note: 300};
  const input = {...kit(), ...Object.fromEntries(Object.keys(limits).map(key => [key, key === 'id' ? 'a'.repeat(45) : ` \0\t${'📦'.repeat(350)}\u007f `]))};
  const row = parseKits(JSON.stringify([input])).rows[0]!;
  const fields = {id: 'id', name: 'name', series: 'series', status: 'status', launch_label: 'launchLabel', milestone: 'milestone',
    next_action: 'nextAction', owner: 'owner', with: 'with', note: 'note'} as const;
  for (const [source, bound] of Object.entries(limits)) {
    const value = row[fields[source as keyof typeof fields]]!;
    assert.equal(Array.from(value).length, bound, source); assert.doesNotMatch(value, /[\x00-\x1f\x7f]/);
  }
  const storedOrder = parseKitOrders(JSON.stringify([{...order(), id: 'b'.repeat(45), kit: '📦'.repeat(50),
    supplier: '📦'.repeat(90), item: '📦'.repeat(170), status: '📦'.repeat(170)}])).rows[0]!;
  for (const [field, bound] of [['id', 40], ['kit', 40], ['supplier', 80], ['item', 160], ['status', 160]] as const)
    assert.equal(Array.from(storedOrder[field]).length, bound);
  assert.equal(parseKits(JSON.stringify([{...kit(), next_action: '  first\nsecond\u2028third  '}])).rows[0]!.nextAction, 'firstsecond third');
});

test('malformed rows are counted, duplicate ids keep the first, and only the first bounded valid rows survive', () => {
  const invalid = [null, [], 'text', {}, {...kit(), id: ''}, {...kit(), name: ' '}, {...kit(), gate: -1},
    {...kit(), gate: 7}, {...kit(), gate: 1.5}, {...kit(), gate: '2'}, {...kit(), id: '../other'}];
  const result = parseKits(JSON.stringify([...invalid, kit(), {...kit(), name: 'A replacement must not win'},
    ...Array.from({length: KIT_ROW_LIMIT + 2}, (_, index) => kit(`box-${index}`))]));
  assert.equal(result.readable, true); assert.equal(result.rows.length, KIT_ROW_LIMIT);
  assert.equal(result.skippedRows, invalid.length + 1); assert.equal(result.cappedRows, 3);
  assert.equal(result.rows[0]!.name, 'Box A'); assert.equal(result.rows.at(-1)!.id, 'box-38');
  const orders = parseKitOrders(JSON.stringify([null, [], {}, {...order(), id: ''}, {...order(), kit: ''}, order(), order(),
    ...Array.from({length: KIT_ORDER_LIMIT}, (_, index) => order(`order-${index}`))]));
  assert.equal(orders.rows.length, KIT_ORDER_LIMIT); assert.equal(orders.skippedRows, 6); assert.equal(orders.cappedRows, 1);
  const truncatedIds = parseKits(JSON.stringify([kit('a'.repeat(40) + 'b'), kit('a'.repeat(40) + 'c')]));
  assert.equal(truncatedIds.rows.length, 1); assert.equal(truncatedIds.skippedRows, 1, 'Identity uniqueness follows the stored capped id');
});

test('real dates and whole quantities remain; malformed dates and quantities become null', () => {
  for (const value of ['2032-02-30', '2031-02-29', '0000-01-01', '2032-4-07', 'not a date', null, 3]) {
    const row = parseKits(JSON.stringify([{...kit(), launch_target: value, brief_due: value, waiting_since: value}])).rows[0]!;
    assert.equal(row.launchTarget, null); assert.equal(row.briefDue, null); assert.equal(row.waitingSince, null);
    const storedOrder = parseKitOrders(JSON.stringify([{...order(), date: value, eta: value}])).rows[0]!;
    assert.equal(storedOrder.date, null); assert.equal(storedOrder.eta, null);
  }
  assert.equal(parseKits(JSON.stringify([{...kit(), launch_target: '2032-02-29'}])).rows[0]!.launchTarget, '2032-02-29');
  for (const qty of [0, 10_000_000, 12]) assert.equal(parseKitOrders(JSON.stringify([{...order(), qty}])).rows[0]!.qty, qty);
  for (const qty of [-1, 10_000_001, 1.5, '12', null]) assert.equal(parseKitOrders(JSON.stringify([{...order(), qty}])).rows[0]!.qty, null);
  for (const stamp of ['2032-02-30T12:00:00Z', '2032-04-07', '2032-04-07T25:00:00Z', 'unknown',
    '9999-12-31T23:00:00-23:00', '0001-01-01T00:00:00+23:00'])
    assert.equal(parseKits(JSON.stringify({updated: stamp, rows: [kit()]})).updatedAt, null);
});

test('a valid early ISO year stays readable without round-tripping an unpadded UK year', () => {
  const now = new Date('2032-04-07T12:00:00Z'), facts = sampleKitFacts(now);
  facts.kits.updatedAt = parseKits(JSON.stringify({updated: '0999-06-07T12:00:00Z', rows: []})).updatedAt;
  assert.equal(facts.kits.updatedAt, '0999-06-07T12:00:00.000Z');
  const projected = homeKits(facts, 'sample', now);
  assert.match(projected.summary!, /updated 7 Jun 999/); assert.equal(projected.stale, true);
});

test('bad JSON, wrong top-level shapes and over-256-KB UTF-8 bodies are unreadable', () => {
  for (const parse of [parseKits, parseKitOrders]) {
    for (const text of ['{', 'null', '42', '"text"', '{}', '{"rows":{}}']) assert.equal(parse(text).readable, false, text);
    assert.equal(parse('[]' + ' '.repeat(KIT_BODY_LIMIT - 2)).readable, true);
    assert.equal(parse('[]' + ' '.repeat(KIT_BODY_LIMIT - 1)).readable, false);
    assert.equal(parse(JSON.stringify({rows: [], ignored: '📦'.repeat(KIT_BODY_LIMIT / 4)})).readable, false);
  }
});

test('sample kit facts use six invented boxes and eight orders with five for Box B', () => {
  const now = new Date('2032-04-07T12:00:00Z'), facts = sampleKitFacts(now);
  assert.equal(facts.mode, 'sample'); assert.equal(facts.kits.status, 'ready');
  assert.deepEqual(facts.kits.rows.map(row => row.name), ['Box A', 'Box B', 'Box C', 'Box D', 'Box E', 'Box F']);
  assert.deepEqual(facts.kits.rows.slice(0, 3).map(row => row.gate), [5, 2, 1]);
  assert.equal(facts.kits.rows[1]!.with, 'the kit maker'); assert.equal(facts.kits.rows[1]!.waitingSince, '2032-04-01');
  assert.equal(facts.orders.rows.length, 8); assert.equal(facts.orders.rows.filter(row => row.kit === 'Box B').length, 5);
  assert.equal(facts.kits.readAt, now.toISOString());
});
