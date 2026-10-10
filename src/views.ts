import type { ShopifyStore } from './shopify/store.js';
import type { SourceHealth } from './sources.js';
import type { CampaignSyncState } from './ad-spend/campaign-cache.js';
import { campaignSyncText } from './ad-spend/campaign-status.js';
import type { ShopifyDashboard } from './shopify/dashboard.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London',
});

function timestamp(value: Date | string | null): string {
  if (value === null) return 'Never';
  const date = new Date(value);
  return `<time datetime="${date.toISOString()}">${escapeHtml(dateFormat.format(date))}</time>`;
}

function page(title: string, content: string, signedIn: boolean): string {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#1e0f48">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Pulse">
  <title>${escapeHtml(title)} · One of One Pulse</title>
  <link rel="stylesheet" href="/assets/styles.css">
  <link rel="stylesheet" href="/assets/fonts.css">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
  <link rel="icon" type="image/png" href="/assets/icon-192.png">
  <script type="module" src="/assets/browser.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="top"><div class="hin">
    <a class="wordmark" href="/">One of One <span>Pulse</span></a>
    ${signedIn ? `<nav aria-label="Main"><a href="/">Home</a><a href="/sources">Source health</a><a href="/settings">Settings</a><a href="/audit">Audit log</a><button id="sign-out" type="button" disabled>Sign out</button></nav>` : ''}
  </div></header>
  <main class="wrap" id="main">${content}<p id="auth-message" role="status" aria-live="polite"></p></main>
  <noscript><div class="wrap"><p class="notice">Enable JavaScript to sign in or sign out with a passkey.</p></div></noscript>
</body>
</html>`;
}

export function loginPage(setupEnabled: boolean): string {
  return page('Sign in', `<section class="sign-in" aria-labelledby="sign-in-title">
    <h1 id="sign-in-title">Sign in to Pulse</h1>
    <p>Your private One of One dashboard.</p>
    <button id="sign-in" type="button" disabled>Sign in with a passkey</button>
    <p class="muted">Use Face ID, Touch ID or your device’s screen lock. You stay signed in for 30 days.</p>
    ${setupEnabled ? `<details>
      <summary>Add a device</summary>
      <form id="register-device" method="post" action="/auth/register/options">
        <label for="setup-code">Setup phrase</label>
        <input id="setup-code" name="setup-code" type="password" autocomplete="off" required maxlength="1024" aria-describedby="setup-help">
        <p id="setup-help" class="muted">Enter the setup phrase from your password manager to create a passkey.</p>
        <button id="register-button" type="submit" disabled>Add this device</button>
      </form>
    </details>` : '<p class="notice">Adding devices is not enabled yet. Set DASHBOARD_SETUP_CODE in the hosting environment to enable it.</p>'}
  </section>`, false);
}

const healthLabels: Record<SourceHealth['status'], string> = {
  waiting_for_keys: 'Waiting for keys',
  not_implemented: 'Client not built',
  healthy: 'Healthy',
  error: 'Source unavailable',
};

export function sourceHealthPage(rows: readonly SourceHealth[], shopify?: Awaited<ReturnType<ShopifyStore['summary']>>, costs?: Awaited<ReturnType<ShopifyStore['costSummary']>>, ads?:Awaited<ReturnType<typeof import('./ad-spend/store.js').spendHealth>>, status?: { summary: string; shopify: ShopifyDashboard; checkedAt: string; campaigns?: CampaignSyncState }): string {
  return page('Source health', `<h1>Source health</h1>
    <section id="source-summary" aria-label="Sources and modes"><h2>Sources and modes</h2><p class="sample-banner">${status ? escapeHtml(status.summary) : `<strong>sample data</strong> · ${shopify ? 'Shopify cards use ingested data; ad spend uses its own source connections; deferred examples remain labelled samples.' : 'No source data has been imported.'}`}</p></section>
    ${status ? `<section id="shopify-watchdogs" aria-label="Shopify watchdogs"><h2>Shopify watchdogs</h2><p>${status.shopify.checks.filter(check => check.status === 'pass').length}/${status.shopify.checks.length} checks passing · Shopify ${status.shopify.mode === 'live' ? 'live' : 'sample data'} · checked ${timestamp(status.checkedAt)} UK</p><ul>${status.shopify.checks.map(check => `<li><strong>${check.status === 'pass' ? '✓ Good' : check.status === 'tripped' ? '△ Watch' : '○ Unknown'} · ${escapeHtml(check.name)}</strong><p>${escapeHtml(check.why)}</p></li>`).join('')}</ul></section>` : ''}
    ${shopify ? `<section aria-label="Shopify imports"><h2>Shopify imports · ${shopify.sample ? 'sample data' : 'live'}</h2><p>${shopify.counts.order ?? 0} orders · ${shopify.counts.inventory ?? 0} inventory rows · ${shopify.counts.sessions ?? 0} session days · ${shopify.counts.sales ?? 0} older sales days · ${shopify.pendingWebhooks} webhooks pending.</p><p>Shopify cards are on Home. Import counts include older records retained for replay; window-based cards exclude them.</p>${shopify.notices.length ? `<p>Needs attention: ${shopify.notices.map(n => escapeHtml(n.replaceAll('_', ' '))).join(' · ')}</p>` : ''}</section>` : ''}
    ${costs ? `<p>Shopify unit costs: ${costs.known} stock variants with a cost · ${costs.missing} without · last cost change ${costs.changed ? timestamp(costs.changed) : 'none observed'}. ${shopify?.sample ? 'Sample data.' : 'Live.'}</p>` : ''}
    ${ads?`<section aria-label="Ad spend imports"><h2>Ad spend</h2>${ads.map(a=>`<p>${escapeHtml(a.source==='meta'?'Meta':a.source==='google-ads'?'Google':'TikTok')} · ${escapeHtml(a.status)}${a.fetchedAt?` · last fetched ${timestamp(a.fetchedAt)} UK`:''}${a.failures?` · ${a.failures} consecutive failure${a.failures === 1 ? '' : 's'}`:''}${a.source==='google-ads'?' · Google can lag about 3 hours · hours re-aligned to UK time':a.source==='tiktok'?' · hours re-aligned to UK time':''}</p>`).join('')}<p>Account IDs belong in Settings &gt; Ad spend. Each source connects independently. No ad platform changes are made.</p></section>`:''}
    <p>Shopify imports when its keys are present. Ad spend also needs its account ID in Settings. Other source clients arrive in their stages.</p>
    <div class="table-scroll" role="region" aria-label="Source health table, scroll horizontally if needed" tabindex="0">
      <table id="source-health">
        <caption>Source connections · times shown in UK time</caption>
        <thead><tr><th scope="col">Source</th><th scope="col">Mode</th><th scope="col">Health</th><th scope="col">Last success</th><th scope="col">Required keys</th></tr></thead>
        <tbody>${rows.map((row) => { const ad = ads?.find(a => a.source === row.source); return `<tr>
          <th scope="row">${escapeHtml(row.name)}</th>
          <td>${(ad?.live??row.mode==='live') ? 'Live' : 'Sample'}</td>
          <td>${escapeHtml(ad?.status??(row.source === 'shopify' && row.status === 'not_implemented' ? 'First sync pending' : healthLabels[row.status]))}${ad?.failures ? ` · ${ad.failures} consecutive failure${ad.failures === 1 ? '' : 's'}` : ''}${row.source === 'meta' && status?.campaigns ? `<br><small data-campaign-sync data-state="${status.campaigns.state}">${escapeHtml(campaignSyncText(status.campaigns))}</small>` : ''}</td>
          <td>${timestamp(ad ? ad.fetchedAt : row.lastSuccessAt)}</td>
          <td class="key-names">${row.requiredKeys.map((key) => `<code>${escapeHtml(key)}</code>`).join('<br>')}</td>
        </tr>`; }).join('')}</tbody>
      </table>
    </div>`, true);
}

export function auditPage(events: readonly { event: string; occurred_at: Date | string; field?: string | null }[]): string {
  return page('Audit log', `<h1>Audit log</h1>
    <p>Recent activity in Pulse. Times are shown in UK time.</p>
    <div class="table-scroll" role="region" aria-label="Audit log" tabindex="0">
      <table id="audit-log">
        <caption>Latest 100 events</caption>
        <thead><tr><th scope="col">When</th><th scope="col">Activity</th></tr></thead>
        <tbody>${events.length === 0 ? '<tr><td colspan="2">No activity yet.</td></tr>' : events.map((event) => `<tr><td>${timestamp(event.occurred_at)}</td><td>${escapeHtml(event.event.replaceAll('_', ' '))}${event.field ? ` · ${escapeHtml(event.field)}` : ''}</td></tr>`).join('')}</tbody>
      </table>
    </div>`, true);
}
