import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyIssue} from '../src/issues/keywords.js';

test('lost parcels include non-receipt wording, both apostrophes and each delivery noun', () => {
  const phrases = ['never received', 'not received', "haven't received", 'haven’t received', "didn't receive", 'didn’t receive',
    'never got', 'not got', "haven't got", 'haven’t got', "didn't get", 'didn’t get', "didn't got", 'didn’t got'];
  for (const phrase of phrases) for (const noun of ['parcel', 'package', 'order', 'delivery', 'shipment', 'kit', 'item'])
    assert.equal(classifyIssue(`I ${phrase} the invented ${noun}.`), 'lost parcel', `${phrase}: ${noun}`);
  assert.equal(classifyIssue('I HAVE NOT RECEIVED MY INVENTED KIT.'), 'lost parcel');
  assert.equal(classifyIssue('I have not received\nmy invented items.'), 'lost parcel');
});

test('the delivery noun must follow within thirty-five characters and be a whole word', () => {
  assert.equal(classifyIssue(`I never received ${'x'.repeat(33)} parcel.`), 'lost parcel', 'Two spaces plus thirty-three characters is the limit');
  assert.equal(classifyIssue(`I never received ${'x'.repeat(34)} parcel.`), 'other');
  for (const noun of ['parcelled', 'packaged', 'orderly', 'delivering', 'shipmentless', 'kitchen', 'itemized'])
    assert.equal(classifyIssue(`I never received the ${noun}.`), 'other', noun);
  assert.equal(classifyIssue('The invented kit: I never received it.'), 'other', 'This rule requires the delivery noun after the phrase');
});

test('missing replies and emails do not become lost-parcel cases', () => {
  for (const text of ['I never received a reply.', 'I have not received an email.', "I haven't received a reply.",
    'I haven’t received an email.', "I didn't receive a reply.", 'I didn’t receive an email.', 'I never got a reply.',
    "I haven't got an email.", 'I didn’t get a reply.', 'I received the invented kit.', 'The invented parcel was received.'])
    assert.equal(classifyIssue(text), 'other', text);
});

test('non-receipt excludes the supplied refund, correspondence, kit-part and partial-item phrases', () => {
  for (const text of ["haven't received my refund for the order", 'not received a reply about my order',
    "didn't receive confirmation of my order", 'not received tracking for my order', "we didn't get the markers in our kit",
    "haven't got the stickers for the kit", "haven't got the slabs in my kit", 'I have not received one item from my order'])
    assert.equal(classifyIssue(text), 'other', text);
  for (const text of ['never received the package', 'I haven’t received my order yet', "didn't get my kit"])
    assert.equal(classifyIssue(text), 'lost parcel', text);
});

test('each intervening correspondence word or singular/plural kit part blocks only the new non-receipt pattern', () => {
  const words = ['refund', 'refunds', 'reply', 'replies', 'response', 'responses', 'answer', 'answers', 'email', 'emails',
    'confirmation', 'confirmations', 'tracking', 'update', 'updates',
    ...['marker', 'pen', 'slab', 'sticker', 'card', 'cap', 'piece', 'part', 'refill'].flatMap(word => [word, `${word}s`])];
  for (const word of words) {
    const text = `I haven't received the ${word} for my order.`;
    assert.equal(classifyIssue(text), 'other', word);
  }
  assert.equal(classifyIssue('I HAVEN’T RECEIVED A RESPONSE ABOUT MY ORDER.'), 'other');
  assert.equal(classifyIssue('I have not received the updated package.'), 'lost parcel', 'Blockers are whole words');
  assert.equal(classifyIssue('I have not received the markerless kit.'), 'lost parcel');
  assert.equal(classifyIssue('Never received the package; a refund is next.'), 'lost parcel', 'Only words before the delivery noun block');
});

test('count words directly before item or items cannot be bypassed by a later delivery noun', () => {
  for (const count of ['one', 'two', 'three', 'some', 'any', 'a few', 'all']) for (const noun of ['item', 'items']) {
    const text = `I have not received ${count} ${noun} from my order.`;
    assert.equal(classifyIssue(text), 'other', text);
  }
  assert.equal(classifyIssue('I have not received a\nfew items from my order.'), 'other');
  assert.equal(classifyIssue('I have not received any of the items.'), 'lost parcel', 'The count must sit directly before item/items');
  assert.equal(classifyIssue('I have not received one package.'), 'lost parcel', 'Count exclusion applies only to item/items');
});

test('blocked non-receipt phrases fall through without altering other issue patterns', () => {
  assert.equal(classifyIssue('Not received a reply about a delayed parcel.'), 'late delivery');
  assert.equal(classifyIssue("We didn't get the markers in our kit; markers dried."), 'markers dried or faulty');
  assert.equal(classifyIssue("Haven't got the stickers for the kit; item missing."), 'missing item');
  assert.equal(classifyIssue('Not received a reply; the parcel is missing.'), 'lost parcel', 'The existing lost-parcel patterns still apply');
});
