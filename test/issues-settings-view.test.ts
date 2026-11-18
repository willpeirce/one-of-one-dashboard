import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultSettings} from '../src/settings.js';
import {settingsPage} from '../src/settings-view.js';
import {ISSUE_REASONS, ISSUE_TAG_LIMIT} from '../src/issues/taxonomy.js';

test('the issue map editor starts empty, lists every reason and explains local classification', () => {
  const html = settingsPage({version: 1, values: defaultSettings()});
  const editor = html.match(/<section[^>]*data-settings-list="gorgiasIssueTags"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(editor, /data-list-max="40"/);
  assert.match(editor, /None added yet/);
  assert.match(editor, /Matching ignores case; the first matching row wins/);
  assert.match(editor, /This never changes a tag in Gorgias/);
  assert.match(editor, /name="gorgiasIssueTags\.__index__\.tag"[^>]*maxlength="80"/);
  assert.equal((editor.match(/<option /g) ?? []).length, ISSUE_REASONS.length + 1);
  assert.match(editor, /QR won&#39;t register/);
  assert.match(editor, /Add issue tag/);
});

test('the issue map editor escapes tag text and disables adding beyond its row cap', () => {
  const attack = '<img src=x onerror="invented()">';
  const values = {...defaultSettings(), gorgiasIssueTags: Array.from({length: ISSUE_TAG_LIMIT}, (_, index) => ({
    tag: index ? `invented_tag_${index}` : attack, reason: 'other' as const,
  }))};
  const html = settingsPage({version: 1, values});
  const editor = html.match(/<section[^>]*data-settings-list="gorgiasIssueTags"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(editor, /data-add-row disabled>Add issue tag/);
  assert.match(editor, /&lt;img src=x onerror=&quot;invented\(\)&quot;&gt;/);
  assert.doesNotMatch(editor, /<img src=x/);
  assert.equal((editor.match(/<fieldset class="setting-row"/g) ?? []).length, 41, 'Forty saved rows and one template');
});
