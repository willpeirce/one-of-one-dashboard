import { createECDH, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
  type AuthenticatorTransport,
} from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from './db.js';
import type { RuntimeConfig } from './runtime.js';

export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const CHALLENGE_SECONDS = 300;
type Credential = Record<string, unknown> & {
  id: string; public_key: Uint8Array; counter: string | number; transports: AuthenticatorTransport[];
};
type AuditEvent = 'device_added' | 'device_rejected' | 'sign_in' | 'sign_in_rejected' | 'sign_out' | 'rate_limited';

export async function audit(db: Database, event: AuditEvent, credentialId?: string): Promise<void> {
  await db.query('INSERT INTO pulse.audit_log(event, credential_id) VALUES ($1, $2)', [event, credentialId ?? null]);
}

export class Auth {
  private constructor(readonly db: Database, readonly config: RuntimeConfig, private readonly key: Buffer, private readonly userId: string) {}

  static async create(db: Database, config: RuntimeConfig): Promise<Auth> {
    await db.transaction(async tx => {
      await tx.query('INSERT INTO pulse_private.owner(singleton, user_id) VALUES (true, $1) ON CONFLICT DO NOTHING', [randomBytes(32).toString('base64url')]);
      await tx.query('INSERT INTO pulse_private.app_secrets(name, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', ['session_hmac', randomBytes(32)]);
      const push = createECDH('prime256v1');
      push.generateKeys();
      // A single row keeps the pair atomic; push delivery is a later stage.
      await tx.query('INSERT INTO pulse_private.app_secrets(name, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', ['push_key_pair', Buffer.from(JSON.stringify({ publicKey: push.getPublicKey().toString('base64url'), privateKey: push.getPrivateKey().toString('base64url') }))]);
    });
    const secret = await db.query<{ value: Uint8Array }>('SELECT value FROM pulse_private.app_secrets WHERE name = $1', ['session_hmac']);
    const owner = await db.query<{ user_id: string }>('SELECT user_id FROM pulse_private.owner WHERE singleton = true');
    if (!secret.rows[0] || !owner.rows[0]) throw new Error('Authentication initialization failed');
    return new Auth(db, config, Buffer.from(secret.rows[0].value), owner.rows[0].user_id);
  }

  get sessionCookie(): string { return this.config.secureCookies ? '__Host-pulse_session' : 'pulse_session'; }
  get challengeCookie(): string { return this.config.secureCookies ? '__Host-pulse_challenge' : 'pulse_challenge'; }

  private hash(value: string): string { return createHmac('sha256', this.key).update(value).digest('hex'); }

  private setCookie(reply: FastifyReply, name: string, value: string, maxAge: number): void {
    reply.setCookie(name, value, { path: '/', httpOnly: true, secure: this.config.secureCookies, sameSite: 'strict', maxAge });
  }

  private clearCookie(reply: FastifyReply, name: string): void {
    reply.clearCookie(name, { path: '/', httpOnly: true, secure: this.config.secureCookies, sameSite: 'strict' });
  }

  async session(request: FastifyRequest): Promise<string | null> {
    const token = request.cookies[this.sessionCookie];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = await this.db.query<{ credential_id: string }>(
      'SELECT credential_id FROM pulse_private.sessions WHERE token_hash = $1 AND expires_at > now()', [this.hash(token)],
    );
    return result.rows[0]?.credential_id ?? null;
  }

  async cleanup(): Promise<void> {
    await this.db.query('DELETE FROM pulse_private.sessions WHERE expires_at <= now()');
    await this.db.query('DELETE FROM pulse_private.challenges WHERE expires_at <= now()');
    await this.db.query("DELETE FROM pulse_private.rate_limits WHERE window_started_at < now() - interval '1 day'");
  }

