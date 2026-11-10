import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {addDays} from '../src/hero-range.js';
import {defaultSettings} from '../src/settings.js';
import {parseAdSet, saveAdSets} from '../src/meta-adsets/catalogue.js';
import {readAdSetsView} from '../src/meta-adsets/presentation.js';
import {judgeAdSet} from '../src/meta-adsets/rules.js';
import {adSetTable} from '../src/meta-adsets/view.js';
import {decisionsHtml} from '../src/decisions/view.js';
import {saveSpend} from '../src/ad-spend/store.js';
import {morningDeck, type MorningInput} from '../src/morning/model.js';
import {tickerState} from '../src/ticker/model.js';
import {createTestDatabase} from './helpers/database.js';

const now = new Date('2032-04-07T08:00:00Z'), today = '2032-04-07';
test('app steps, their Undo, and outside changes remove Step on Home, Ads and Morning', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const account = '900000009601', campaign = '900000009602', id = '900000009603';
  const settings = {...defaultSettings(), metaAdAccountId: account, cppUkBreakEvenGbp: 20,
    metaOwners: [{campaignId: campaign, owner: 'ours' as const}]};
  settings.adRules.uk.overrideGbp = null; settings.adRules.uk.upliftPercent = 0;
  const env = {META_ACCESS_TOKEN: randomBytes(16).toString('hex'), META_ACTIONS_ENABLED: 'true'};
  const raw = {id, campaign_id: campaign, name: 'Invented UK Fern', status: 'ACTIVE', effective_status: 'ACTIVE',
    daily_budget: '2000', created_time: '2032-03-30T08:00:00Z', updated_time: '2032-03-30T08:00:00Z'};
  await saveAdSets(db, account, [parseAdSet(raw, 'GBP', settings)], settings, now);
  for (let offset = -7; offset < 0; offset++) {
    const day = addDays(today, offset);
    await saveSpend(db, 'meta', account, day, day, [{source: 'meta', accountId: account, campaignId: campaign,
      campaignName: 'Invented UK', adSetId: id, adSetName: raw.name, market: 'uk', owner: 'ours', day,
      amount: '16', currency: 'GBP', purchases: 1, addsToCart: 3}], now);
  }
  const inspect = async (step: boolean, completed: number) => {
    const view = await readAdSetsView(db, settings, env, now);
    assert.equal(view.rows[0]!.verdict!.reasons.some(reason => reason.verdict === 'Step'), step);
    assert.equal(decisionsHtml({adSets: view}).includes('data-adset-verdict="Step"'), step, 'Home uses the shared rule');
    assert.equal(adSetTable(view).includes('>Step<'), step, 'Ads uses the shared rule');
    const input: MorningInput = {mode: 'live', needs: [], checks: [], creativeCards: [], settings, adSets: view,
      ticker: tickerState([], [], now, 'live'), activity: [], metaActions: view.actions ?? [], sourceReadOk: {adsets: true}};
    const result = morningDeck(input, [], now);
    assert.equal(result.openCards.some(card => card.kind === 'meta-step'), step);
    assert.equal(result.snapshot.completed, completed);
    if (!step) assert.equal(result.openCards.length, 0, 'Acting can reach All clear');
    return view;
  };
  const original = await inspect(true, 0);
  // Stored successful actions count immediately, before a later catalogue read changes the base.
  await db.query(`INSERT INTO pulse.meta_actions(id,time,account_id,ad_set_id,action,old_value,new_value,who,result)
    VALUES('invented-step',$1,$2,$3,'budget','2000','2400','invented-device','success')`, ['2032-04-06T23:30:00Z', account, id]);
  await inspect(false, 1);
  await db.query("UPDATE pulse.meta_actions SET undone_at=$1 WHERE id='invented-step'", [now]);
  await inspect(false, 0);
  await db.query('DELETE FROM pulse.meta_actions');
  await saveAdSets(db, account, [parseAdSet({...raw, daily_budget: '2400', updated_time: now.toISOString()}, 'GBP', settings)], settings, now);
  await inspect(false, 0);
  // The extra guard changes only Step, never Kill or Slipping.
  const set = original.rows[0]!.set;
  for (const [verdict, spends] of [['Kill', [40,40,40,40,40,40,40]], ['Slipping', [5,5,5,5,40,40,40]]] as const) {
    const days = spends.map((spend, index) => ({day: addDays(today, index - 7), spend, purchases: 1, addsToCart: 3}));
    const before = judgeAdSet(set, days, settings, today)!;
    assert.equal(before.verdict, verdict);
    for (const changed of [{updatedTime: now.toISOString()}, {lastSignificantEdit: now.toISOString()}])
      assert.deepEqual(judgeAdSet({...set, ...changed}, days, settings, today), before);
    assert.deepEqual(judgeAdSet(set, days, settings, today, {changes: [now.toISOString()]}), before);
  }
});
