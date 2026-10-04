import { appConfig } from './config.js';
import type { Database } from './db.js';
import { sourceDefinitions } from './sources.js';

export const SETTINGS_KEY_NAMES = Object.freeze(sourceDefinitions.flatMap((source) => [...source.requiredKeys]));
type KeyName = (typeof SETTINGS_KEY_NAMES)[number];

export interface Settings {
  goalOrdersPerDay: number;
  goalNetMarginPercent: number;
  monthlyOverheadsGbp: number | null;
  cppUkBreakEvenGbp: number;
  cppUkTargetGbp: number;
  cppUsBreakEvenGbp: number;
  cppUsTargetGbp: number;
  paymentFeePercent: number | null;
  startingCogs: { sku: string; unitCostGbp: number | null }[];
  flatFulfilmentUkGbp: number | null;
  flatFulfilmentUsGbp: number | null;
  dispatchCutoffUk: string;
  dispatchCutoffUs: string;
  supplierLeadTimes: { supplier: string; days: number | null }[];
  safetyWeeks: number;
  seasonalMultiplier: number | null;
  markersPerKit: number | null;
  pencilsPerKit: number | null;
  metaOwners: { campaignId: string; owner: 'ours' | 'freelancer' | 'unassigned' }[];
  expectedGoogleCampaigns: { name: string; market: 'UK' | 'US' | 'EU' }[];
  blendedMetaTripwireGbp: number;
  creatorRules: {
    assetCapGbp: number;
    minimumUsageMonths: number;
    pushPriceBeforeExtendingUsage: boolean;
    acceptOpeningOffer: boolean;
    briefPaymentPercent: number;
    deliveryPaymentPercent: number;
    offerCreatorLink: boolean;
    useAffiliateWording: boolean;
  };
  waitingContacts: { business: string; role: string }[];
  deadlines: { label: string; date: string }[];
  keyExpiryDates: { keyName: KeyName; expiresOn: string }[];
  morningSummaryEnabled: boolean;
  brand: 'one-of-one';
}

export interface SettingsSnapshot { version: number; values: Settings }
export interface SettingsSaveResult extends SettingsSnapshot { changedFields: string[] }

export class SettingsValidationError extends Error {
  readonly statusCode = 400;
  constructor(readonly fields: string[] = []) { super('Check the highlighted settings.'); }
}

export class SettingsConflictError extends Error {
  readonly statusCode = 409;
  constructor() { super('Settings changed on another device. Reload before saving.'); }
}

export function defaultSettings(): Settings {
  return {
    goalOrdersPerDay: 100,
    goalNetMarginPercent: 20,
    monthlyOverheadsGbp: null,
    cppUkBreakEvenGbp: 18.56,
    cppUkTargetGbp: 15.78,
    cppUsBreakEvenGbp: 22.70,
    cppUsTargetGbp: 19.30,
    paymentFeePercent: null,
    startingCogs: appConfig.shopify.stockProducts.flatMap((product) => 'sku' in product ? [{ sku: product.sku, unitCostGbp: null }] : []),
    flatFulfilmentUkGbp: null,
    flatFulfilmentUsGbp: null,
    dispatchCutoffUk: appConfig.fulfilment.uk.dispatchCutoff,
    dispatchCutoffUs: appConfig.fulfilment.us.dispatchCutoff,
    supplierLeadTimes: [
      { supplier: 'Rising Games', days: 35 }, { supplier: 'Hedy', days: 2 },
      { supplier: 'Shanghai Joan', days: null }, { supplier: 'Freight forwarder', days: null },
    ],
    safetyWeeks: 3,
    seasonalMultiplier: null,
    markersPerKit: null,
    pencilsPerKit: null,
    metaOwners: appConfig.meta.campaigns.map(({ id, owner }) => ({ campaignId: id, owner })),
    expectedGoogleCampaigns: appConfig.googleAds.expectedCampaigns.map(({ name, market }) => ({ name, market })),
    blendedMetaTripwireGbp: 28,
    creatorRules: {
      assetCapGbp: 200, minimumUsageMonths: 3, pushPriceBeforeExtendingUsage: true,
      acceptOpeningOffer: false, briefPaymentPercent: 50, deliveryPaymentPercent: 50,
      offerCreatorLink: true, useAffiliateWording: false,
    },
    waitingContacts: [], deadlines: [], keyExpiryDates: [],
    morningSummaryEnabled: false, brand: appConfig.brand,
  };
}

