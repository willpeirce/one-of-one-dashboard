// Test-only GIF89a reader, written independently of src/countdown/gif.ts to check what it writes.
// Handles global/local palettes, extensions and LZW; not interlacing (the encoder never interlaces).

export interface DecodedFrame {
  x: number; y: number; width: number; height: number;
  delayCs: number | undefined; disposal: number | undefined;
  indices: Uint8Array;
  palette: Uint8Array;
}

export interface DecodedGif {
  version: string;
  width: number;
  height: number;
  globalPalette: Uint8Array | undefined;
  backgroundIndex: number;
  applicationExtensions: string[];
  frames: DecodedFrame[];
  trailer: boolean;
}

function lzwDecode(data: Uint8Array, minCodeSize: number, expected: number): Uint8Array {
  const clear = 1 << minCodeSize, end = clear + 1;
  const out = new Uint8Array(expected);
  let written = 0, size = minCodeSize + 1, bitPos = 0;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([], []);
    size = minCodeSize + 1;
  };
  reset();
  let previous: number[] | undefined;
  for (;;) {
    if (bitPos + size > data.length * 8) throw new Error('LZW data ended without an end code.');
    let code = 0;
    for (let i = 0; i < size; i++, bitPos++) code |= ((data[bitPos >> 3]! >> (bitPos & 7)) & 1) << i;
    if (code === clear) { reset(); previous = undefined; continue; }
    if (code === end) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code]!;
    else if (code === dict.length && previous) entry = [...previous, previous[0]!];
    else throw new Error(`Bad LZW code ${code}.`);
    for (const value of entry) {
      if (written >= expected) throw new Error('LZW data is longer than the frame.');
      out[written++] = value;
    }
    if (previous && dict.length < 4096) dict.push([...previous, entry[0]!]);
    if (dict.length === 1 << size && size < 12) size++;
    previous = entry;
  }
  if (written !== expected) throw new Error(`LZW gave ${written} pixels, frame needs ${expected}.`);
  return out;
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  let p = 0;
  const u8 = () => { if (p >= bytes.length) throw new Error('Unexpected end of GIF.'); return bytes[p++]!; };
  const u16 = () => u8() | (u8() << 8);
  const blocks = () => {
    const parts: number[] = [];
    for (let size = u8(); size > 0; size = u8()) for (let i = 0; i < size; i++) parts.push(u8());
    return Uint8Array.from(parts);
  };
  const version = String.fromCharCode(...bytes.subarray(0, 6));
  if (version !== 'GIF89a' && version !== 'GIF87a') throw new Error('Not a GIF.');
  p = 6;
  const width = u16(), height = u16(), packed = u8(), backgroundIndex = u8();
  u8();
  const tableOf = (bits: number) => { const t = bytes.slice(p, p + 3 * (1 << (bits + 1))); p += t.length; return t; };
  const globalPalette = packed & 0x80 ? tableOf(packed & 7) : undefined;
  const frames: DecodedFrame[] = [], applicationExtensions: string[] = [];
  let delayCs: number | undefined, disposal: number | undefined, trailer = false;
  while (p < bytes.length) {
    const introducer = u8();
    if (introducer === 0x3b) { trailer = true; break; }
    if (introducer === 0x21) {
      const label = u8();
      const body = blocks();
      if (label === 0xf9) { disposal = (body[0]! >> 2) & 7; delayCs = body[1]! | (body[2]! << 8); }
      if (label === 0xff) applicationExtensions.push(String.fromCharCode(...body.subarray(0, 11)));
      continue;
    }
    if (introducer !== 0x2c) throw new Error(`Unknown block 0x${introducer.toString(16)}.`);
    const x = u16(), y = u16(), w = u16(), h = u16(), flags = u8();
    if (flags & 0x40) throw new Error('Interlaced frames are not supported by this reader.');
    const palette = flags & 0x80 ? tableOf(flags & 7) : globalPalette;
    if (!palette) throw new Error('Frame has no palette.');
    const minCodeSize = u8();
    frames.push({ x, y, width: w, height: h, delayCs, disposal, palette, indices: lzwDecode(blocks(), minCodeSize, w * h) });
    delayCs = undefined; disposal = undefined;
  }
  return { version, width, height, globalPalette, backgroundIndex, applicationExtensions, frames, trailer };
}

/** RGB of the canvas after drawing frames 0..upTo (disposal "do not dispose" assumed, as the encoder writes). */
export function composite(gif: DecodedGif, upTo = 0): Uint8Array {
  const rgb = new Uint8Array(gif.width * gif.height * 3);
  for (const frame of gif.frames.slice(0, upTo + 1)) {
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      const index = frame.indices[y * frame.width + x]!, at = ((frame.y + y) * gif.width + frame.x + x) * 3;
      rgb.set(frame.palette.subarray(index * 3, index * 3 + 3), at);
    }
  }
  return rgb;
}

export function pixelHex(rgb: Uint8Array, width: number, x: number, y: number): string {
  const at = (y * width + x) * 3;
  return '#' + [rgb[at]!, rgb[at + 1]!, rgb[at + 2]!].map(v => v.toString(16).padStart(2, '0')).join('');
}
