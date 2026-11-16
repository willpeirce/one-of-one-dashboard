import {GorgiasReadError, type GorgiasProbePage, type GorgiasProbeReader} from './client.js';

export interface GorgiasProbeResult {complete: boolean; checks: {endpoint: 'tickets' | 'views'; answered: boolean}[]}
/** Two independent single-page GETs. No ticket value or cursor enters the output. */
export async function runGorgiasProbe(client: GorgiasProbeReader, line: (text: string) => void = console.log): Promise<GorgiasProbeResult> {
  const checks: GorgiasProbeResult['checks'] = [];
  async function read(endpoint: 'tickets' | 'views', load: () => Promise<GorgiasProbePage>): Promise<void> {
    try {
      const result = await load();
      checks.push({endpoint, answered: true});
      const fields = result.fieldNames.filter(field => /^(?:[a-z_][a-z0-9_]*)(?:(?:\[\])?\.[a-z_][a-z0-9_]*)*$/.test(field)).slice(0, 80);
      line(`GET /api/${endpoint}: ${result.count} rows; fields: ${fields.join(', ') || '(none reported)'}.`);
      line(`Pagination: meta=${result.pagination.meta}; next_cursor=${result.pagination.nextCursor}; prev_cursor=${result.pagination.previousCursor}.`);
      if (endpoint === 'views') for (const view of result.views ?? []) line(`View ${view.id}: ${view.name}`);
    } catch (error) {
      checks.push({endpoint, answered: false});
      const allowed = new Set(['http','network','invalid','pagination','rate_limit','budget']);
      const code = error instanceof GorgiasReadError && allowed.has(error.code) ? error.code : 'unavailable';
      const status = error instanceof GorgiasReadError && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? ` ${error.status}` : '';
      line(`GET /api/${endpoint}: failed (${code}${status}); no response values printed.`);
    }
  }
  await read('tickets', () => client.probeTickets());
  await read('views', () => client.probeViews());
  return {complete: checks.every(check => check.answered), checks};
}
