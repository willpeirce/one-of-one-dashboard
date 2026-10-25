import assert from 'node:assert/strict';
import test from 'node:test';
import { hourlyOrders, type Facts } from '../src/shopify/metrics.js';
import { cleanOrder } from '../src/shopify/model.js';
import { fixture } from '../src/shopify/sample.js';
import { hourlyTop, monotoneSegments } from '../src/hourly-orders.js';

test('UK autumn repeated hours combine, spring missing hour is zero, and readiness needs yesterday', async () => {
  const base = cleanOrder((await fixture('order')).data.order);
  for (const [day, times, expected] of [
    ['2026-10-25', ['00:15', '01:15', '02:15'], [0, 2, 1, 0]],
    ['2027-03-28', ['00:15', '01:15', '02:15'], [1, 0, 1, 1]],
  ] as const) {
    const facts: Facts = { mode: 'live', sample: false, counts: {}, pendingWebhooks: 0, geoNotice: null, notices: [], noticeDetails: [],
      jobs: [{ name: 'backfill', state: { from: '2026-01-01', ordersDone: true }, last_success_at: null, failures: 0 },
        { name: 'poll', state: {}, last_success_at: new Date(`${day}T12:00:00Z`), failures: 0 }],
      records: times.map(time => ({ kind: 'order', data: { ...base, day, createdAt: `${day}T${time}:00Z`, tags: [] }, fetched_at: new Date() })) };
    assert.deepEqual(hourlyOrders(facts, day).today.slice(0, 4), expected);
    facts.jobs[0]!.state.ordersDone = false;
    assert.equal(hourlyOrders(facts, day).ready, false);
    facts.jobs[0]!.state = { from: day, ordersDone: true };
    assert.equal(hourlyOrders(facts, day).ready, false);
  }
});

test('hourly scale has integer ticks and monotone interpolation cannot overshoot or go negative', () => {
  for (const max of [0, 1, 2, 3, 9, 17, 101]) {
    const top = hourlyTop([max]); assert.ok(top >= Math.max(2, max)); assert.equal(top / 2 % 1, 0);
  }
  for (const values of [[0, 8, 0, 1, 0], [4, 4, 1, 2, 9], [0, 0, 0]]) {
    monotoneSegments(values, i => i, n => n).forEach((segment, i) => {
      const numbers = segment.slice(1).split(' ').map(Number), a = values[i]!, b = values[i + 1]!;
      for (let t = 0; t <= 1; t += 0.01) {
        const value = (1-t)**3*a + 3*(1-t)**2*t*numbers[1]! + 3*(1-t)*t*t*numbers[3]! + t**3*b;
        assert.ok(value >= Math.min(a,b)-1e-9 && value <= Math.max(a,b)+1e-9);
      }
    });
  }
});
