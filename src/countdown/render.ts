// The Black Friday 2026 email countdown: pure functions that choose what to show and draw it as a GIF.
// Drawn at 2x (1200 px wide) for a 600 px email column, on the email's exact flat background.
import { inflateRawSync } from 'node:zlib';
import { encodeGif, type GifFrame } from './gif.js';
import { GLYPHS } from './glyphs.generated.js';
import type { GlyphId } from './glyph-specs.js';

/** Fri 27 Nov 2026 06:00 UK (GMT, so 06:00 UTC) = 01:00 New York. Both markets end their head start here. */
export const BF26_DEADLINE_UNIX = 1795759200;
export const LIVE_FRAMES = 60;
export const GIF_WIDTH = 1200;
export const GIF_HEIGHT = 280;

export type Market = 'uk' | 'us';
export type CountdownVariant =
  | { kind: 'live'; remaining: number }
  | { kind: 'open' }
  | { kind: 'still'; market: Market };

export const COLOURS = {
  background: [0x1a, 0x1a, 0x1d],
  eyebrow: [0xa9, 0xa9, 0xb1],
  digit: [0x52, 0xc5, 0xd1],
  colon: [0x3b, 0x7d, 0x85],
  label: [0x85, 0x85, 0x8d],
} as const satisfies Record<string, readonly [number, number, number]>;
type Ink = Exclude<keyof typeof COLOURS, 'background'>;
const INKS: Ink[] = ['eyebrow', 'digit', 'colon', 'label'];
/** Antialiasing steps per ink: background plus four ramps of 63 fit one 256-colour palette. */
const LEVELS = 63;

export interface CountdownParts { hours: string; minutes: string; seconds: string }

/** Whole seconds left as hours (at least two digits, three or more days ahead), minutes and seconds. */
export function countdownParts(remainingSeconds: number): CountdownParts {
  const total = Math.max(0, Math.floor(remainingSeconds));
  const pad = (value: number) => String(value).padStart(2, '0');
  return { hours: pad(Math.floor(total / 3600)), minutes: pad(Math.floor(total / 60) % 60), seconds: pad(total % 60) };
}

export function formatCountdown(remainingSeconds: number): string {
  const { hours, minutes, seconds } = countdownParts(remainingSeconds);
  return `${hours}:${minutes}:${seconds}`;
}

/** At or after the deadline everyone sees "open"; before it, Apple's prefetching proxy gets a still that cannot go stale. */
export function chooseVariant(nowUnixSeconds: number, market: Market, appleProxy: boolean): CountdownVariant {
  const remaining = BF26_DEADLINE_UNIX - Math.floor(nowUnixSeconds);
  if (remaining <= 0) return { kind: 'open' };
  if (appleProxy) return { kind: 'still', market };
  return { kind: 'live', remaining };
}

export function variantKey(variant: CountdownVariant): string {
  if (variant.kind === 'live') return `live:${variant.remaining}`;
  if (variant.kind === 'still') return `still:${variant.market}`;
  return 'open';
}

export function countdownPalette(): Uint8Array {
  const palette = new Uint8Array(3 * (1 + INKS.length * LEVELS));
  palette.set(COLOURS.background, 0);
  INKS.forEach((ink, i) => {
    for (let level = 1; level <= LEVELS; level++) {
      const at = 3 * (1 + i * LEVELS + level - 1);
      for (let c = 0; c < 3; c++) {
        const from = COLOURS.background[c]!, to = COLOURS[ink][c]!;
        palette[at + c] = Math.round(from + ((to - from) * level) / LEVELS);
      }
    }
  });
  return palette;
}

interface Mask { w: number; h: number; dx: number; dy: number; advance: number; alpha: Uint8Array }
const masks = new Map<GlyphId, Mask>();
function mask(id: GlyphId): Mask {
  let found = masks.get(id);
  if (!found) {
    const record = GLYPHS[id];
    found = { ...record, alpha: new Uint8Array(inflateRawSync(Buffer.from(record.data, 'base64'))) };
    if (found.alpha.length !== found.w * found.h) throw new Error(`Glyph ${id} is corrupt.`);
    masks.set(id, found);
  }
  return found;
}

class Canvas {
  readonly pixels = new Uint8Array(GIF_WIDTH * GIF_HEIGHT); // index 0 is the background
  /** Draws a mask with its top-left ink corner at (x, y). */
  draw(id: GlyphId, x: number, y: number, ink: Ink): void {
    const m = mask(id), base = 1 + INKS.indexOf(ink) * LEVELS - 1;
    for (let row = 0; row < m.h; row++) {
      const py = y + row;
      if (py < 0 || py >= GIF_HEIGHT) continue;
      for (let col = 0; col < m.w; col++) {
        const px = x + col;
        if (px < 0 || px >= GIF_WIDTH) continue;
        const level = Math.round((m.alpha[row * m.w + col]! * LEVELS) / 255);
        if (level > 0) this.pixels[py * GIF_WIDTH + px] = base + level;
      }
    }
  }
  /** Centres a mask's ink horizontally, top of ink placed from its baseline offset. */
  centred(id: GlyphId, centreX: number, baseline: number, ink: Ink): void {
    const m = mask(id);
    this.draw(id, Math.round(centreX - m.w / 2), baseline + m.dy, ink);
  }
}

