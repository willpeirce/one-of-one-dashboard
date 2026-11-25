import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createApp } from '../src/app.js';
import { readRuntime } from '../src/runtime.js';
import { createTestDatabase } from './helpers/database.js';
import { composite, decodeGif, pixelHex } from './helpers/gif-decode.js';
import { encodeGif, lzwEncode } from '../src/countdown/gif.js';
import { GLYPH_SPECS } from '../src/countdown/glyph-specs.js';
import {
  BF26_DEADLINES_UNIX, GIF_HEIGHT, GIF_WIDTH, LIVE_FRAMES, chooseVariant, countdownPalette, countdownParts,
  firstFramePixels, formatCountdown, renderCountdownGif, type CountdownVariant,
} from '../src/countdown/render.js';
import { COUNTDOWN_PATH, isAppleAddress, isAppleProxy, parseMarket, registerCountdown } from '../src/countdown/routes.js';

const BACKGROUND = '#1a1a1d';
const DIGIT_BLUE = '#52c5d1';
const LEFT = 20 * 3600 + 41 * 60 + 13; // 20:41:13
const UK = BF26_DEADLINES_UNIX.uk, US = BF26_DEADLINES_UNIX.us;
const GAP = US - UK; // the five hours the UK is open while the US still counts down
/** A clock this many seconds before the UK deadline (the US then has GAP more). */
const at = (secondsLeft: number) => new Date((UK - secondsLeft) * 1000);

function expectedRgb(variant: CountdownVariant): Uint8Array {
  const palette = countdownPalette(), indices = firstFramePixels(variant), rgb = new Uint8Array(indices.length * 3);
  indices.forEach((index, i) => rgb.set(palette.subarray(index * 3, index * 3 + 3), i * 3));
  return rgb;
}

async function countdownApp(now: () => Date, render = renderCountdownGif) {
  const app = Fastify({ logger: false });
  registerCountdown(app, now, render);
  await app.ready();
  return app;
}

test('countdown time reads HH:MM:SS, with three-digit hours days ahead and zero at the end', () => {
  assert.equal(formatCountdown(LEFT), '20:41:13');
  assert.equal(formatCountdown(157 * 3600 + 3 * 60 + 25), '157:03:25');
  assert.equal(formatCountdown(3600), '01:00:00');
  assert.equal(formatCountdown(59.9), '00:00:59');
  assert.equal(formatCountdown(0), '00:00:00');
  assert.equal(formatCountdown(-30), '00:00:00');
  assert.deepEqual(countdownParts(100 * 3600), { hours: '100', minutes: '00', seconds: '00' });
});

test('deadlines: UK Friday 27 Nov 2026 07:00 UK; US 07:00 New York, which is 12:00 UK', () => {
  const uk = new Date(UK * 1000), us = new Date(US * 1000);
  assert.equal(UK, 1795762800);
  assert.equal(US, 1795780800);
  assert.equal(uk.toISOString(), '2026-11-27T07:00:00.000Z');
  assert.equal(uk.toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false }), '27/11/2026, 07:00:00');
  assert.equal(us.toISOString(), '2026-11-27T12:00:00.000Z');
  assert.equal(us.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false }), '11/27/2026, 07:00:00');
  assert.equal(us.toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false }), '27/11/2026, 12:00:00');
  assert.equal(GAP, 5 * 3600);
  // Apple's stills name the same times.
  const text = (id: string) => GLYPH_SPECS.find(spec => spec.id === id)?.text;
  assert.equal(text('still-uk'), 'FRIDAY 7AM');
  assert.equal(text('still-us'), 'FRIDAY 7AM ET');
});

