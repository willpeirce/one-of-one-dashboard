import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';
import type { MetaCampaignView } from '../src/ad-spend/model.js';

test('Settings shows named overheads, bounded money and optional month controls with the current UK month total', () => {
  const values = {
    ...defaultSettings(),
    overheads: [
      { name: 'Sample ongoing', monthlyGbp: 31, startMonth: '', endMonth: '' },
      { name: 'Sample ended', monthlyGbp: 44, startMonth: '', endMonth: '2026-09' },
      { name: 'Sample current', monthlyGbp: 12.34, startMonth: '2026-10', endMonth: '2026-11' },
      { name: 'Sample future', monthlyGbp: 20, startMonth: '2026-11', endMonth: '' },
    ],
  };
  // The invented date is October in the UK while it is still September in UTC.
  const html = settingsPage({ version: 1, values }, [], 'sample', new Date('2026-09-30T23:30:00Z'));
  assert.match(html, /data-settings-list="overheads" data-list-max="50"/);
  assert.ok(!html.includes('name="monthlyOverheadsGbp"'));
  assert.match(html, /name="overheads\.0\.name"[^>]* required maxlength="60"/);
  assert.match(html, /name="overheads\.0\.monthlyGbp"[^>]*type="number"[^>]*min="0" step="0\.01" max="1000000"/);
  const months = [...html.matchAll(/<input[^>]*name="overheads\.(?:0|__index__)\.(?:startMonth|endMonth)"[^>]*>/g)].map((match) => match[0]);
  assert.equal(months.length, 4, 'existing rows and newly added rows both use month controls');
  for (const month of months) {
    assert.match(month, /type="month"/);
    assert.match(month, /data-month-input pattern="\[0-9\]\{4\}-\(0\[1-9\]\|1\[0-2\]\)" maxlength="7" placeholder="YYYY-MM"/);
    assert.ok(!month.includes(' required'));
  }
  assert.match(html, /data-overheads-total>Total this month: £43\.34/);
  assert.match(html, /Each item is spread evenly over the days of its month\./);
});

test('Settings caps the overhead editor at 50 rows and escapes item names', () => {
  const attack = '<svg onload="alert(1)">';
  const overheads = Array.from({ length: 50 }, (_, index) => ({
    name: index ? `Sample ${index}` : attack, monthlyGbp: 0, startMonth: '', endMonth: '',
  }));
  const html = settingsPage({ version: 1, values: { ...defaultSettings(), overheads } });
  const section = html.match(/<section[^>]*data-settings-list="overheads"[\s\S]*?<\/section>/)![0];
  assert.match(section, /data-add-row disabled>Add overhead/);
  assert.ok(!section.includes(attack));
  assert.match(section, /&lt;svg onload=&quot;alert\(1\)&quot;&gt;/);
});

test('Settings lists campaigns by name, newest first, and folds inactive owners without an ID editor', () => {
  const campaign = (id: string, name: string, createdAt: string, extra: Partial<MetaCampaignView> = {}): MetaCampaignView => ({
    id, name, status: 'ACTIVE', createdAt, firstSeen: createdAt, lastSeen: createdAt,
    owner: 'ours', confirmed: true, mode: 'sample', ...extra,
  });
  const campaigns = [
    campaign('900000000701', 'Invented first campaign', '2026-08-01T08:00:00Z'),
    campaign('900000000702', 'Invented archived campaign', '2026-09-01T08:00:00Z', { status: 'ARCHIVED', owner: 'freelancer' }),
    campaign('900000000703', 'Invented newest campaign', '2026-10-01T08:00:00Z', { confirmed: false }),
    campaign('900000000704', 'Invented paused campaign', '2026-09-10T08:00:00Z', { status: 'PAUSED' }),
  ];
  const html = settingsPage({ version: 0, values: defaultSettings() }, [], 'sample', new Date('2026-10-09T10:00:00Z'), campaigns);
  assert.equal((html.match(/data-meta-campaign=/g) ?? []).length, 4);
  assert.equal((html.match(/data-campaign-owner/g) ?? []).length, 4);
  assert.equal((html.match(/data-save-campaign/g) ?? []).length, 4);
  assert.equal((html.match(/data-campaign-new/g) ?? []).length, 1);
  assert.match(html, /New, check owner/);
  assert.match(html, /active · Created <time datetime="2026-10-01T08:00:00Z">1 Oct 2026<\/time> · sample data/);
  assert.ok(html.indexOf('Invented newest campaign') < html.indexOf('Invented first campaign'));
  assert.ok(html.indexOf('Invented first campaign') < html.indexOf('Show 2 inactive'));
  assert.ok(html.indexOf('Show 2 inactive') < html.indexOf('Invented paused campaign'));
  assert.ok(html.indexOf('Invented paused campaign') < html.indexOf('Invented archived campaign'));
  assert.match(html, /<details class="setting-campaign-inactive"><summary>Show 2 inactive<\/summary>/);
  assert.match(html, /data-meta-campaign="900000000703" data-saved-owner="ours" data-confirmed="false"/);
  assert.match(html, /<option value="freelancer" selected>Freelancer/);
  assert.ok(!html.includes('data-settings-list="metaOwners"'));
  assert.ok(!html.includes('name="metaOwners.'));
  assert.ok(!html.includes('Add meta campaign'));
});

test('Settings safely retains owner rules for missing campaigns and escapes discovered names', () => {
  const values = { ...defaultSettings(), metaOwners: [{ campaignId: '900000000705', owner: 'freelancer' as const }] };
  const name = 'Invented <script>alert("sample")</script>';
  const html = settingsPage({ version: 2, values }, [], 'live', new Date(), [{
    id: '900000000706', name, status: 'ACTIVE', createdAt: '2026-09-02T00:00:00Z',
    firstSeen: '2026-10-01T00:00:00Z', lastSeen: '2026-10-09T00:00:00Z',
    owner: 'ours', confirmed: false, mode: 'live',
  }]);
  assert.ok(!html.includes(name));
  assert.match(html, /Invented &lt;script&gt;alert\(&quot;sample&quot;\)&lt;\/script&gt;/);
  assert.match(html, /id="saved-meta-owner-rules" value="\[\{&quot;campaignId&quot;:&quot;900000000705&quot;,&quot;owner&quot;:&quot;freelancer&quot;\}\]"/);
  assert.ok(!html.includes('data-meta-campaign="900000000705"'));
  assert.match(html, /Created <time[^>]+>2 Sept 2026<\/time> · live/);
});

test('Settings explains an empty campaign discovery without offering manual campaign IDs', () => {
  const html = settingsPage({ version: 0, values: defaultSettings() });
  assert.match(html, /Campaigns will appear after the next Meta ad spend sync\./);
  assert.equal((html.match(/data-save-campaign/g) ?? []).length, 0);
  assert.ok(!html.includes('data-settings-list="metaOwners"'));
});