// Vertical layout, in 2x pixels. Live: eyebrow, digits, unit labels. Still: eyebrow and one big line. Open: one big line.
const LIVE = { eyebrowBaseline: 62, digitBaseline: 197, labelBaseline: 238 };
const STILL = { eyebrowBaseline: 82, bigBaseline: 217 };
const OPEN = { bigBaseline: 192 };
const GROUP_GAP = 22; // between a digit pair and a colon

function digitCell(): number {
  let widest = 0;
  for (let d = 0; d <= 9; d++) widest = Math.max(widest, mask(`digit-${d}` as GlyphId).advance);
  return Math.ceil(widest);
}

function drawLive(canvas: Canvas, remaining: number): void {
  const parts = countdownParts(remaining);
  canvas.centred('eyebrow-live', GIF_WIDTH / 2, LIVE.eyebrowBaseline, 'eyebrow');
  const cell = digitCell(), colon = mask('colon');
  const groups = [parts.hours, parts.minutes, parts.seconds];
  const width = groups.reduce((sum, g) => sum + g.length * cell, 0) + 2 * (colon.w + 2 * GROUP_GAP);
  // Anton's colon sits low for lowercase; centre it on the digits' height instead.
  const digitTop = LIVE.digitBaseline + mask('digit-0').dy, digitHeight = mask('digit-0').h;
  const colonTop = Math.round(digitTop + (digitHeight - colon.h) / 2);
  let x = Math.round((GIF_WIDTH - width) / 2);
  groups.forEach((group, i) => {
    const start = x;
    for (const digit of group) {
      const m = mask(`digit-${digit}` as GlyphId);
      canvas.draw(`digit-${digit}` as GlyphId, Math.round(x + (cell - m.advance) / 2 + m.dx), LIVE.digitBaseline + m.dy, 'digit');
      x += cell;
    }
    canvas.centred((['label-hrs', 'label-min', 'label-sec'] as const)[i]!, (start + x) / 2, LIVE.labelBaseline, 'label');
    if (i < 2) {
      x += GROUP_GAP;
      canvas.draw('colon', x, colonTop, 'colon');
      x += colon.w + GROUP_GAP;
    }
  });
}

function stillFrame(variant: Exclude<CountdownVariant, { kind: 'live' }>): Uint8Array {
  const canvas = new Canvas();
  if (variant.kind === 'open') {
    canvas.centred('open', GIF_WIDTH / 2, OPEN.bigBaseline, 'digit');
  } else {
    canvas.centred('eyebrow-still', GIF_WIDTH / 2, STILL.eyebrowBaseline, 'eyebrow');
    canvas.centred(variant.market === 'us' ? 'still-us' : 'still-uk', GIF_WIDTH / 2, STILL.bigBaseline, 'digit');
  }
  return canvas.pixels;
}

/** The smallest rectangle holding every pixel that differs; a 1x1 no-op when nothing does. */
function changedFrame(previous: Uint8Array, current: Uint8Array, delayCs: number): GifFrame {
  let left = GIF_WIDTH, right = -1, top = GIF_HEIGHT, bottom = -1;
  for (let y = 0; y < GIF_HEIGHT; y++) {
    const row = y * GIF_WIDTH;
    for (let x = 0; x < GIF_WIDTH; x++) {
      if (previous[row + x] !== current[row + x]) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        bottom = y;
      }
    }
  }
  if (right < 0) return { x: 0, y: 0, width: 1, height: 1, pixels: current.slice(0, 1), delayCs };
  const width = right - left + 1, height = bottom - top + 1, pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) pixels.set(current.subarray((top + y) * GIF_WIDTH + left, (top + y) * GIF_WIDTH + right + 1), y * width);
  return { x: left, y: top, width, height, pixels, delayCs };
}

/** The first frame of a variant as palette indices (tests and previews). */
export function firstFramePixels(variant: CountdownVariant): Uint8Array {
  if (variant.kind !== 'live') return stillFrame(variant);
  const canvas = new Canvas();
  drawLive(canvas, variant.remaining);
  return canvas.pixels;
}

export function renderCountdownGif(variant: CountdownVariant): Buffer {
  const palette = countdownPalette();
  if (variant.kind !== 'live') {
    return encodeGif({ width: GIF_WIDTH, height: GIF_HEIGHT, palette, frames: [{ x: 0, y: 0, width: GIF_WIDTH, height: GIF_HEIGHT, pixels: stillFrame(variant), delayCs: 0 }] });
  }
  // One frame a second, counting down from the request; it holds 00:00:00 if zero comes inside the minute.
  const frames: GifFrame[] = [];
  let previous: Uint8Array | undefined;
  for (let i = 0; i < LIVE_FRAMES; i++) {
    const current = firstFramePixels({ kind: 'live', remaining: Math.max(0, variant.remaining - i) });
    frames.push(previous
      ? changedFrame(previous, current, 100)
      : { x: 0, y: 0, width: GIF_WIDTH, height: GIF_HEIGHT, pixels: current, delayCs: 100 });
    previous = current;
  }
  return encodeGif({ width: GIF_WIDTH, height: GIF_HEIGHT, palette, frames });
}
