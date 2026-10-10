import { glance } from './fulfilment/view.js';
import type { DashboardSnapshot } from './dashboard-types.js';
import { liveHtml, needsHtml, storePanelsHtml } from './shopify/presentation.js';
import { dashboardTemplate } from './dashboard-template.js';
import { formatMetricNumber } from './money.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

/** All business copy and numbers come from the same server snapshot used by SSE. */
export function dashboardPage(snapshot: DashboardSnapshot): string {
  const moneyBindings = { t0038: snapshot.hero.today.net, t0050: snapshot.hero.today.spend };
  let content = dashboardTemplate.replace(/\{\{(sample|widget):([a-z0-9]+)\}\}/g, (_token, kind: string, key: string) => {
    const metric = kind === 'sample' ? moneyBindings[key as keyof typeof moneyBindings] : undefined;
    const value = metric ? metric.unavailable ? metric.unavailableLabel ?? 'No data' : formatMetricNumber(metric.n, metric)
      : kind === 'sample' ? snapshot.textValues[key]?.value : JSON.stringify(snapshot.widgets[key]?.value);
    if (value === undefined) throw new Error('Dashboard sample binding is missing');
    return escapeHtml(value);
  });
  const profit = snapshot.hero.today.profit;
  const profitDisplay = profit.unavailable ? profit.unavailableLabel ?? 'No data' : formatMetricNumber(profit.n, profit);
  content = content.replace(/(<button[^>]*data-k="profit"[^>]*>)[\s\S]*?<\/button>/, `$1<span class="sl">Net profit · <span class="per">${escapeHtml(snapshot.hero.today.per)}</span></span><span class="sv" data-pre="£" data-dp="2" data-n="${profit.n}">${escapeHtml(profitDisplay)}</span><span class="ss">${escapeHtml(profit.ss)}</span></button>`);
  // Partial totals must name their missing source even before browser hydration.
  content = content.replace(/(<button\b[^>]*data-k="(spend|roas|margin|profit)"[^>]*>)([\s\S]*?)<\/button>/g, (_button, tag: string, key: 'spend'|'roas'|'margin'|'profit', inner: string) => {
    const metric = snapshot.hero.today[key];
    if (metric.state !== 'warn') return `${tag}${inner}</button>`;
    return `${tag.replace(/data-state="[^"]+"/, 'data-state="warn"')}${inner.replace(/<span class="ss">(?:<span\b[^>]*>[\s\S]*?<\/span>|[^<]*)<\/span>/, () => `<span class="ss">${escapeHtml(metric.ss)}</span>`)}<span class="chip warn">! Watch</span></button>`;
  });
  if (snapshot.shopify) {
    content = content.replace('<div class="deck" id="deck">', `<div class="deck" id="deck"><div id="shopify-needs">${needsHtml(snapshot.shopify)}</div><p class="note">Sample decisions from later stages</p>`);
    content = content.replace(/(<div class="srows" data-sp="live">)[\s\S]*?(?=<div class="srows" data-sp="wins")/, `$1${liveHtml(snapshot.shopify)}</div>\n`);
    content = content.replace('<div class="panel" id="p-store" data-panel="store" hidden>', `<div class="panel" id="p-store" data-panel="store" hidden><div id="shopify-panels">${storePanelsHtml(snapshot.shopify)}</div>`);
    content = content.replace(/data-model-id="(w029|w030|w031|w032|w033|w034|w035|w036|w037|w039|w046|w047|w048)"/g, `$& data-ingested-shopify`);
    content = content.replace(/<button\b[^>]*data-model-id="([^"]+)"[^>]*>/g, (tag, key: string) => {
      const widget = snapshot.widgets[key];
      return widget ? tag.replace(/data-mode="[^"]+"/, `data-mode="${widget.mode}"`).replace(/data-source="[^"]+"/, `data-source="${widget.source.join(' ')}"`) : tag;
    });
    content = content.replace(/<button\b[^>]*data-k="(net|orders|cr|spend|roas|margin|profit)"[^>]*>/g, (tag, key: 'net'|'orders'|'cr'|'spend'|'roas'|'margin'|'profit') => tag.replace(/data-mode="[^"]+"/, `data-mode="${snapshot.hero.today[key].mode}"`).replace(/data-source="[^"]+"/, `data-source="${snapshot.hero.today[key].source.join(' ')}"`).replace(/data-state="[^"]+"/, `data-state="${snapshot.hero.today[key].state}"`));
    // Label surviving mockup examples individually when a live source sits beside them.
    content = content.replace(/(<(?:article|button|div)\b[^>]*data-mode="sample"[^>]*>)/g, '$1<span class="sample-label">Sample data</span>');
  }
  if (snapshot.fulfilment) {
    content = content.replace('<div id="shopify-panels">', `<div id="fulfilment-glance">${glance(snapshot.fulfilment)}</div><div id="shopify-panels">`);
  }
  content = content.replace(/type="button" disabled(?= title=)/g, 'type="button" disabled data-unbuilt');
  // Labels are already HTML-escaped with the snapshot bindings above.
  content = content.replace(/(<button\b[^>]*\bdata-unbuilt\b[^>]*aria-label="([^"]*)"[^>]*>)Not built yet<\/button>/g,
    (_button, openingTag: string, label: string) => `<span class="unbuilt-action">${openingTag}${label.replace(/ · Not built yet$/, '')}</button><small class="unbuilt-note" aria-hidden="true">Not built yet</small></span>`);
  const healthLabels = { waiting_for_keys: 'waiting for keys', not_implemented: 'client not built', healthy: 'connected', error: 'source unavailable' };
  const connections = (snapshot.sourceHealth ?? []).map((row) => `<span><i style="background:var(--info)"></i>${escapeHtml(row.name)} · ${healthLabels[row.status]}</span>`).join('');
  content = content.replace(/<div class="feeds" id="feeds">[\s\S]*?<\/div>/, `<div class="feeds" id="feeds" aria-label="Actual source connections">${connections}<a href="/sources">Connection details</a></div>`);
  content = content.replace('<main class="wrap">', '<main class="wrap" id="main">');
  const failing = snapshot.shopify?.checks.filter(check => check.status === 'tripped').length ?? 0;
  const unconfirmed = snapshot.metaCampaigns?.unconfirmedCount ?? 0;
  const badge = (id: string, count: number, label: string): string => `<span id="${id}" class="menu-count"${count ? '' : ' hidden'} aria-label="${count} ${label}">${count}</span>`;
  content = content.replace(/<span class="avatar"[\s\S]*?<\/span><\/span>/, `<details class="account-menu" id="account-menu">
    <summary class="avatar" aria-label="Account menu">W</summary>
    <nav class="account-links" aria-label="Account">
      <a href="/fulfilment">Fulfilment costs</a><a href="/sources">Source health${badge('source-health-count', failing, 'failing checks')}</a><a href="/settings">Settings${badge('settings-count', unconfirmed, 'campaigns to confirm')}</a><a href="/audit">Audit log</a>
      <button type="button" id="sign-out" disabled>Sign out</button>
    </nav>
  </details>`);
  content = content.replace('</footer>', '<p id="update-status" role="status" aria-live="polite">Connecting…</p><p id="auth-message" role="status" aria-live="polite"></p></footer>');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#5130c2">
  <meta name="color-scheme" content="dark">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Pulse">
  <title>One of One Pulse</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="icon" href="/assets/icon-192.png" type="image/png">
  <link rel="stylesheet" href="/assets/fonts.css">
  <link rel="stylesheet" href="/assets/dashboard.css">
  <link rel="stylesheet" href="/assets/fulfilment.css">
  <script type="module" src="/assets/browser.js"></script>
  <script type="module" src="/assets/dashboard.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${content}
  <div id="dashboard-state" hidden data-snapshot="${escapeHtml(JSON.stringify(snapshot))}"></div>
  <noscript><p class="note">JavaScript is needed for the dials, live updates and sign-out. Check each card’s source label.</p></noscript>
</body>
</html>`;
}
