import { SETTINGS_KEY_NAMES, type SettingsSnapshot } from './settings.js';
import type { ShopifyCost } from './shopify/costs.js';

function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

type Field = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'time' | 'date' | 'checkbox';
  nullable?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  hint?: string;
  options?: readonly { value: string; label: string }[];
};

function field(definition: Field, value: unknown, prefix = ''): string {
  const path = prefix ? `${prefix}.${definition.key}` : definition.key;
  const id = `setting-${path.replaceAll('.', '-')}`;
  const type = definition.type ?? 'text';
  const hint = definition.hint ? `<small id="${id}-help">${escapeHtml(definition.hint)}</small>` : '';
  const describedBy = definition.hint ? ` aria-describedby="${id}-help"` : '';
  const attributes = `id="${id}" name="${path}" data-setting-path="${path}"${describedBy}`;
  if (type === 'checkbox') {
    return `<div class="setting-field setting-check"><label for="${id}"><input ${attributes} type="checkbox"${value === true ? ' checked' : ''}><span>${escapeHtml(definition.label)}</span></label>${hint}</div>`;
  }
  const input = definition.options
    ? `<select ${attributes}>${definition.options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`
    : `<input ${attributes} type="${type}" value="${escapeHtml(value === null || value === undefined ? '' : String(value))}"${definition.nullable ? ' data-nullable="true" placeholder="Not set"' : ' required'}${type === 'number' ? ` min="${definition.min ?? 0}" step="${definition.integer ? '1' : '0.01'}"${definition.max === undefined ? '' : ` max="${definition.max}"`}` : ''}${type === 'text' ? ' maxlength="160" autocomplete="off"' : ''}>`;
  return `<div class="setting-field"><label for="${id}">${escapeHtml(definition.label)}</label>${input}${hint}</div>`;
}

function fields(definitions: readonly Field[], values: object, prefix = ''): string {
  return definitions.map((definition) => field(definition, (values as Record<string, unknown>)[definition.key], prefix)).join('');
}

function collection(key: string, label: string, definitions: readonly Field[], rows: readonly Record<string, unknown>[], note: string, costs?: Record<string, string>): string {
  const row = (value: Record<string, unknown>, index: number | string) => `<fieldset class="setting-row"><legend>${escapeHtml(label)} <span data-row-number>${typeof index === 'number' ? index + 1 : ''}</span></legend><div class="setting-row-fields">${fields(definitions, value, `${key}.${index}`)}</div>${costs ? `<p class="setting-help" data-shopify-cost>${escapeHtml(costs[String(value.sku)] ?? 'Not in Shopify')}</p>` : ''}<button class="btn setting-remove" type="button" data-remove-row aria-label="Remove ${escapeHtml(label.toLowerCase())}">Remove</button></fieldset>`;
  return `<section class="setting-collection" data-settings-list="${key}" aria-labelledby="${key}-heading">
    <h3 id="${key}-heading">${escapeHtml(label)} <span class="setting-count" data-list-count>${rows.length}</span></h3>
    <p class="setting-help">${escapeHtml(note)}</p>
    <div data-list-rows${costs ? ` data-shopify-cost-map="${escapeHtml(JSON.stringify(costs))}"` : ''}>${rows.map((value, index) => row(value, index)).join('')}</div>
    <p class="setting-empty" data-list-empty${rows.length ? ' hidden' : ''}>None added yet.</p>
    <template data-list-template>${row({}, '__index__')}</template>
    <button class="btn setting-add" type="button" data-add-row>Add ${escapeHtml(label.toLowerCase())}</button>
  </section>`;
}

function section(title: string, description: string, content: string, open = false): string {
  return `<details class="settings-section glass"${open ? ' open' : ''}><summary><span>${escapeHtml(title)}<small>${escapeHtml(description)}</small></span><span class="setting-chevron" aria-hidden="true">⌄</span></summary><div class="settings-section-body">${content}</div></details>`;
}

const number = (key: string, label: string, extra: Partial<Field> = {}): Field => ({ key, label, type: 'number', ...extra });
const checkbox = (key: string, label: string): Field => ({ key, label, type: 'checkbox' });