test('variants before both deadlines: each market counts to its own, Apple gets its market still', () => {
  const now = UK - LEFT;
  assert.deepEqual(chooseVariant(now + 0.7, 'uk', false), { kind: 'live', remaining: LEFT });
  assert.deepEqual(chooseVariant(now, 'uk', false), { kind: 'live', remaining: LEFT });
  assert.deepEqual(chooseVariant(now, 'us', false), { kind: 'live', remaining: LEFT + GAP });
  assert.deepEqual(chooseVariant(now, 'uk', true), { kind: 'still', market: 'uk' });
  assert.deepEqual(chooseVariant(now, 'us', true), { kind: 'still', market: 'us' });
  assert.deepEqual(chooseVariant(UK - 1, 'uk', false), { kind: 'live', remaining: 1 });
  assert.deepEqual(chooseVariant(UK - 1, 'uk', true), { kind: 'still', market: 'uk' });
  // The old shared 06:00 UK deadline no longer opens anything.
  assert.deepEqual(chooseVariant(1795759200, 'uk', false), { kind: 'live', remaining: 3600 });
  assert.deepEqual(chooseVariant(1795759200, 'us', false), { kind: 'live', remaining: 3600 + GAP });
  assert.deepEqual(chooseVariant(1795759200, 'us', true), { kind: 'still', market: 'us' });
});

test('variants between the deadlines: UK open for everyone, US still live, Apple still for the US only', () => {
  for (const now of [UK, UK + 0.9, UK + 1, UK + 3600, UK + GAP / 2, US - 1]) {
    for (const apple of [false, true]) assert.deepEqual(chooseVariant(now, 'uk', apple), { kind: 'open' }, `uk ${now} ${apple}`);
    assert.deepEqual(chooseVariant(now, 'us', false), { kind: 'live', remaining: US - Math.floor(now) }, `us ${now}`);
    assert.deepEqual(chooseVariant(now, 'us', true), { kind: 'still', market: 'us' }, `us apple ${now}`);
  }
  assert.deepEqual(chooseVariant(UK, 'us', false), { kind: 'live', remaining: GAP });
  assert.deepEqual(chooseVariant(US - 1, 'us', false), { kind: 'live', remaining: 1 });
});

test('variants at and after the US deadline: open for everyone in both markets', () => {
  for (const now of [US, US + 0.5, US + 1, US + 86_400]) {
    for (const market of ['uk', 'us'] as const) {
      for (const apple of [false, true]) assert.deepEqual(chooseVariant(now, market, apple), { kind: 'open' }, `${market} ${now} ${apple}`);
    }
  }
});

test('Apple proxy detection: 17.0.0.0/8 from the first forwarded address, else the socket; Gmail stays live', () => {
  for (const address of ['17.0.0.1', '17.58.101.9', '::ffff:17.1.2.3', ' 17.255.255.255 ']) assert.equal(isAppleAddress(address), true, address);
  for (const address of ['170.1.2.3', '18.0.0.1', '117.1.2.3', '17.1.2', '17.1.2.300', '2620:149::1', 'unknown', '', undefined]) {
    assert.equal(isAppleAddress(address), false, String(address));
  }
  const request = (headers: Record<string, string | string[]>, socket = '10.0.0.5') => ({ headers, socket: { remoteAddress: socket } }) as unknown as Parameters<typeof isAppleProxy>[0];
  assert.equal(isAppleProxy(request({ 'x-forwarded-for': '17.58.1.2, 10.0.0.1' })), true);
  assert.equal(isAppleProxy(request({ 'x-forwarded-for': '10.0.0.1, 17.58.1.2' })), false);
  assert.equal(isAppleProxy(request({ 'x-forwarded-for': ['17.58.1.2', '10.0.0.1'] })), true);
  assert.equal(isAppleProxy(request({}, '17.9.9.9')), true);
  assert.equal(isAppleProxy(request({}, '::ffff:17.9.9.9')), true);
  assert.equal(isAppleProxy(request({ 'x-forwarded-for': '' }, '17.9.9.9')), true);
  assert.equal(isAppleProxy(request({}, '66.249.84.1')), false);
  assert.equal(isAppleProxy(request({ 'x-forwarded-for': '17.58.1.2', 'user-agent': 'Mozilla/5.0 (via ggpht.com GoogleImageProxy)' })), false);
  assert.equal(parseMarket({ m: 'us' }), 'us');
  assert.equal(parseMarket({ m: 'US' }), 'us');
  assert.equal(parseMarket({ m: ['us', 'uk'] }), 'us');
  for (const query of [{}, { m: 'uk' }, { m: 'eu' }, { m: '' }, undefined]) assert.equal(parseMarket(query), 'uk');
});

