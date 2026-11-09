import { MAILCHIMP_API_VERSION, MailchimpReadError, type MailchimpReader } from './client.js';

export const MAILCHIMP_PROBE_CAMPAIGN_LIMIT = 3;
export interface MailchimpProbeCheck {
  endpoint: string; state: 'answered' | 'failed' | 'deferred' | 'skipped';
  fieldNames: string[]; code?: string; status?: number; retryAt?: string;
}
export interface MailchimpProbeResult { checks: MailchimpProbeCheck[]; flowCoverage: 'unknown'; complete: boolean }
export interface MailchimpProbeOptions { campaignIds?: readonly string[]; line?: (line: string) => void }

/** Only schema paths reach the terminal; response values and business identifiers never do. */
function safeFields(fields: readonly string[]): string[] {
  return [...new Set(fields.filter(field => typeof field === 'string' && field.length <= 160
    && /^[A-Za-z_][A-Za-z0-9_]*(?:(?:\[\])|(?:\.[A-Za-z_][A-Za-z0-9_]*))*$/.test(field)))].sort();
}
const campaignId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const endpoint = (path: string) => `GET /${MAILCHIMP_API_VERSION}${path}`;
const safeCodes = new Set(['http','network','invalid','pagination','rate_limit']);

/** Read-only probe. Each endpoint is independent; answering a campaign does not prove flow coverage. */
export async function runMailchimpProbe(client: MailchimpReader, options: MailchimpProbeOptions = {}): Promise<MailchimpProbeResult> {
  const checks: MailchimpProbeCheck[] = [];
  const emit = (check: MailchimpProbeCheck) => {
    checks.push(check);
    options.line?.(`${check.endpoint}: ${check.state}`
      + (check.code ? ` (${check.code}${check.status ? ` ${check.status}` : ''})` : '')
      + (check.retryAt ? `; next permitted attempt ${check.retryAt}` : '')
      + (check.state === 'answered' ? `; fields: ${check.fieldNames.join(', ') || '(none reported)'}` : ''));
  };
  async function read<T>(path: string, fetch: () => Promise<{data: T; fieldNames: string[]}>): Promise<T | undefined> {
    try {
      const result = await fetch();
      emit({endpoint: endpoint(path), state: 'answered', fieldNames: safeFields(result.fieldNames)});
      return result.data;
    } catch (error) {
      const known = error instanceof MailchimpReadError;
      const code = known && safeCodes.has(error.code) ? error.code : 'unavailable';
      const status = known && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined;
      const retryDate = known && error.retryAt != null && Number.isFinite(error.retryAt) && error.retryAt > 0 ? new Date(error.retryAt) : null;
      const retryAt = retryDate && Number.isFinite(retryDate.getTime()) ? retryDate.toISOString() : undefined;
      emit({endpoint: endpoint(path), state: code === 'rate_limit' && retryAt ? 'deferred' : 'failed', fieldNames: [], code, status, retryAt});
      return undefined;
    }
  }
  const campaigns = await read('/campaigns', () => client.campaigns());
  const flowEmails = campaigns?.filter(row => row.type === 'automation-email') ?? [];
  const discovered = flowEmails.length ? flowEmails : campaigns ?? [];
  // Flow ids and UTM prefixes in appConfig are not campaign ids. Only API ids or explicit arguments qualify.
  const selected = [...new Set((options.campaignIds?.length ? options.campaignIds : discovered.map(row => row.id))
    .filter(campaignId))].slice(0, MAILCHIMP_PROBE_CAMPAIGN_LIMIT);
  if (!selected.length) {
    for (const path of ['/reports/{id}', '/campaigns/{id}', '/ecommerce/orders?campaign_id={id}'])
      emit({endpoint: endpoint(path), state: 'skipped', fieldNames: []});
    options.line?.('Campaign checks: no campaign id was available from the API or explicit arguments.');
  }
  for (const id of selected) {
    await read('/reports/{id}', () => client.report(id));
    await read('/campaigns/{id}', () => client.campaign(id));
    await read('/ecommerce/orders?campaign_id={id}', () => client.orders(id));
  }
  await read('/lists/{id}', () => client.audience());
  options.line?.('Flow email coverage: unknown; these endpoints do not establish which campaigns belong to the configured flows.');
  return { checks, flowCoverage: 'unknown', complete: checks.every(check => check.state === 'answered') };
}
