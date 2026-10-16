import { metricSign } from './metric-sign.js';
import { glance } from './fulfilment/view.js';
import { creativePanelHtml, creativeCardsHtml, creativeDialogHtml } from './creatives/view.js';
import type { DashboardSnapshot } from './dashboard-types.js';
import { liveHtml, needsHtml, storePanelsHtml } from './shopify/presentation.js';
import { dashboardTemplate } from './dashboard-template.js';
import { formatNumber, formatMetricNumber, formatPounds } from './money.js';
import { seriesPaceCardHtml } from './series-pace/presentation.js';
import { reviewsGreeting, reviewsPanelHtml } from './judgeme/presentation.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

/** All business copy and numbers come from the same server snapshot used by SSE. */
export function dashboardPage(snapshot: DashboardSnapshot): string {
  const metricBindings = { t0038: snapshot.hero.today.net, t0042: snapshot.hero.today.orders, t0046: snapshot.hero.today.cr,
    t0050: snapshot.hero.today.spend, t0054: snapshot.hero.today.roas, t0058: snapshot.hero.today.margin };
  let content = dashboardTemplate.replace(/\{\{(sample|widget):([a-z0-9]+)\}\}/g, (_token, kind: string, key: string) => {
    const metric = kind === 'sample' ? metricBindings[key as keyof typeof metricBindings] : undefined;
    const value = metric ? metric.unavailable ? metric.unavailableLabel ?? 'No data' : formatMetricNumber(metric.n, metric)
      : kind === 'sample' ? snapshot.textValues[key]?.value : JSON.stringify(snapshot.widgets[key]?.value);
    if (value === undefined) throw new Error('Dashboard sample binding is missing');
    return escapeHtml(value);
  });
  const pace = snapshot.widgets.w017;
  if (snapshot.creatives) {
    content = content.replace('<div class="deck" id="deck">', `<div class="deck" id="deck"><div id="creative-cards">${creativeCardsHtml(snapshot.creatives.cards)}</div><div id="creative-feedback" role="status" aria-live="polite"></div>`);
    content = content.replace(/(<header class="chapter-heading"><span class="chapter-number" aria-hidden="true">4<\/span>[\s\S]*?<\/header>)/, `$1<div id="creative-panel">${creativePanelHtml(snapshot.creatives)}</div>`);
    content += creativeDialogHtml();
  }
  if (snapshot.reviews) {
    content = content.replace(/(<section class="chapter revs" id="reviews"[^>]*>)[\s\S]*?<\/section>/, (_section, tag: string) => `${tag}${reviewsPanelHtml(snapshot.reviews!)}</section>`);
    content = content.replace(/(<span id="subrv">)[\s\S]*?<\/span>/, (_span, tag: string) => `${tag}${escapeHtml(reviewsGreeting(snapshot.reviews!))}</span>`);
    content = content.replace('<div class="counts" id="counts"></div>', `<div class="counts" id="counts"><button class="pk" type="button" data-rv>${escapeHtml(reviewsGreeting(snapshot.reviews))}</button></div>`);
  }
  if (pace?.kind === 'series-pace') content = content.replace(/<article\b[^>]*data-model-id="w017"[^>]*><\/article>/,
    `<article class="tile series-pace" data-source="shopify" data-mode="${pace.mode}" data-model-id="w017" aria-label="Series 1 sell-out pace">${seriesPaceCardHtml(pace.value, pace.mode)}</article>`);
  const heroKeys = ['net', 'orders', 'aov', 'cac', 'cr', 'spend', 'roas', 'margin', 'contribution', 'profit'] as const;
  const heroLabels = { net: 'Net sales', orders: 'Orders', aov: 'AOV', cac: 'CAC', cr: 'Conversion rate', spend: 'Ad spend', roas: 'Overall ROAS', margin: 'Net margin', contribution: 'Contribution', profit: 'Net profit' };
  content = content.replace(/(<button\b[^>]*data-k="(net|orders|aov|cac|cr|spend|roas|margin|contribution|profit)"[^>]*>)[\s\S]*?<\/button>/g,
    (_button, tag: string, key: typeof heroKeys[number]) => {
      const metric = snapshot.hero.today[key], display = metric.unavailable ? metric.unavailableLabel ?? 'No data' : formatMetricNumber(metric.n, metric);
      const status = metric.statusLabel ?? ({ good: 'Good', warn: 'Watch', decide: 'Decide', alarm: 'Alarm', info: 'Info', sofar: 'So far', est: 'Estimate' }[metric.state]);
      const signedTag = ['margin', 'contribution', 'profit'].includes(key) ? tag.replace(/>$/, ` data-sign="${metricSign(metric)}">`) : tag;
      const opening = signedTag.replace(/data-mode="[^"]+"/, `data-mode="${metric.mode}"`).replace(/data-source="[^"]+"/, `data-source="${metric.source.join(' ')}"`).replace(/data-state="[^"]+"/, `data-state="${metric.state}"`);
      return `${opening}<span class="sl">${heroLabels[key]}</span><span class="sv${key === 'net' ? ' big' : ''}" style="--number-chars:${display.length}">${escapeHtml(display)}</span>${key === 'net' ? `<span class="gross">${snapshot.hero.today.grossUnavailable ? 'Total unavailable' : `Total ${escapeHtml(formatPounds(snapshot.hero.today.gross))}`}</span><span class="spark" data-spark="${snapshot.hero.today.spark.join(',')}" aria-hidden="true"></span>` : ''}<span class="ss">${escapeHtml(metric.ss)}</span><span class="chip ${metric.state}">${({ good: '✓', warn: '!', decide: '◆', alarm: '✕', info: 'i', sofar: '·', est: '≈' }[metric.state])} ${escapeHtml(status)}</span></button>`;
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
    content = content.replace(/<button\b[^>]*data-k="(net|orders|aov|cac|cr|spend|roas|margin|contribution|profit)"[^>]*>/g, (tag, key: 'net'|'orders'|'aov'|'cac'|'cr'|'spend'|'roas'|'margin'|'contribution'|'profit') => tag.replace(/data-mode="[^"]+"/, `data-mode="${snapshot.hero.today[key].mode}"`).replace(/data-source="[^"]+"/, `data-source="${snapshot.hero.today[key].source.join(' ')}"`).replace(/data-state="[^"]+"/, `data-state="${snapshot.hero.today[key].state}"`));
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
  const badge = (id: string, count: number, label: string): string => `<span id="${id}" class="menu-count"${count ? '' : ' hidden'} aria-label="${formatNumber(count)} ${label}">${formatNumber(count)}</span>`;
  content = content.replace(/<span class="avatar"[\s\S]*?<\/span><\/span>/, `<details class="account-menu" id="account-menu">
    <summary class="avatar" aria-label="Account menu">W</summary>
    <nav class="account-links" aria-label="Account">
      <a href="/creatives">Creatives</a><a href="/fulfilment">Fulfilment costs</a><a href="/sources">Source health${badge('source-health-count', failing, 'failing checks')}</a><a href="/settings">Settings${badge('settings-count', unconfirmed, 'campaigns to confirm')}</a><a href="/audit">Audit log</a>
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
  <link rel="stylesheet" href="/assets/creatives.css">
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