test('the live GIF is valid GIF89a: 60 one-second frames, no loop, sub-rectangles that rebuild every second', () => {
  const gif = decodeGif(renderCountdownGif({ kind: 'live', remaining: LEFT }));
  assert.equal(gif.version, 'GIF89a');
  assert.equal(gif.width, GIF_WIDTH);
  assert.equal(gif.height, GIF_HEIGHT);
  assert.equal(GIF_WIDTH, 1200);
  assert.ok(GIF_HEIGHT >= 260 && GIF_HEIGHT <= 300);
  assert.equal(gif.trailer, true);
  assert.deepEqual(gif.applicationExtensions, [], 'no NETSCAPE2.0 loop extension');
  assert.equal(gif.frames.length, LIVE_FRAMES);
  assert.equal(LIVE_FRAMES, 60);
  assert.ok(gif.globalPalette && gif.globalPalette.length === 256 * 3);
  assert.equal(pixelHex(gif.globalPalette, 1, 0, 0), BACKGROUND, 'palette index 0 is the email background');
  for (const frame of gif.frames) {
    assert.equal(frame.delayCs, 100);
    assert.equal(frame.disposal, 1, 'do not dispose');
  }
  assert.deepEqual([gif.frames[0]!.x, gif.frames[0]!.y, gif.frames[0]!.width, gif.frames[0]!.height], [0, 0, GIF_WIDTH, GIF_HEIGHT]);
  // 20:41:13 -> 20:41:12 changes one seconds digit only.
  assert.ok(gif.frames[1]!.width < 100 && gif.frames[1]!.height < 130, 'later frames carry only what changed');

  const first = composite(gif, 0);
  assert.deepEqual(first, expectedRgb({ kind: 'live', remaining: LEFT }));
  assert.equal(pixelHex(first, GIF_WIDTH, 0, 0), BACKGROUND);
  assert.equal(pixelHex(first, GIF_WIDTH, GIF_WIDTH - 1, GIF_HEIGHT - 1), BACKGROUND);
  assert.equal(pixelHex(first, GIF_WIDTH, GIF_WIDTH / 2, 10), BACKGROUND);
  const indices = firstFramePixels({ kind: 'live', remaining: LEFT });
  const solid = indices.indexOf(2 * 63); // the digit ink at full strength
  assert.ok(solid > 0);
  assert.equal(pixelHex(first, GIF_WIDTH, solid % GIF_WIDTH, Math.floor(solid / GIF_WIDTH)), DIGIT_BLUE);
  assert.deepEqual(composite(gif, 1), expectedRgb({ kind: 'live', remaining: LEFT - 1 }));
  assert.deepEqual(composite(gif, 59), expectedRgb({ kind: 'live', remaining: LEFT - 59 }));
});

test('a live GIF that reaches zero holds 00:00:00, and the hour width can change mid-minute', () => {
  const ending = decodeGif(renderCountdownGif({ kind: 'live', remaining: 20 }));
  assert.equal(ending.frames.length, 60);
  const zero = expectedRgb({ kind: 'live', remaining: 0 });
  assert.deepEqual(composite(ending, 20), zero);
  assert.deepEqual(composite(ending, 59), zero);
  assert.deepEqual([ending.frames[40]!.width, ending.frames[40]!.height], [1, 1], 'an unchanged second is a 1x1 no-op');

  const hundred = decodeGif(renderCountdownGif({ kind: 'live', remaining: 100 * 3600 + 5 }));
  assert.deepEqual(composite(hundred, 0), expectedRgb({ kind: 'live', remaining: 100 * 3600 + 5 }));
  assert.deepEqual(composite(hundred, 59), expectedRgb({ kind: 'live', remaining: 100 * 3600 - 54 }));
});