  // Store HMACs, never raw addresses. Ignore forwarded headers so clients cannot reset their limit.
  private async limit(request: FastifyRequest, reply: FastifyReply, scope: string, perPeer: number, global: number): Promise<boolean> {
    for (const [bucket, max] of [[`${scope}:peer:${request.ip}`, perPeer], [`${scope}:global`, global]] as const) {
      const result = await this.db.query<{ attempts: number }>(`
        INSERT INTO pulse_private.rate_limits(bucket_hash, window_started_at, attempts) VALUES ($1, now(), 1)
        ON CONFLICT (bucket_hash) DO UPDATE SET
          attempts = CASE WHEN rate_limits.window_started_at <= now() - interval '15 minutes' THEN 1 ELSE rate_limits.attempts + 1 END,
          window_started_at = CASE WHEN rate_limits.window_started_at <= now() - interval '15 minutes' THEN now() ELSE rate_limits.window_started_at END
        RETURNING attempts`, [this.hash(bucket)]);
      if ((result.rows[0]?.attempts ?? max + 1) > max) {
        // Only log the first rejected attempt in each window to bound audit volume.
        if (result.rows[0]?.attempts === max + 1) await audit(this.db, 'rate_limited');
        reply.header('Retry-After', '900').code(429).send({ error: 'Too many attempts. Try again in 15 minutes.' });
        return false;
      }
    }
    return true;
  }

  private async challenge(reply: FastifyReply, challenge: string, kind: string): Promise<void> {
    const id = randomBytes(32).toString('base64url');
    await this.db.query("INSERT INTO pulse_private.challenges(id_hash, challenge, kind, expires_at) VALUES ($1, $2, $3, now() + interval '5 minutes')", [this.hash(id), challenge, kind]);
    this.setCookie(reply, this.challengeCookie, id, CHALLENGE_SECONDS);
  }

  private async consumeChallenge(request: FastifyRequest, reply: FastifyReply, kind: string): Promise<string | null> {
    const id = request.cookies[this.challengeCookie];
    this.clearCookie(reply, this.challengeCookie);
    if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    const result = await this.db.query<{ challenge: string }>(
      'DELETE FROM pulse_private.challenges WHERE id_hash = $1 AND kind = $2 AND expires_at > now() RETURNING challenge', [this.hash(id), kind],
    );
    return result.rows[0]?.challenge ?? null;
  }

  private async newSession(tx: Database, credentialId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await tx.query("INSERT INTO pulse_private.sessions(token_hash, credential_id, expires_at) VALUES ($1, $2, now() + interval '30 days')", [this.hash(token), credentialId]);
    return token;
  }

  private async reject(reply: FastifyReply, event: AuditEvent): Promise<void> {
    await audit(this.db, event);
    reply.code(400).send({ error: 'Could not verify this device. Please try again.' });
  }

