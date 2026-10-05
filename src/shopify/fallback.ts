import { appConfig } from '../config.js';
import { ShopifyError, Transport } from './http.js';
import { cleanSessions } from './model.js';
export interface DailySessionFallback { read(day: string): Promise<any>; }
// A narrow read-only adapter for the connector routine, not the stage-5 HQ client.
export class RoutineSessions implements DailySessionFallback {
  constructor(private readonly transport: Transport, private readonly env: NodeJS.ProcessEnv) {}
  async read(day: string): Promise<any> {
    if (!this.env.GITHUB_HQ_TOKEN?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ShopifyError('denied');
    const { owner, repository } = appConfig.github;
    const path = `${appConfig.shopify.sessionFallbackPath}/${day}.json`;
    const response = await this.transport.request(`https://api.github.com/repos/${owner}/${repository}/contents/${path}?ref=main`, {
      method: 'GET', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.env.GITHUB_HQ_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (response.encoding !== 'base64' || typeof response.content !== 'string' || response.size > 1_048_576) throw new ShopifyError('invalid');
    let table;
    try { table = JSON.parse(Buffer.from(response.content, 'base64').toString('utf8')); }
    catch { throw new ShopifyError('invalid'); }
    // The file carries the real ShopifyQL tableData envelope. Never store a whole HQ file.
    const rows = cleanSessions(table);
    if (rows.length !== 1 || rows[0].day !== day) throw new ShopifyError('invalid');
    return table;
  }
}