test('stills are one frame on the same flat background, edge to edge', () => {
  const variants: CountdownVariant[] = [{ kind: 'open' }, { kind: 'still', market: 'uk' }, { kind: 'still', market: 'us' }, { kind: 'live', remaining: LEFT }];
  const firsts = variants.map(variant => {
    const gif = decodeGif(renderCountdownGif(variant));
    if (variant.kind !== 'live') {
      assert.equal(gif.frames.length, 1);
      assert.equal(gif.trailer, true);
    }
    const rgb = composite(gif, 0);
    assert.deepEqual(rgb, expectedRgb(variant));
    for (let x = 0; x < GIF_WIDTH; x++) for (const y of [0, 1, GIF_HEIGHT - 2, GIF_HEIGHT - 1]) assert.equal(pixelHex(rgb, GIF_WIDTH, x, y), BACKGROUND);
    for (let y = 0; y < GIF_HEIGHT; y++) for (const x of [0, GIF_WIDTH - 1]) assert.equal(pixelHex(rgb, GIF_WIDTH, x, y), BACKGROUND);
    return Buffer.from(rgb).toString('base64');
  });
  assert.equal(new Set(firsts).size, variants.length, 'each variant draws different words');
});

test('LZW survives dictionary resets and the encoder rejects bad input', () => {
  let seed = 7;
  const noise = Uint8Array.from({ length: 120_000 }, () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24);
  const palette = new Uint8Array(256 * 3).map((_, i) => i % 256);
  const gif = decodeGif(encodeGif({ width: 400, height: 300, palette, frames: [{ x: 0, y: 0, width: 400, height: 300, pixels: noise, delayCs: 0 }] }));
  assert.deepEqual(gif.frames[0]!.indices, noise);
  assert.ok(lzwEncode(noise, 8).length > 0);
  assert.throws(() => encodeGif({ width: 2, height: 2, palette, frames: [] }));
  assert.throws(() => encodeGif({ width: 2, height: 2, palette, frames: [{ x: 1, y: 1, width: 2, height: 2, pixels: new Uint8Array(4), delayCs: 0 }] }));
});