  registerRoutes(app: FastifyInstance): void {
    app.post<{ Body: { setupCode: string } }>('/auth/register/options', {
      schema: { body: { type: 'object', required: ['setupCode'], additionalProperties: false, properties: { setupCode: { type: 'string', maxLength: 1024 } } } },
    }, async (request, reply) => {
      if (!await this.limit(request, reply, 'setup', 5, 20)) return;
      const expected = this.config.setupCode;
      if (!expected || !timingSafeEqual(Buffer.from(this.hash(request.body.setupCode)), Buffer.from(this.hash(expected)))) {
        await this.reject(reply, 'device_rejected'); return;
      }
      const credentials = await this.db.query<Credential>('SELECT id, transports FROM pulse_private.credentials');
      const options = await generateRegistrationOptions({
        rpName: 'One of One Pulse', rpID: this.config.rpId,
        userName: 'Will', userDisplayName: 'One of One Pulse', userID: new Uint8Array(Buffer.from(this.userId, 'base64url')),
        attestationType: 'none',
        supportedAlgorithmIDs: [-7, -257],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: credentials.rows.map(row => ({ id: row.id, transports: row.transports })),
      });
      await this.challenge(reply, options.challenge, 'registration');
      return options;
    });

    app.post<{ Body: { response: RegistrationResponseJSON } }>('/auth/register/verify', {
      schema: { body: { type: 'object', required: ['response'], additionalProperties: false, properties: { response: { type: 'object', additionalProperties: true } } } },
    }, async (request, reply) => {
      if (!await this.limit(request, reply, 'verify', 20, 80)) return;
      const challenge = await this.consumeChallenge(request, reply, 'registration');
      if (!challenge) { await this.reject(reply, 'device_rejected'); return; }
      let verification;
      try {
        verification = await verifyRegistrationResponse({ response: request.body.response, expectedChallenge: challenge, expectedOrigin: this.config.origin, expectedRPID: this.config.rpId, requireUserVerification: true });
      } catch { await this.reject(reply, 'device_rejected'); return; }
      if (!verification.verified || !verification.registrationInfo) { await this.reject(reply, 'device_rejected'); return; }
      const { credential } = verification.registrationInfo;
      const token = await this.db.transaction(async tx => {
        const result = await tx.query('INSERT INTO pulse_private.credentials(id, public_key, counter, transports) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id', [credential.id, Buffer.from(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? [])]);
        if (!result.rowCount) return null;
        const token = await this.newSession(tx, credential.id);
        await audit(tx, 'device_added', credential.id);
        return token;
      });
      if (!token) { await this.reject(reply, 'device_rejected'); return; }
      this.setCookie(reply, this.sessionCookie, token, SESSION_SECONDS);
      return { ok: true };
    });

    app.post('/auth/login/options', async (request, reply) => {
      if (!await this.limit(request, reply, 'login', 20, 80)) return;
      const options = await generateAuthenticationOptions({ rpID: this.config.rpId, userVerification: 'required' });
      await this.challenge(reply, options.challenge, 'authentication');
      return options;
    });

    app.post<{ Body: { response: AuthenticationResponseJSON } }>('/auth/login/verify', {
      schema: { body: { type: 'object', required: ['response'], additionalProperties: false, properties: { response: { type: 'object', additionalProperties: true } } } },
    }, async (request, reply) => {
      if (!await this.limit(request, reply, 'verify', 20, 80)) return;
      const challenge = await this.consumeChallenge(request, reply, 'authentication');
      const response = request.body.response;
      if (!challenge || typeof response.id !== 'string' || response.id.length > 2048 || response.response?.userHandle !== this.userId) {
        await this.reject(reply, 'sign_in_rejected'); return;
      }
      const token = await this.db.transaction(async tx => {
        const result = await tx.query<Credential>('SELECT id, public_key, counter, transports FROM pulse_private.credentials WHERE id = $1 FOR UPDATE', [response.id]);
        const credential = result.rows[0];
        if (!credential) return null;
        let verified;
        try {
          verified = await verifyAuthenticationResponse({
            response, expectedChallenge: challenge, expectedOrigin: this.config.origin, expectedRPID: this.config.rpId,
            credential: { id: credential.id, publicKey: new Uint8Array(credential.public_key), counter: Number(credential.counter), transports: credential.transports },
            requireUserVerification: true,
          });
        } catch { return null; }
        if (!verified.verified) return null;
        await tx.query('UPDATE pulse_private.credentials SET counter = $1, last_used_at = now() WHERE id = $2', [verified.authenticationInfo.newCounter, credential.id]);
        const token = await this.newSession(tx, credential.id);
        await audit(tx, 'sign_in', credential.id);
        return token;
      });
      if (!token) { await this.reject(reply, 'sign_in_rejected'); return; }
      this.setCookie(reply, this.sessionCookie, token, SESSION_SECONDS);
      return { ok: true };
    });

    app.post('/auth/logout', async (request, reply) => {
      const token = request.cookies[this.sessionCookie];
      if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
        await this.db.transaction(async tx => {
          const deleted = await tx.query<{ credential_id: string }>('DELETE FROM pulse_private.sessions WHERE token_hash = $1 RETURNING credential_id', [this.hash(token)]);
          if (deleted.rows[0]) await audit(tx, 'sign_out', deleted.rows[0].credential_id);
        });
      }
      this.clearCookie(reply, this.sessionCookie);
      this.clearCookie(reply, this.challengeCookie);
      return { ok: true };
    });
  }
}
