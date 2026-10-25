import assert from 'node:assert/strict';
import test from 'node:test';
import { formatUkTime } from '../src/uk-time.js';
test('UK diagnostic times follow both clock changes with an explicit UK suffix',()=>{
 assert.equal(formatUkTime('2026-10-25T00:04:00Z'),'25 Oct 01:04 UK');
 assert.equal(formatUkTime('2026-10-25T01:04:00Z'),'25 Oct 01:04 UK');
 assert.equal(formatUkTime('2027-03-28T00:04:00Z'),'28 Mar 00:04 UK');
 assert.equal(formatUkTime('2027-03-28T01:04:00Z'),'28 Mar 02:04 UK');
});
