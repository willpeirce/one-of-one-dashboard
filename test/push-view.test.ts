import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';
import { morningDeck, type MorningInput } from '../src/morning/model.js';
import { morningLinesHtml } from '../src/morning/view.js';
import { tickerState } from '../src/ticker/model.js';

const now = new Date('2032-04-20T08:00:00Z');
test('Morning exposes the saved summary switch only when on and leaves device subscription state to the browser', () => {
  const input: MorningInput = { mode: 'sample', needs: [], checks: [], creativeCards: [], settings: defaultSettings(),
    ticker: tickerState([], [], now, 'sample'), activity: [], metaActions: [], sourceReadOk: {},
    brief: { mode: 'sample', status: 'ok', text: 'Invented morning check' } };
  const initial = morningDeck(input, [], now).snapshot;
  assert.equal(Object.hasOwn(initial, 'summaryEnabled'), false);
  assert.doesNotMatch(morningLinesHtml(initial), /mn-push-nudge/);
  input.settings.morningSummaryEnabled = true;
  const enabled = morningDeck(input, [], now).snapshot, html = morningLinesHtml(enabled);
  assert.equal(enabled.summaryEnabled, true);
  assert.match(html, /id="mn-push-nudge" href="\/settings#notifications" hidden/);
  assert.ok(html.indexOf('id="mn-brief"') < html.indexOf('id="mn-push-nudge"'));
  assert.equal(Object.hasOwn(enabled, 'subscription'), false);
});

test('the device notification row is inside Summary and brand but adds no Settings key', () => {
  const values = defaultSettings(), html = settingsPage({ values, version: 0 }, [], 'sample', now);
  assert.match(html, /One push at 08:00 UK with what needs you\./);
  assert.match(html, /Summary &amp; brand[\s\S]*id="notifications"/);
  const row = html.match(/<section class="push-device"[\s\S]*?<\/section>/)![0];
  assert.match(row, /Notifications on this device/);
  assert.doesNotMatch(row, /data-setting-path=|name=/);
  for (const id of ['push-turn-on', 'push-turn-off', 'push-send-test']) assert.match(row, new RegExp(`id="${id}" type="button" hidden`));
});