test('route: image/gif with no-store headers, Apple still by market, cached once per second and bounded', async t => {
  let now = at(LEFT);
  const rendered: string[] = [];
  const app = await countdownApp(() => now, variant => { rendered.push(JSON.stringify(variant)); return renderCountdownGif(variant); });
  t.after(() => app.close());

  const live = await app.inject(COUNTDOWN_PATH);
  assert.equal(live.statusCode, 200);
  assert.equal(live.headers['content-type'], 'image/gif');
  assert.equal(live.headers['cache-control'], 'no-store, no-cache, must-revalidate, max-age=0');
  assert.equal(live.headers.expires, '0');
  assert.equal(live.headers['set-cookie'], undefined);
  assert.equal(decodeGif(live.rawPayload).frames.length, 60);
  // No market means the UK; each market counts to its own deadline.
  assert.deepEqual(composite(decodeGif(live.rawPayload)), expectedRgb({ kind: 'live', remaining: LEFT }));
  const liveUk = await app.inject(`${COUNTDOWN_PATH}?m=uk`);
  const liveUs = await app.inject(`${COUNTDOWN_PATH}?m=us`);
  assert.deepEqual(composite(decodeGif(liveUk.rawPayload)), expectedRgb({ kind: 'live', remaining: LEFT }));
  assert.deepEqual(composite(decodeGif(liveUs.rawPayload)), expectedRgb({ kind: 'live', remaining: LEFT + GAP }));

  const appleUk = await app.inject({ url: `${COUNTDOWN_PATH}?m=uk`, headers: { 'x-forwarded-for': '17.58.1.2, 10.1.1.1' } });
  const appleUs = await app.inject({ url: `${COUNTDOWN_PATH}?m=us`, headers: { 'x-forwarded-for': '17.58.1.2' } });
  assert.deepEqual(composite(decodeGif(appleUk.rawPayload)), expectedRgb({ kind: 'still', market: 'uk' }));
  assert.deepEqual(composite(decodeGif(appleUs.rawPayload)), expectedRgb({ kind: 'still', market: 'us' }));
  assert.equal(decodeGif(appleUs.rawPayload).frames.length, 1);
  const gmail = await app.inject({ url: `${COUNTDOWN_PATH}?m=us`, headers: { 'x-forwarded-for': '17.58.1.2', 'user-agent': 'Mozilla/5.0 GoogleImageProxy' } });
  assert.equal(decodeGif(gmail.rawPayload).frames.length, 60);

  // A burst inside one second renders nothing new: each market's live picture is already cached.
  rendered.length = 0;
  for (let i = 0; i < 5; i++) await app.inject(`${COUNTDOWN_PATH}?m=${i % 2 ? 'us' : 'uk'}`);
  assert.equal(rendered.length, 0);
  now = new Date(now.getTime() + 1000);
  const next = await app.inject(COUNTDOWN_PATH);
  assert.equal(rendered.length, 1);
  assert.deepEqual(composite(decodeGif(next.rawPayload)), expectedRgb({ kind: 'live', remaining: LEFT - 1 }));
  const nextUs = await app.inject(`${COUNTDOWN_PATH}?m=us`);
  assert.equal(rendered.length, 2, 'the US counts to a different deadline, so it is its own render');
  assert.deepEqual(composite(decodeGif(nextUs.rawPayload)), expectedRgb({ kind: 'live', remaining: LEFT + GAP - 1 }));

  // Bounded: after many seconds the oldest entries are dropped and would be rendered again.
  for (let i = 2; i < 30; i++) { now = at(LEFT - i); await app.inject(COUNTDOWN_PATH); }
  rendered.length = 0;
  now = at(LEFT);
  await app.inject(COUNTDOWN_PATH);
  assert.equal(rendered.length, 1);

  // UK deadline (07:00 UK): the UK is open, Apple included; the US keeps counting five more hours.
  now = at(0);
  const open = await app.inject({ url: COUNTDOWN_PATH, headers: { 'x-forwarded-for': '17.58.1.2' } });
  assert.deepEqual(composite(decodeGif(open.rawPayload)), expectedRgb({ kind: 'open' }));
  assert.equal(open.headers['cache-control'], 'no-store, no-cache, must-revalidate, max-age=0');
  const openUk = await app.inject(`${COUNTDOWN_PATH}?m=uk`);
  assert.deepEqual(composite(decodeGif(openUk.rawPayload)), expectedRgb({ kind: 'open' }));
  const gapUs = await app.inject(`${COUNTDOWN_PATH}?m=us`);
  assert.equal(decodeGif(gapUs.rawPayload).frames.length, 60);
  assert.deepEqual(composite(decodeGif(gapUs.rawPayload)), expectedRgb({ kind: 'live', remaining: GAP }));
  const gapAppleUs = await app.inject({ url: `${COUNTDOWN_PATH}?m=us`, headers: { 'x-forwarded-for': '17.58.1.2' } });
  assert.deepEqual(composite(decodeGif(gapAppleUs.rawPayload)), expectedRgb({ kind: 'still', market: 'us' }));

  // US deadline (07:00 New York = 12:00 UK): open for everyone in both markets.
  now = new Date(US * 1000);
  for (const url of [COUNTDOWN_PATH, `${COUNTDOWN_PATH}?m=uk`, `${COUNTDOWN_PATH}?m=us`]) {
    for (const headers of [{}, { 'x-forwarded-for': '17.58.1.2' }]) {
      const response = await app.inject({ url, headers });
      assert.equal(decodeGif(response.rawPayload).frames.length, 1, url);
      assert.deepEqual(composite(decodeGif(response.rawPayload)), expectedRgb({ kind: 'open' }), url);
    }
  }
});

test('the countdown is public in the full app: no session, no cookie, while pages still need sign-in', async t => {
  const db = await createTestDatabase();
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test', APP_ORIGIN: 'https://pulse.example.test' });
  const app = await createApp(db, config, {}, {}, {}, {}, {}, { clock: () => at(LEFT) });
  t.after(async () => { await app.close(); await db.close(); });
  const home = await app.inject('/');
  assert.equal(home.statusCode, 302);
  assert.equal(home.headers.location, '/login');
  for (const [url, remaining] of [[COUNTDOWN_PATH, LEFT], [`${COUNTDOWN_PATH}?m=us`, LEFT + GAP]] as const) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 200, url);
    assert.equal(response.headers['content-type'], 'image/gif');
    assert.equal(response.headers['cache-control'], 'no-store, no-cache, must-revalidate, max-age=0');
    assert.equal(response.headers.expires, '0');
    assert.equal(response.headers['set-cookie'], undefined);
    assert.deepEqual(composite(decodeGif(response.rawPayload)), expectedRgb({ kind: 'live', remaining }));
  }
  const head = await app.inject({ method: 'HEAD', url: COUNTDOWN_PATH });
  assert.equal(head.statusCode, 200);
});
