// A minimal GIF89a encoder: one global palette of up to 256 colours, indexed frames, no transparency.
// Frames after the first may be sub-rectangles drawn over the previous frame ("do not dispose").
// No NETSCAPE2.0 loop extension is ever written, so an animation plays once and stops on its last frame.

export interface GifFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Palette indices, row-major, width * height bytes. */
  pixels: Uint8Array;
  /** Delay after this frame in hundredths of a second. */
  delayCs: number;
}

export interface GifImage {
  width: number;
  height: number;
  /** RGB triples, at most 256 colours. */
  palette: Uint8Array;
  frames: GifFrame[];
}

class ByteWriter {
  private chunks: Buffer[] = [];
  private current = Buffer.alloc(65_536);
  private length = 0;
  byte(value: number): void {
    if (this.length === this.current.length) this.flush();
    this.current[this.length++] = value & 0xff;
  }
  u16(value: number): void { this.byte(value); this.byte(value >> 8); }
  bytes(values: ArrayLike<number>): void { for (let i = 0; i < values.length; i++) this.byte(values[i]!); }
  private flush(): void {
    this.chunks.push(Buffer.from(this.current.subarray(0, this.length)));
    this.current = Buffer.alloc(65_536);
    this.length = 0;
  }
  done(): Buffer { this.flush(); return Buffer.concat(this.chunks); }
}

/** GIF LZW, codes packed least-significant bit first; returns the raw code stream (not yet split into sub-blocks). */
export function lzwEncode(pixels: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const out: number[] = [];
  let bitBuffer = 0, bitCount = 0;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  // Key: prefix code * 256 + next index. A Map keeps memory proportional to the codes in use.
  let table = new Map<number, number>();
  const emit = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) { out.push(bitBuffer & 0xff); bitBuffer >>>= 8; bitCount -= 8; }
  };
  emit(clearCode);
  if (pixels.length === 0) { emit(endCode); if (bitCount > 0) out.push(bitBuffer & 0xff); return Uint8Array.from(out); }
  let prefix = pixels[0]!;
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i]!;
    const key = prefix * 256 + k;
    const found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (nextCode === 4096) {
      emit(clearCode);
      table = new Map();
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    } else {
      // The decoder adds each code one step later than the encoder, so widen when the code to be added needs it.
      if (nextCode >= 1 << codeSize) codeSize++;
      table.set(key, nextCode++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(endCode);
  if (bitCount > 0) out.push(bitBuffer & 0xff);
  return Uint8Array.from(out);
}

function subBlocks(writer: ByteWriter, data: Uint8Array): void {
  for (let offset = 0; offset < data.length; offset += 255) {
    const size = Math.min(255, data.length - offset);
    writer.byte(size);
    writer.bytes(data.subarray(offset, offset + size));
  }
  writer.byte(0);
}

export function encodeGif(image: GifImage): Buffer {
  const colours = image.palette.length / 3;
  if (!Number.isInteger(colours) || colours < 2 || colours > 256) throw new Error('A GIF palette holds 2 to 256 RGB colours.');
  if (image.frames.length === 0) throw new Error('A GIF needs at least one frame.');
  // The table size field stores log2(size) - 1; pad the palette up to that power of two.
  let tableBits = 1;
  while (1 << tableBits < colours) tableBits++;
  const minCodeSize = Math.max(2, tableBits);
  const writer = new ByteWriter();
  writer.bytes(Buffer.from('GIF89a', 'ascii'));
  writer.u16(image.width);
  writer.u16(image.height);
  writer.byte(0x80 | ((tableBits - 1) << 4) | (tableBits - 1)); // global table, colour resolution, table size
  writer.byte(0); // background colour index
  writer.byte(0); // no aspect ratio
  for (let i = 0; i < 1 << tableBits; i++) {
    writer.byte(image.palette[i * 3] ?? 0);
    writer.byte(image.palette[i * 3 + 1] ?? 0);
    writer.byte(image.palette[i * 3 + 2] ?? 0);
  }
  const animated = image.frames.length > 1;
  for (const frame of image.frames) {
    if (frame.width < 1 || frame.height < 1 || frame.pixels.length !== frame.width * frame.height) throw new Error('Frame size and pixels disagree.');
    if (frame.x < 0 || frame.y < 0 || frame.x + frame.width > image.width || frame.y + frame.height > image.height) throw new Error('Frame lies outside the image.');
    if (animated) {
      // Graphic Control Extension: disposal 1 (do not dispose), no transparency, delay in 1/100 s.
      writer.bytes([0x21, 0xf9, 0x04, 0x04]);
      writer.u16(frame.delayCs);
      writer.bytes([0x00, 0x00]);
    }
    writer.byte(0x2c);
    writer.u16(frame.x);
    writer.u16(frame.y);
    writer.u16(frame.width);
    writer.u16(frame.height);
    writer.byte(0); // no local table, not interlaced
    writer.byte(minCodeSize);
    subBlocks(writer, lzwEncode(frame.pixels, minCodeSize));
  }
  writer.byte(0x3b);
  return writer.done();
}
