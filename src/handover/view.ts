import { tickerHead, tickerHtml } from '../ticker/view.js';
import { escapeCreative as e } from '../creatives/html.js';
import type { HandoverSection } from './sections.js';

export function handoverPage(sections: readonly HandoverSection[]): string {
  return `<!doctype html><html lang="en" data-theme="dark"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <meta name="color-scheme" content="dark"><meta name="theme-color" content="#1e0f48"><title>Handover · Pulse</title>
    <link rel="stylesheet" href="/assets/fonts.css"><link rel="stylesheet" href="/assets/dashboard.css"><link rel="stylesheet" href="/assets/settings.css"><link rel="stylesheet" href="/assets/handover.css">
    <script type="module" src="/assets/browser.js"></script><script type="module" src="/assets/handover.js"></script>${tickerHead()}
    </head><body class="settings-page handover-page"><div class="sky" aria-hidden="true"></div><a class="settings-skip" href="#main">Skip to content</a>
    <header class="top"><div class="hin settings-header"><a class="settings-wordmark" href="/" aria-label="Pulse Home"><img src="/assets/logo.png" alt="One of One" width="500" height="312"></a><nav class="settings-nav" aria-label="Main"><a class="btn" href="/morning">☼ Morning</a><a class="btn" href="/">⌂ Home</a><a class="btn" href="/settings">⚙ Settings</a></nav></div></header>${tickerHtml()}
    <main class="wrap settings-wrap handover-wrap" id="main"><header class="handover-intro"><p class="chapter-eyebrow">Replies and follow-ups</p><h1>Handover</h1></header>
    ${sections.map((section, index) => `<section class="chapter handover-section" id="handover-${e(section.id)}" aria-labelledby="handover-title-${e(section.id)}" data-handover-section="${e(section.id)}" data-available="${section.available}"><header class="chapter-heading"><span class="chapter-number" aria-hidden="true">${index + 1}</span><div class="chapter-copy"><h2 class="chapter-title" id="handover-title-${e(section.id)}">${e(section.title)}</h2></div></header>${section.html}</section>`).join('') || '<p class="handover-notice">ⓘ No handover sections are enabled.</p>'}
    <p id="handover-message" role="status" aria-live="polite"></p><p id="auth-message" role="status" aria-live="polite"></p></main></body></html>`;
}
