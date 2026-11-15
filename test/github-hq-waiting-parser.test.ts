import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {parseWaiting} from '../src/github-hq/parse-waiting.js';
import {WAITING_CONTACT_LIMIT, WAITING_SUBJECT_LIMIT, WAITING_FILE_ROW_LIMIT} from '../src/waiting-on/model.js';

// Every name, date, order number and figure below is invented.
const prefix = '# Invented waiting on others\nUpdated: 2032-04-07 09:20 UK\n| Contact | Subject | Since |\n| --- | --- | --- |';
const row = (contact = 'A supplier', subject = 'Invented proof', since = '2032-04-01') => `| ${contact} | ${subject} | ${since} |`;

test('waiting table requires its heading, UK update label and three named columns, including a readable empty table', async () => {
  const parsed = parseWaiting(await readFile(new URL('./fixtures/github-hq/waiting-on.md', import.meta.url), 'utf8'));
  assert.deepEqual(parsed, {readable: true, updatedLabel: '2032-04-07 09:20 UK', skippedRows: 0, cappedRows: 0, rows: [
    {contact: 'A supplier', subject: 'Invented carton proof', since: '2032-03-30'},
    {contact: 'The freelancer', subject: 'Invented plan | next check', since: '2032-04-01'},
    {contact: 'Invented studio', subject: 'Confirm `green | violet` mockup', since: '2032-04-04'},
  ]});
  assert.deepEqual(parseWaiting(prefix), {...parsed, rows: []});
  assert.equal(parseWaiting(`\uFEFF\n\n${prefix.replaceAll('\n', '\r\n')}\r\n${row()}\r\n`).readable, true);
  assert.equal(parseWaiting(prefix.replaceAll('|', '').replace('Contact  Subject  Since', 'Contact | Subject | Since').replace('---  ---  ---', '--- | --- | ---')).readable, true);
  for (const invalid of [prefix.replace(/^# .+\n/, ''), prefix.replace('Updated:', 'Refreshed:'), prefix.replace(' UK', ' UTC'),
    prefix.replace('2032-04-07', '2032-02-30'), prefix.replace('09:20', '24:00'), prefix.replace('09:20', '09:60'),
    prefix.replace('Contact | Subject', 'Subject | Contact'), prefix.replace('| --- | --- | --- |', '| -- | --- | --- |')])
    assert.deepEqual(parseWaiting(invalid), {readable: false, updatedLabel: null, rows: [], skippedRows: 0, cappedRows: 0});
});

test('waiting pipes distinguish escaped text, matched backtick runs and an unmatched backtick', () => {
  const parsed = parseWaiting(`${prefix}\n${row('A supplier', String.raw`Outside A\|B and \`inside C\|D\``.replaceAll('\\`', '`'))}\n`
    + `${row('The freelancer', 'Use ``a ` | b`` on the proof')}\n${row('Invented studio', 'An unmatched ` still has three cells')}`);
  assert.equal(parsed.readable, true); assert.equal(parsed.skippedRows, 0);
  assert.deepEqual(parsed.rows.map(value => value.subject), [String.raw`Outside A|B and \`inside C\|D\``.replaceAll('\\`', '`'),
    'Use ``a ` | b`` on the proof', 'An unmatched ` still has three cells']);
  const broken = parseWaiting(`${prefix}\n| A supplier | unmatched \` one | extra | 2032-04-01 |\n${row()}`);
  assert.equal(broken.rows.length, 1); assert.equal(broken.skippedRows, 1);
});

test('waiting rows skip malformed dates, columns, empty and oversized text without retaining those values', () => {
  const invalid = [row('', 'Invented question'), row('A supplier', ''), row('A supplier', 'Invented question', '2032-02-30'),
    row('A supplier', 'Invented question', '2032-4-01'), '| A supplier | Missing since |', '| A supplier | Subject | 2032-04-01 | Extra |',
    row('𐐀'.repeat(WAITING_CONTACT_LIMIT + 1)), row('A supplier', '𐐀'.repeat(WAITING_SUBJECT_LIMIT + 1))];
  const result = parseWaiting(`${prefix}\n${invalid.join('\n')}\n${row('𐐀'.repeat(WAITING_CONTACT_LIMIT), '𐐀'.repeat(WAITING_SUBJECT_LIMIT))}`);
  assert.equal(result.readable, true); assert.equal(result.skippedRows, invalid.length); assert.equal(result.rows.length, 1);
  assert.equal(Array.from(result.rows[0]!.contact).length, WAITING_CONTACT_LIMIT);
  assert.equal(Array.from(result.rows[0]!.subject).length, WAITING_SUBJECT_LIMIT);
  assert.doesNotMatch(JSON.stringify(result), /Missing since|Extra|2032-02-30/);
});

test('waiting cap follows the first sixty valid rows in file order, while all later malformed or duplicate rows are counted', () => {
  const rows = Array.from({length: WAITING_FILE_ROW_LIMIT + 3}, (_, index) => row(`Invented contact ${index}`, `Invented subject ${index}`));
  rows.splice(2, 0, '| malformed |');
  const result = parseWaiting(`${prefix}\n${rows.join('\n')}\n${rows[0]}\n${row('A supplier', 'Invalid date after the cap', 'not-a-date')}`);
  assert.equal(result.readable, true); assert.equal(result.rows.length, WAITING_FILE_ROW_LIMIT);
  assert.deepEqual(result.rows.map(value => value.contact), Array.from({length: 60}, (_, index) => `Invented contact ${index}`));
  assert.equal(result.cappedRows, 3); assert.equal(result.skippedRows, 3);
});

test('waiting rejects a second table or section rather than treating a changed file as a clean deletion', () => {
  for (const tail of [`\n${prefix}\n${row('The freelancer')}`, `\n\n${row('The freelancer')}`, '\n## Another section\nOther content']) {
    const result = parseWaiting(`${prefix}\n${row()}${tail}`);
    assert.equal(result.readable, false); assert.deepEqual(result.rows, []);
  }
});

test('waiting parser and manual text safety reject obvious private patterns but preserve order references', () => {
  const privateText = ['person@invented.example', '+44 7700 900123', '(555) 016-9021', 'AB1 2CD', 'https://invented.example/private',
    '12 Invented Street', 'private\u0000value'];
  const text = `${prefix}\n${privateText.flatMap(value => [row(value), row('A supplier', value)]).join('\n')}\n${row('A supplier', 'Invented order 12345678 proof')}`;
  const result = parseWaiting(text);
  assert.equal(result.skippedRows, privateText.length * 2); assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.subject, 'Invented order 12345678 proof');
  for (const value of privateText) assert.ok(!JSON.stringify(result).includes(value));
});
