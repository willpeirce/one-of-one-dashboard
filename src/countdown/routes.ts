// Public image for the Black Friday 2026 email: GET /e/bf26-countdown.gif?m=uk|us.
// No sign-in, no cookie, nothing stored. The client address and user agent pick a variant and are then dropped.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { chooseVariant, renderCountdownGif, variantKey, type Market } from './render.js';

export const COUNTDOWN_PATH = '/e/bf26-countdown.gif';
const CACHE_LIMIT = 8;

/** Apple Mail Privacy Protection prefetches through Apple's own network, 17.0.0.0/8. */
export function isAppleAddress(address: string | undefined): boolean {
  if (!address) return false;
  const v4 = address.trim().toLowerCase().replace(/^::ffff:/, '');
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (!match || match.slice(1).some(octet => Number(octet) > 255)) return false;
  return Number(match[1]) === 17;
}

/**
 * Whether to serve Apple's still. The app runs with trustProxy off; X-Forwarded-For is read here only to pick
 * an image, never for access or limits, so a spoofed header changes nothing but which picture comes back.
 */
export function isAppleProxy(request: Pick<FastifyRequest, 'headers' | 'socket'>): boolean {
  const agent = request.headers['user-agent'] ?? '';
  if (agent.includes('GoogleImageProxy')) return false; // Gmail's proxy re-fetches on open: keep it live
  const forwarded = request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return isAppleAddress(first || request.socket.remoteAddress);
}

export function parseMarket(query: unknown): Market {
  const raw = query && typeof query === 'object' ? (query as Record<string, unknown>).m : undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim().toLowerCase() === 'us' ? 'us' : 'uk';
}

export function registerCountdown(app: FastifyInstance, clock: () => Date = () => new Date(), render = renderCountdownGif): void {
  // One render per variant per whole second, however many opens arrive at send time.
  const cache = new Map<string, Buffer>();
  app.get(COUNTDOWN_PATH, async (request, reply) => {
    const variant = chooseVariant(clock().getTime() / 1000, parseMarket(request.query), isAppleProxy(request));
    const key = variantKey(variant);
    let gif = cache.get(key);
    if (!gif) {
      gif = render(variant);
      cache.set(key, gif);
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    }
    return reply
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .header('Expires', '0')
      .type('image/gif')
      .send(gif);
  });
}
