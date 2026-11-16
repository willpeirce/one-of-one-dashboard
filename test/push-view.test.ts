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

test('device Alerts sits beside the existing daily summary without becoming a global Settings field', () => {
  const values = defaultSettings(), html = settingsPage({ values, version: 0 }, [], 'sample', now);
  assert.match(html, /One morning summary for all devices with notifications enabled\./);
  assert.match(html, /Summary &amp; brand[\s\S]*id="notifications"/);
  const row = html.match(/<section class="push-device"[\s\S]*?<\/section>/)![0];
  assert.match(row, /Notifications on this device/);
  assert.match(row, /data-setting-path="morningSummaryEnabled"/);
  assert.equal((html.match(/data-setting-path="morningSummaryEnabled"/g) ?? []).length, 1);
  assert.match(row, /id="push-alerts" type="button" role="switch" aria-label="Alerts" aria-checked="false" disabled/);
  assert.match(row, /○ Alerts · Off/);
  assert.match(row, /on this device only\. Saved immediately\./);
  const alerts = row.match(/<button[^>]+id="push-alerts"[^>]*>/)![0];
  assert.doesNotMatch(alerts, /data-setting-path=|name=/);
  for (const id of ['push-turn-on', 'push-turn-off', 'push-send-test']) assert.match(row, new RegExp(`id="${id}" type="button" hidden`));
});
