import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {ISSUE_REASONS, ISSUE_TAG_LIMIT, type IssueTagRule} from '../src/issues/taxonomy.js';
import {defaultSettings, readSettings, saveSettings, validateSettings, SettingsValidationError} from '../src/settings.js';
import {settingsPage} from '../src/settings-view.js';
import {createTestDatabase} from './helpers/database.js';

test('the Gorgias issue tag map defaults empty and accepts only its bounded, unique taxonomy rows', () => {
  const defaults = defaultSettings();
  assert.deepEqual(defaults.gorgiasIssueTags, []);
  const allReasons = ISSUE_REASONS.map((reason, index) => ({tag: ` Invented tag ${index + 1} `, reason}));
  assert.deepEqual(validateSettings({...defaults, gorgiasIssueTags: allReasons}).gorgiasIssueTags,
    allReasons.map(row => ({...row, tag: row.tag.trim()})));
  const full = Array.from({length: ISSUE_TAG_LIMIT}, (_, index): IssueTagRule => ({tag: `Invented tag ${index + 1}`, reason: 'other'}));
  assert.equal(validateSettings({...defaults, gorgiasIssueTags: full}).gorgiasIssueTags.length, 40);
  assert.equal(validateSettings({...defaults, gorgiasIssueTags: [{tag: 'x'.repeat(80), reason: 'other'}]}).gorgiasIssueTags[0]!.tag.length, 80);
  for (const value of [undefined, null, {}, 'invented_tag', false, [...full, {tag: 'Invented overflow', reason: 'other'}],
    [null], [{}], [{tag: 'invented'}], [{reason: 'other'}], [{tag: 'invented', reason: 'other', note: 'not allowed'}],
    [{tag: 'Invented', reason: 'other'}, {tag: ' invented ', reason: 'missing item'}],
    [{tag: '', reason: 'other'}], [{tag: '   ', reason: 'other'}], [{tag: 42, reason: 'other'}],
    [{tag: 'x'.repeat(81), reason: 'other'}], [{tag: 'invented\nlabel', reason: 'other'}],
    [{tag: 'invented\u0000label', reason: 'other'}], [{tag: 'invented\u0085label', reason: 'other'}],
    [{tag: 'invented\u2028label', reason: 'other'}], [{tag: 'invented', reason: 'unknown reason'}],
    [{tag: 'invented', reason: 'Missing item'}], [{tag: 'invented', reason: null}]]) {
    assert.throws(() => validateSettings({...defaults, gorgiasIssueTags: value}),
      (error: unknown) => error instanceof SettingsValidationError && error.fields[0]!.startsWith('gorgiasIssueTags'));
  }
  assert.throws(() => validateSettings({...defaults, gorgiasIssueTagsExtra: []}), SettingsValidationError);
});

test('old stored Settings acquire an empty issue tag map without any write, version change or audit', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const initial = await readSettings(db), {gorgiasIssueTags: _map, ...older} = initial.values;
  await db.query('UPDATE pulse.settings SET values=$1', [JSON.stringify(older)]);
  const before = (await db.query('SELECT * FROM pulse.settings')).rows;
  assert.deepEqual(await readSettings(db), initial);
  assert.deepEqual((await db.query('SELECT * FROM pulse.settings')).rows, before);
  assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 0);
  assert.equal((await db.query('SELECT 1 FROM pulse.settings_changes')).rowCount, 0);
});

test('the additive issue-map audit CHECK permits only the new key and replay preserves saved mappings', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const initial = await readSettings(db), values = {...initial.values,
    gorgiasIssueTags: [{tag: 'invented_slab_mark', reason: 'scratched slab' as const}]};
  const saved = await saveSettings(db, {version: initial.version, values}, 'invented-issue-device');
  assert.deepEqual(saved.changedFields.slice().sort(), ['gorgiasIssueTags.0.reason', 'gorgiasIssueTags.0.tag']);
  assert.deepEqual((await db.query<{field: string}>('SELECT field FROM pulse.settings_changes ORDER BY field')).rows,
    [{field: 'gorgiasIssueTags.0.reason'}, {field: 'gorgiasIssueTags.0.tag'}]);
  await db.query(await readFile(new URL('../migrations/075_gorgias_issue_tags.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await readSettings(db), {version: saved.version, values: saved.values});
  const definition = (await db.query<{definition: string}>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'`)).rows[0]!.definition;
  assert.equal((definition.match(/'gorgiasIssueTags'/g) ?? []).length, 1);
  await assert.rejects(() => db.query(`WITH entry AS (INSERT INTO pulse.audit_log(event,credential_id)
    VALUES('settings_changed','invented-issue-device') RETURNING id)
    INSERT INTO pulse.settings_changes(audit_id,field) SELECT id,'gorgiasIssueTagsExtra' FROM entry`),
  /check constraint/i);
});

test('the Settings page carries an escaped saved issue map for saves while its feature editor is absent', () => {
  const tag = '<script>invented</script>', values = {...defaultSettings(), gorgiasIssueTags: [{tag, reason: 'other' as const}]};
  const html = settingsPage({version: 1, values});
  const hidden = html.match(/<input type="hidden" id="saved-gorgias-issue-tags"[^>]*>/)?.[0] ?? '';
  assert.match(hidden, /&lt;script&gt;invented&lt;\/script&gt;/);
  assert.match(hidden, /&quot;reason&quot;:&quot;other&quot;/);
  assert.doesNotMatch(hidden, /<script>/);
});
