import assert from 'node:assert/strict';
import test from 'node:test';
import { greetingAt } from '../src/greeting.js';

test('greeting changes on the UK time boundaries in GMT and BST', () => {
  for (const [date, offset] of [['2026-01-12', '+00:00'], ['2026-07-12', '+01:00']] as const) {
    for (const [time, word] of [
      ['04:59', 'Evening'], ['05:00', 'Morning'], ['11:59', 'Morning'],
      ['12:00', 'Afternoon'], ['17:59', 'Afternoon'], ['18:00', 'Evening'], ['23:59', 'Evening'],
    ] as const) {
      assert.equal(greetingAt(new Date(`${date}T${time}:00${offset}`)), `${word}, Will.`, `${date} ${time} UK`);
    }
  }
});

test('greeting handles both sides of the UK clock changes without relying on the host timezone', () => {
  for (const now of ['2026-03-29T00:59:00Z', '2026-03-29T01:00:00Z', '2026-10-25T00:59:00Z', '2026-10-25T01:00:00Z']) {
    assert.equal(greetingAt(new Date(now)), 'Evening, Will.');
  }
  assert.equal(greetingAt(new Date('2026-03-29T04:00:00Z')), 'Morning, Will.');
  assert.equal(greetingAt(new Date('2026-10-25T05:00:00Z')), 'Morning, Will.');
});