function invalid(field: string): never { throw new SettingsValidationError(field ? [field] : []); }

function object(value: unknown, allowed: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid(field);
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) return invalid(field);
  return value as Record<string, unknown>;
}

function number(value: unknown, field: string, max: number, nullable = false, integer = false, min = 0): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
    || (integer ? !Number.isInteger(value) : Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)) return invalid(field);
  return value;
}

function requiredNumber(value: unknown, field: string, max: number, integer = false, min = 0): number {
  return number(value, field, max, false, integer, min)!;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return invalid(field);
  return value;
}

function choice<const T extends readonly string[]>(value: unknown, field: string, choices: T): T[number] {
  if (typeof value !== 'string' || !choices.includes(value)) return invalid(field);
  return value as T[number];
}

function text(value: unknown, field: string, max = 100): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length > max
    || !/^[\p{L}\p{N}][\p{L}\p{N} _.,&'’()+/\-]*$/u.test(value)
    || /[A-Za-z0-9_+\/-]{24,}/.test(value)
    || /(?:sk|pk)[_-](?:live|test|ant)|github_pat_|gh[pousr]_|shpat_/i.test(value)) return invalid(field);
  return value;
}

function businessText(value: unknown, field: string): string {
  const result = text(value, field, 80);
  if (/\+?\d[\d ()-]{7,}\d/.test(result)) return invalid(field);
  return result;
}

function date(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return invalid(field);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid(field);
  return value;
}

function cutoff(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return invalid(field);
  return value;
}

function list<T>(value: unknown, field: string, parse: (row: unknown, path: string) => T, identity: (row: T) => string): T[] {
  if (!Array.isArray(value) || value.length > 50) return invalid(field);
  const rows = value.map((row, index) => parse(row, `${field}.${index}`));
  const names = rows.map((row) => identity(row).toLowerCase());
  if (new Set(names).size !== names.length) return invalid(field);
  return rows;
}