export function settingsPage(snapshot: SettingsSnapshot, shopifyCosts: readonly ShopifyCost[] = [], mode: 'sample' | 'live' = 'sample'): string {
  const values = snapshot.values;
  const costLabels: Record<string, string> = Object.create(null);
  for (const c of shopifyCosts) if (c.sku) {
    const seen = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(c.last_seen_at));
    const amount = c.amount_pence === null ? 'no cost set' : `${c.currency === 'GBP' ? '£' : c.currency + ' '}${(Number(c.amount_pence)/100).toFixed(2)}`;
    costLabels[c.sku] = `Shopify · ${mode === 'sample' ? 'sample data' : 'live'}: ${amount} · last seen ${seen}`;
  }
  const goals = section('Goals & overheads', 'The targets behind your business.', `<div class="settings-grid">${fields([
    number('goalOrdersPerDay', 'Order goal per day', { integer: true, min: 1 }),
    number('goalNetMarginPercent', 'Net margin goal (%)', { max: 100 }),
    number('monthlyOverheadsGbp', 'Monthly overheads (£)', { nullable: true }),
    number('paymentFeePercent', 'Payment fee rate (%)', { nullable: true, max: 100 }),
  ], values)}</div>`, true);
  const advertising = section('Cost per purchase', 'UK and US targets, plus the blended Meta tripwire.', `<div class="settings-grid">${fields([
    number('cppUkBreakEvenGbp', 'UK break-even cost (£)'), number('cppUkTargetGbp', 'UK target cost (£)', { hint: 'At or below the UK break-even cost.' }),
    number('cppUsBreakEvenGbp', 'US break-even cost (£)'), number('cppUsTargetGbp', 'US target cost (£)', { hint: 'At or below the US break-even cost.' }),
    number('blendedMetaTripwireGbp', 'Blended Meta tripwire (£)', { min: 0.01 }),
  ], values)}</div>`);
  const costs = section('Costs & dispatch', 'Shopify unit costs first; starting costs are the fallback.', `<div class="settings-grid">${fields([
    number('flatFulfilmentUkGbp', 'UK flat fulfilment cost (£)', { nullable: true }),
    number('flatFulfilmentUsGbp', 'US flat fulfilment cost (£)', { nullable: true }),
    { key: 'dispatchCutoffUk', label: 'Northampton dispatch cut-off', type: 'time', hint: 'Europe/London local time.' },
    { key: 'dispatchCutoffUs', label: 'Ohio dispatch cut-off', type: 'time', hint: 'America/New_York local time.' },
  ], values)}</div>${collection('startingCogs', 'SKU cost', [
    { key: 'sku', label: 'SKU' }, number('unitCostGbp', 'Starting unit cost (£)', { nullable: true }),
  ], values.startingCogs, "Shopify’s cost per item comes first. These rows are the fallback for a SKU with no Shopify cost. Blank means unknown, never zero.", costLabels)}`);
  const stock = section('Stock planning', 'Supplier timing and components per kit.', `<div class="settings-grid">${fields([
    number('safetyWeeks', 'Safety stock (weeks)'),
    number('seasonalMultiplier', 'Seasonal multiplier', { nullable: true, min: 0.01 }),
    number('markersPerKit', 'Markers per kit', { nullable: true, integer: true }),
    number('pencilsPerKit', 'Pencils per kit', { nullable: true, integer: true }),
  ], values)}</div>${collection('supplierLeadTimes', 'Supplier lead time', [
    { key: 'supplier', label: 'Supplier business' }, number('days', 'Lead time (days)', { nullable: true, integer: true }),
  ], values.supplierLeadTimes, 'Starting supplier lead times. Freight and confirmed arrival dates come with uploads.')}`);
  const campaigns = section('Campaign maps', 'Ownership and expected markets for future source feeds.', `${collection('metaOwners', 'Meta campaign', [
    { key: 'campaignId', label: 'Campaign ID' },
    { key: 'owner', label: 'Owner', options: [{ value: 'unassigned', label: 'Unassigned' }, { value: 'ours', label: 'Ours' }, { value: 'freelancer', label: 'Freelancer' }] },
  ], values.metaOwners, 'Map each campaign to its owner. This saves a local rule; it does not change Meta.')}${collection('expectedGoogleCampaigns', 'Google campaign', [
    { key: 'name', label: 'Campaign name' },
    { key: 'market', label: 'Market', options: [{ value: 'UK', label: 'UK' }, { value: 'US', label: 'US' }, { value: 'EU', label: 'EU' }] },
  ], values.expectedGoogleCampaigns, 'The campaigns you expect to serve, with their markets. This does not enable a campaign.')}`);
  const creators = section('Creator negotiation', 'Your rules for agreeing an asset and its usage.', `<div class="settings-grid">${fields([
    number('assetCapGbp', 'Maximum fee per asset (£)'),
    number('minimumUsageMonths', 'Minimum usage (months)', { integer: true }),
    number('briefPaymentPercent', 'Payment on brief (%)', { max: 100 }),
    number('deliveryPaymentPercent', 'Payment on delivery (%)', { max: 100 }),
  ], values.creatorRules, 'creatorRules')}</div><div class="settings-checks">${fields([
    checkbox('pushPriceBeforeExtendingUsage', 'Negotiate price before extending usage'),
    checkbox('acceptOpeningOffer', 'Accept the opening offer'),
    checkbox('offerCreatorLink', 'Offer to create the creator’s link'),
    checkbox('useAffiliateWording', 'Use the word “affiliate”'),
  ], values.creatorRules, 'creatorRules')}</div>`);
  const dates = section('Contacts & dates', 'Waiting-on contacts, deadlines and key expiry dates.', `${collection('waitingContacts', 'Waiting-on contact', [
    { key: 'business', label: 'Business' }, { key: 'role', label: 'Role' },
  ], values.waitingContacts, 'Business names and roles only. Keep customer details, email addresses and phone numbers out of this list.')}${collection('deadlines', 'Deadline', [
    { key: 'label', label: 'What is due' }, { key: 'date', label: 'Due date', type: 'date' },
  ], values.deadlines, 'Your upcoming business dates.')}${collection('keyExpiryDates', 'Key expiry', [
    { key: 'keyName', label: 'Key name', options: SETTINGS_KEY_NAMES.map((key) => ({ value: key, label: key })) },
    { key: 'expiresOn', label: 'Expiry date', type: 'date' },
  ], values.keyExpiryDates, 'Dates only. Key values stay in hosting Secrets.')}`);
  const preferences = section('Summary & brand', 'The morning summary starts switched off.', `<div class="settings-grid">${fields([
    { key: 'brand', label: 'Brand', options: [{ value: 'one-of-one', label: 'One of One' }], hint: 'Kinda Rare comes in a later stage.' },
    { ...checkbox('morningSummaryEnabled', 'Enable the 08:00 UK summary'), hint: 'Saves your preference. Summary delivery is built in stage 7.' },
  ], values)}</div>`);
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#5130c2">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>Settings · One of One Pulse</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="/assets/fonts.css">
  <link rel="stylesheet" href="/assets/dashboard.css">
  <link rel="stylesheet" href="/assets/settings.css">
  <script type="module" src="/assets/browser.js"></script>
  <script type="module" src="/assets/settings.js"></script>
