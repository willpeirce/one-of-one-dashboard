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
