import type { DashboardSnapshot } from './dashboard-types.js';
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
  content = content.replaceAll('type="button" disabled', 'type="button" disabled data-unbuilt');
  const healthLabels = { waiting_for_keys: 'waiting for keys', not_implemented: 'client not built', healthy: 'connected', error: 'source unavailable' };
  const connections = (snapshot.sourceHealth ?? []).map((row) => `<span><i style="background:var(--info)"></i>${escapeHtml(row.name)} · ${healthLabels[row.status]}</span>`).join('');
  content = content.replace(/<div class="feeds" id="feeds">[\s\S]*?<\/div>/, `<div class="feeds" id="feeds" aria-label="Actual source connections">${connections}<a href="/sources">Connection details</a></div>`);
  content = content.replace('<main class="wrap">', '<main class="wrap" id="main">');
  content = content.replace(/<span class="avatar"[\s\S]*?<\/span><\/span>/, `<details class="account-menu" id="account-menu">
    <summary class="avatar" aria-label="Account menu">W</summary>
    <nav class="account-links" aria-label="Account">
      <a href="/sources">Source health</a><a href="/settings">Settings</a><a href="/audit">Audit log</a>
      <button type="button" id="theme-toggle" aria-label="Switch to light theme">Light theme</button>
      <button type="button" id="sign-out" disabled>Sign out</button>
    </nav>
  </details>`);
  content = content.replace('</footer>', '<p id="update-status" role="status" aria-live="polite">Connecting…</p><p id="auth-message" role="status" aria-live="polite"></p></footer>');
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#5130c2">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Pulse">
  <title>One of One Pulse</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="icon" href="/assets/icon-192.png" type="image/png">
  <link rel="stylesheet" href="/assets/fonts.css">
  <link rel="stylesheet" href="/assets/dashboard.css">
  <script type="module" src="/assets/browser.js"></script>
  <script type="module" src="/assets/dashboard.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${content}
  <div id="dashboard-state" hidden data-snapshot="${escapeHtml(JSON.stringify(snapshot))}"></div>
  <noscript><p class="sample-banner">JavaScript is needed for the dials, live updates and sign-out. The figures shown are sample data.</p></noscript>
</body>
</html>`;
}
