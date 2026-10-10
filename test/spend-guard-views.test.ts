import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardPage } from '../src/dashboard-view.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { sourceHealthPage } from '../src/views.js';
import type { SourceHealth } from '../src/sources.js';

test('server-rendered spend-dependent tiles name their gap with a Watch chip before hydration', () => {
  const snapshot = getSampleDashboard();
  for (const key of ['spend', 'roas', 'margin', 'profit'] as const) {
    snapshot.hero.today[key].state = 'warn';
    snapshot.hero.today[key].ss = key === 'spend'
      ? 'Meta missing · total excludes Meta\nGoogle missing · total excludes Google\n+1 more'
      : 'Excludes Meta spend';
  }
  const html = dashboardPage(snapshot);
  for (const key of ['spend', 'roas', 'margin', 'profit'] as const) {
    const tile = html.match(new RegExp(`<button[^>]*data-k="${key}"[^>]*>[\\s\\S]*?</button>`))![0];
    assert.match(tile, /data-state="warn"/);
    assert.ok(tile.includes(snapshot.hero.today[key].ss));
    assert.match(tile, /<span class="chip warn">! Watch<\/span>/);
    assert.doesNotMatch(tile, /chip (?:good|alarm)/);
    assert.equal((tile.match(/<span\b/g) ?? []).length, (tile.match(/<\/span>/g) ?? []).length);
  }
});

test('ad Source health uses current-account freshness and failures without leaking the previous account time', () => {
  const oldTime = new Date('2026-10-09T08:00:00Z');
  const meta: SourceHealth = { source: 'meta', name: 'Meta Ads', stage: 2, requiredKeys: [],
    mode: 'live', status: 'healthy', lastSuccessAt: oldTime, lastAttemptAt: oldTime,
    consecutiveFailures: 0, updatedAt: oldTime };
  const fetchedAt = '2026-10-10T10:29:00.000Z';
  const render = (status: string, failures: number, fetched: string | null = fetchedAt) => {
    const html = sourceHealthPage([meta], undefined, undefined, [{ source: 'meta', live: true,
      ready: fetched !== null, status, fetchedAt: fetched, failures,
      stale: status.startsWith('stale'), lastAttemptAt: fetched }]);
    return html.match(/<tr>\s*<th scope="row">Meta Ads<\/th>[\s\S]*?<\/tr>/)![0];
  };
  const stale = render('stale · last fetched 10 Oct 2026, 11:29 UK', 0);
  assert.match(stale, /stale · last fetched 10 Oct 2026, 11:29 UK/);
  assert.ok(stale.includes(`datetime="${fetchedAt}"`));
  assert.doesNotMatch(stale, /consecutive failure|2026-10-09/);
  const failed = render('source unavailable', 2);
  assert.match(failed, /source unavailable · 2 consecutive failures/);
  assert.ok(failed.includes(`datetime="${fetchedAt}"`));
  const pending = render('first sync pending', 0, null);
  assert.match(pending, /<td>Never<\/td>/);
  assert.doesNotMatch(pending, /2026-10-09/);
});