export function validateSettings(input: unknown): Settings {
  const defaults = defaultSettings();
  const value = object(input, Object.keys(defaults), '');
  const rules = object(value.creatorRules, Object.keys(defaults.creatorRules), 'creatorRules');
  const settings: Settings = {
    goalOrdersPerDay: requiredNumber(value.goalOrdersPerDay, 'goalOrdersPerDay', 100_000, true, 1),
    goalNetMarginPercent: requiredNumber(value.goalNetMarginPercent, 'goalNetMarginPercent', 100),
    monthlyOverheadsGbp: number(value.monthlyOverheadsGbp, 'monthlyOverheadsGbp', 10_000_000, true),
    cppUkBreakEvenGbp: requiredNumber(value.cppUkBreakEvenGbp, 'cppUkBreakEvenGbp', 100_000),
    cppUkTargetGbp: requiredNumber(value.cppUkTargetGbp, 'cppUkTargetGbp', 100_000),
    cppUsBreakEvenGbp: requiredNumber(value.cppUsBreakEvenGbp, 'cppUsBreakEvenGbp', 100_000),
    cppUsTargetGbp: requiredNumber(value.cppUsTargetGbp, 'cppUsTargetGbp', 100_000),
    paymentFeePercent: number(value.paymentFeePercent, 'paymentFeePercent', 100, true),
    startingCogs: list(value.startingCogs, 'startingCogs', (row, path) => {
      const parsed = object(row, ['sku', 'unitCostGbp'], path);
      return { sku: text(parsed.sku, `${path}.sku`, 64), unitCostGbp: number(parsed.unitCostGbp, `${path}.unitCostGbp`, 100_000, true) };
    }, (row) => row.sku),
    flatFulfilmentUkGbp: number(value.flatFulfilmentUkGbp, 'flatFulfilmentUkGbp', 100_000, true),
    flatFulfilmentUsGbp: number(value.flatFulfilmentUsGbp, 'flatFulfilmentUsGbp', 100_000, true),
    dispatchCutoffUk: cutoff(value.dispatchCutoffUk, 'dispatchCutoffUk'),
    dispatchCutoffUs: cutoff(value.dispatchCutoffUs, 'dispatchCutoffUs'),
    supplierLeadTimes: list(value.supplierLeadTimes, 'supplierLeadTimes', (row, path) => {
      const parsed = object(row, ['supplier', 'days'], path);
      return { supplier: businessText(parsed.supplier, `${path}.supplier`), days: number(parsed.days, `${path}.days`, 730, true, true) };
    }, (row) => row.supplier),
    safetyWeeks: requiredNumber(value.safetyWeeks, 'safetyWeeks', 104),
    seasonalMultiplier: number(value.seasonalMultiplier, 'seasonalMultiplier', 100, true, false, 0.01),
    markersPerKit: number(value.markersPerKit, 'markersPerKit', 1_000, true, true),
    pencilsPerKit: number(value.pencilsPerKit, 'pencilsPerKit', 1_000, true, true),
    metaOwners: list(value.metaOwners, 'metaOwners', (row, path) => {
      const parsed = object(row, ['campaignId', 'owner'], path);
      if (typeof parsed.campaignId !== 'string' || !/^\d{1,24}$/.test(parsed.campaignId)) return invalid(`${path}.campaignId`);
      return { campaignId: parsed.campaignId, owner: choice(parsed.owner, `${path}.owner`, ['ours', 'freelancer', 'unassigned'] as const) };
    }, (row) => row.campaignId),
    expectedGoogleCampaigns: list(value.expectedGoogleCampaigns, 'expectedGoogleCampaigns', (row, path) => {
      const parsed = object(row, ['name', 'market'], path);
      return { name: text(parsed.name, `${path}.name`), market: choice(parsed.market, `${path}.market`, ['UK', 'US', 'EU'] as const) };
    }, (row) => row.name),
    blendedMetaTripwireGbp: requiredNumber(value.blendedMetaTripwireGbp, 'blendedMetaTripwireGbp', 100_000, false, 0.01),
    creatorRules: {
      assetCapGbp: requiredNumber(rules.assetCapGbp, 'creatorRules.assetCapGbp', 100_000),
      minimumUsageMonths: requiredNumber(rules.minimumUsageMonths, 'creatorRules.minimumUsageMonths', 120, true),
      pushPriceBeforeExtendingUsage: bool(rules.pushPriceBeforeExtendingUsage, 'creatorRules.pushPriceBeforeExtendingUsage'),
      acceptOpeningOffer: bool(rules.acceptOpeningOffer, 'creatorRules.acceptOpeningOffer'),
      briefPaymentPercent: requiredNumber(rules.briefPaymentPercent, 'creatorRules.briefPaymentPercent', 100),
      deliveryPaymentPercent: requiredNumber(rules.deliveryPaymentPercent, 'creatorRules.deliveryPaymentPercent', 100),
      offerCreatorLink: bool(rules.offerCreatorLink, 'creatorRules.offerCreatorLink'),
      useAffiliateWording: bool(rules.useAffiliateWording, 'creatorRules.useAffiliateWording'),
    },
    waitingContacts: list(value.waitingContacts, 'waitingContacts', (row, path) => {
      const parsed = object(row, ['business', 'role'], path);
      return { business: businessText(parsed.business, `${path}.business`), role: businessText(parsed.role, `${path}.role`) };
    }, (row) => `${row.business}/${row.role}`),
    deadlines: list(value.deadlines, 'deadlines', (row, path) => {
      const parsed = object(row, ['label', 'date'], path);
      return { label: text(parsed.label, `${path}.label`), date: date(parsed.date, `${path}.date`) };
    }, (row) => row.label),
    keyExpiryDates: list(value.keyExpiryDates, 'keyExpiryDates', (row, path) => {
      const parsed = object(row, ['keyName', 'expiresOn'], path);
      return { keyName: choice(parsed.keyName, `${path}.keyName`, SETTINGS_KEY_NAMES), expiresOn: date(parsed.expiresOn, `${path}.expiresOn`) };
    }, (row) => row.keyName),
    morningSummaryEnabled: bool(value.morningSummaryEnabled, 'morningSummaryEnabled'),
    brand: choice(value.brand, 'brand', ['one-of-one'] as const),
  };
  if (settings.cppUkTargetGbp > settings.cppUkBreakEvenGbp) invalid('cppUkTargetGbp');
  if (settings.cppUsTargetGbp > settings.cppUsBreakEvenGbp) invalid('cppUsTargetGbp');
  if (Math.abs(settings.creatorRules.briefPaymentPercent + settings.creatorRules.deliveryPaymentPercent - 100) > 0.000001) {
    throw new SettingsValidationError(['creatorRules.briefPaymentPercent', 'creatorRules.deliveryPaymentPercent']);
  }
  return settings;
}

