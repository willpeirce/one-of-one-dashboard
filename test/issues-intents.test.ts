import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyIssueTicket} from '../src/issues/intents.js';
import type {IssueReason, IssueTagRule} from '../src/issues/taxonomy.js';

const direct: [string, IssueReason][] = [
  ['Shipping::Delivered Not Received', 'lost parcel'],
  ['Order::Status', 'late delivery'],
  ['Shipping::Delay', 'late delivery'],
  ['Order::Damaged', 'damaged box'],
  ['Order::Wrong Item', 'wrong item'],
  ['Order::Missing Item', 'missing item'],
  ['Order::Refund', 'other'],
  ['Order::Payment', 'other'],
  ['Promotion & Discount::Issue', 'other'],
  ['Feedback::Negative', 'other'],
];
const excluded = [
  'Product::Availability', 'Product::Details', 'Product::Customization', 'Product::Usage',
  'Promotion & Discount::Information', 'Order::Cancel', 'Order::Edit', 'Order::Placement',
  'Shipping::Information', 'Shipping::Change Address', 'Feedback::Positive',
];

for (const [intent, reason] of direct) test(`intent ${intent} supplies its reason ahead of subject keywords`, () => {
  assert.deepEqual(classifyIssueTicket('The invented slab is scratched', [], intent, []), {reason, rank: 1});
  assert.deepEqual(classifyIssueTicket('New invented message', [], ` ${intent.toUpperCase().replaceAll(' ', '   ')} ::Discarded leaf`, []), {reason, rank: 1});
});

for (const intent of excluded) test(`intent ${intent} leaves out a question or request despite subject keywords`, () => {
  assert.equal(classifyIssueTicket('The invented slab is scratched', [], intent, []), null);
  assert.equal(classifyIssueTicket('The invented slab is scratched', [], intent.toUpperCase().replaceAll(' ', '   '), []), null);
});

test('Return, Exchange and Warranty families count as other for any valid second level', () => {
  for (const family of ['Return', 'Exchange', 'Warranty']) for (const second of ['Information', 'Invented Topic', 'Product & Item'])
    assert.deepEqual(classifyIssueTicket('The invented slab is scratched', [], `${family}::${second}`, []), {reason: 'other', rank: 1});
});

test('Wholesale, Marketing, Account, Subscription and Other families are excluded for any valid second level', () => {
  for (const family of ['Wholesale', 'Marketing', 'Account', 'Subscription', 'Other']) for (const second of ['Issue', 'Invented Topic', 'Product & Item'])
    assert.equal(classifyIssueTicket('The invented slab is scratched', [], `${family}::${second}`, []), null);
});

test('intent families and exact rows never match partial words or invalid levels', () => {
  for (const intent of ['Returns::Issue', 'Exchange policy::Issue', 'Warranty plan::Issue', 'Wholesaler::Issue',
    'Marketing plan::Issue', 'Accounts::Issue', 'Subscriptions::Issue', 'Others::Issue', 'Other::',
    'Product::Availability details', 'Order::Damaged item', 'Order::Damaged2', 'Order::Damaged\n'])
    assert.deepEqual(classifyIssueTicket('The invented slab is scratched', [], intent, []), {reason: 'scratched slab', rank: 0}, intent);
});

test('Quality Issues applies subject and tag keywords, retains intent rank, and falls back to other', () => {
  assert.deepEqual(classifyIssueTicket('The invented slab is scratched', [], 'Product::Quality Issues', []), {reason: 'scratched slab', rank: 1});
  assert.deepEqual(classifyIssueTicket('New invented message', ['markers dried'], 'Product::Quality Issues', []), {reason: 'markers dried or faulty', rank: 1});
  assert.deepEqual(classifyIssueTicket('New invented message', ['invented tag'], 'Product::Quality Issues', []), {reason: 'other', rank: 1});
  assert.deepEqual(classifyIssueTicket('New invented message', ['damaged box'], ' PRODUCT :: QUALITY   ISSUES ', []), {reason: 'damaged box', rank: 1});
});

test('the first mapped tag outranks direct intents, exclusions, Quality and other tags', () => {
  const rules: IssueTagRule[] = [{tag: ' invented_first ', reason: "QR won't register"}, {tag: 'invented_second', reason: 'missing slab'}];
  for (const intent of ['Order::Damaged', 'Product::Availability', 'Product::Quality Issues', 'Wholesale::Issue', null])
    assert.deepEqual(classifyIssueTicket('The invented slab is scratched', ['invented_second', 'INVENTED_FIRST'], intent, rules),
      {reason: "QR won't register", rank: 2});
});

test('unknown, absent and invalid intents preserve subject-only keyword fallback', () => {
  for (const intent of [undefined, null, 'Invented::Topic', 'Order::Invented Topic', 'not two levels', 'Order::Damaged<script>']) {
    assert.deepEqual(classifyIssueTicket('The invented box is crushed', ['missing slab'], intent, []), {reason: 'damaged box', rank: 0});
    assert.deepEqual(classifyIssueTicket('New invented message', ['missing slab'], intent, []), {reason: 'other', rank: 0});
  }
});