</head>
<body class="settings-page">
  <div class="sky" aria-hidden="true"></div>
  <a class="settings-skip" href="#main">Skip to settings</a>
  <header class="top"><div class="hin settings-header">
    <a class="settings-wordmark" href="/" aria-label="One of One Pulse home"><img src="/assets/logo.png" width="55" height="34" alt="One of One"><span>Pulse</span></a>
    <nav class="settings-nav" aria-label="Main"><a class="btn" href="/">Dashboard</a><a class="btn" href="/audit">Audit log</a><button class="btn" id="sign-out" type="button" disabled>Sign out</button></nav>
  </div></header>
  <main class="wrap settings-wrap" id="main">
    <div class="settings-intro"><p class="eyebrow">Your business, your rules</p><h1>Settings</h1><p>Real business settings, saved in Pulse. Dashboard figures remain labelled sample data while source feeds are being built.</p></div>
    <form id="settings-form" data-version="${snapshot.version}" method="post" action="/api/settings">
      <fieldset id="settings-fields"><legend class="settings-sr-only">Business settings</legend>${goals}${advertising}${costs}${stock}${campaigns}${creators}${dates}${preferences}</fieldset>
      <div class="settings-savebar glass"><div><p id="settings-message" role="status" aria-live="polite">Changes save only when you choose Save settings.</p><p class="setting-help">Unknown costs can stay blank. Saving adds an audit entry.</p></div><button class="btn settings-save" id="settings-save" type="submit" disabled>Save settings</button></div>
    </form>
    <p id="auth-message" role="status" aria-live="polite"></p>
    <noscript><p>Enable JavaScript to save settings or sign out.</p></noscript>
  </main>
</body>
</html>`;
}
