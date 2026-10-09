import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';

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
