import { appConfig } from '../config.js';
import { ShopifyError, Transport } from './http.js';

export class TokenManager {
  private token?: { value: string; renewAt: number };
  private pending?: Promise<string>;
  constructor(private readonly env: NodeJS.ProcessEnv, private readonly transport: Transport) {}
  invalidate(): void { this.token = undefined; }
  async get(): Promise<string> {
    if (this.token && this.transport.now() < this.token.renewAt) return this.token.value;
    if (this.pending) return this.pending;
    this.pending = this.exchange();
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  private async exchange(): Promise<string> {
    const started = this.transport.now();
    const body = await this.transport.request(`https://${appConfig.shopify.storeDomain}/admin/oauth/access_token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.env.SHOPIFY_CLIENT_ID!, client_secret: this.env.SHOPIFY_CLIENT_SECRET! }),
    });
    if (typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(body.expires_in) || body.expires_in <= 60) throw new ShopifyError('invalid');
    this.token = { value: body.access_token, renewAt: started + Math.min(20 * 3600, body.expires_in - 60) * 1000 };
    return this.token.value;
  }
}
