import { glance } from './fulfilment/view.js';
import type { DashboardSnapshot } from './dashboard-types.js';
import { checksHtml, liveHtml, needsHtml, storePanelsHtml } from './shopify/presentation.js';
import { dashboardTemplate } from './dashboard-template.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

/** All business copy and numbers come from the same server snapshot used by SSE. */
export function dashboardPage(snapshot: DashboardSnapshot): string {
  let content = dashboardTemplate.replace(/\{\{(sample|widget):([a-z0-9]+)\}\}/g, (_token, kind: string, key: string) => {
    const value = kind === 'sample' ? snapshot.textValues[key]?.value : JSON.stringify(snapshot.widgets[key]?.value);
    if (value === undefined) throw new Error('Dashboard sample binding is missing');
    return escapeHtml(value);
  });
  if (snapshot.shopify) {
    content = content.replace(/(<p class="sample-banner"[^>]*>[\s\S]*?<\/p>)/, `$1<div id="shopify-checks">${checksHtml(snapshot.shopify)}</div>`);
    content = content.replace('<div class="deck" id="deck">', `<div class="deck" id="deck"><div id="shopify-needs">${needsHtml(snapshot.shopify)}</div><p class="note">Sample decisions from later stages</p>`);
    content = content.replace(/(<div class="srows" data-sp="live">)[\s\S]*?(?=<div class="srows" data-sp="wins")/, `$1${liveHtml(snapshot.shopify)}</div>\n`);
    content = content.replace('<div class="panel" id="p-store" data-panel="store" hidden>', `<div class="panel" id="p-store" data-panel="store" hidden><div id="shopify-panels">${storePanelsHtml(snapshot.shopify)}</div>`);
    content = content.replace(/data-model-id="(w029|w030|w031|w032|w033|w034|w035|w036|w037|w039|w046|w047|w048)"/g, `$& data-ingested-shopify`);
    content = content.replace(/<button\b[^>]*data-model-id="([^"]+)"[^>]*>/g, (tag, key: string) => {
      const widget = snapshot.widgets[key];
      return widget ? tag.replace(/data-mode="[^"]+"/, `data-mode="${widget.mode}"`).replace(/data-source="[^"]+"/, `data-source="${widget.source.join(' ')}"`) : tag;
    });
    content = content.replace(/<button\b[^>]*data-k="(net|orders|cr|spend|roas|margin)"[^>]*>/g, (tag, key: 'net'|'orders'|'cr'|'spend'|'roas'|'margin') => tag.replace(/data-mode="[^"]+"/, `data-mode="${snapshot.hero.today[key].mode}"`).replace(/data-source="[^"]+"/, `data-source="${snapshot.hero.today[key].source.join(' ')}"`));
    // Label surviving mockup examples individually when a live source sits beside them.
    content = content.replace(/(<(?:article|button|div)\b[^>]*data-mode="sample"[^>]*>)/g, '$1<span class="sample-label">Sample data</span>');
  }
  if (snapshot.fulfilment) {
    content = content.replace('<div id="shopify-panels">', `<div id="fulfilment-glance">${glance(snapshot.fulfilment)}</div><div id="shopify-panels">`);
  }
  if (snapshot.banner) content = content.replace(/(<p class="sample-banner"[^>]*>)[\s\S]*?<\/p>/, `$1${escapeHtml(snapshot.banner)}</p>`);
  content = content.replace(/type="button" disabled(?= title=)/g, 'type="button" disabled data-unbuilt');
  // Labels are already HTML-escaped with the snapshot bindings above.
  content = content.replace(/(<button\b[^>]*\bdata-unbuilt\b[^>]*aria-label="([^"]*)"[^>]*>)Not built yet<\/button>/g,
    (_button, openingTag: string, label: string) => `<span class="unbuilt-action">${openingTag}${label.replace(/ · Not built yet$/, '')}</button><small class="unbuilt-note" aria-hidden="true">Not built yet</small></span>`);
  const healthLabels = { waiting_for_keys: 'waiting for keys', not_implemented: 'client not built', healthy: 'connected', error: 'source unavailable' };
  const connections = (snapshot.sourceHealth ?? []).map((row) => `<span><i style="background:var(--info)"></i>${escapeHtml(row.name)} · ${healthLabels[row.status]}</span>`).join('');
  content = content.replace(/<div class="feeds" id="feeds">[\s\S]*?<\/div>/, `<div class="feeds" id="feeds" aria-label="Actual source connections">${connections}<a href="/sources">Connection details</a></div>`);
  content = content.replace('<main class="wrap">', '<main class="wrap" id="main">');
  content = content.replace(/<span class="avatar"[\s\S]*?<\/span><\/span>/, `<details class="account-menu" id="account-menu">
    <summary class="avatar" aria-label="Account menu">W</summary>
    <nav class="account-links" aria-label="Account">
      <a href="/fulfilment">Fulfilment costs</a><a href="/sources">Source health</a><a href="/settings">Settings</a><a href="/audit">Audit log</a>
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
  <noscript><p class="sample-banner">JavaScript is needed for the dials, live updates and sign-out. Check each card’s source label.</p></noscript>
</body>
</html>`;
}