function changedFields(previous: unknown, next: unknown, path = ''): string[] {
  if (JSON.stringify(previous) === JSON.stringify(next)) return [];
  if ((previous && typeof previous === 'object') || (next && typeof next === 'object')) {
    const before = (previous ?? {}) as Record<string, unknown>;
    const after = (next ?? {}) as Record<string, unknown>;
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .flatMap((key) => changedFields(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return [path];
}

async function ensureSettings(db: Database): Promise<void> {
  await db.query('INSERT INTO pulse.settings (values) VALUES ($1) ON CONFLICT (singleton) DO NOTHING', [JSON.stringify(defaultSettings())]);
}

export async function readSettings(db: Database): Promise<SettingsSnapshot> {
  await ensureSettings(db);
  const { rows } = await db.query<{ version: number; values: Settings }>('SELECT version, values FROM pulse.settings WHERE singleton = true');
  if (!rows[0]) throw new Error('Settings are unavailable');
  return { version: rows[0].version, values: validateSettings(rows[0].values) };
}

export async function saveSettings(db: Database, input: unknown, credentialId: string): Promise<SettingsSaveResult> {
  const request = object(input, ['version', 'values'], '');
  const version = requiredNumber(request.version, '', 2_147_483_646, true);
  const values = validateSettings(request.values);
  return db.transaction(async (transaction) => {
    await ensureSettings(transaction);
    const current = await transaction.query<{ version: number; values: Settings }>(
      'SELECT version, values FROM pulse.settings WHERE singleton = true FOR UPDATE',
    );
    const row = current.rows[0];
    if (!row) throw new Error('Settings are unavailable');
    if (row.version !== version) throw new SettingsConflictError();
    const fields = changedFields(validateSettings(row.values), values);
    if (fields.length === 0) return { version, values, changedFields: [] };
    await transaction.query('UPDATE pulse.settings SET values = $1, version = version + 1, updated_at = now() WHERE singleton = true', [JSON.stringify(values)]);
    for (const field of fields) {
      await transaction.query(`
        WITH entry AS (
          INSERT INTO pulse.audit_log (event, credential_id) VALUES ('settings_changed', $1) RETURNING id
        )
        INSERT INTO pulse.settings_changes (audit_id, field) SELECT id, $2 FROM entry
      `, [credentialId, field]);
    }
    return { version: version + 1, values, changedFields: fields };
  });
}
