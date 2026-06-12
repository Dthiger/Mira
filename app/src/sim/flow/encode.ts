/**
 * Encode a flow field as a Substance-compatible flowmap PNG.
 *
 * Output is **16-bit per channel RGB PNG** (color type 2, bit depth 16).
 *   R = (x_norm + 1) / 2 * 65535
 *   G = (y_norm + 1) / 2 * 65535   (optionally Y-flipped)
 *   B = 0
 *
 * Why 16-bit: 8-bit quantizes flow vectors to ~0.4% steps, which produces
 * visible stepping when the flowmap drives displacement or UV warp
 * downstream. 16-bit is 256× more precision — sub-perceptual quantization
 * for any normal Substance use. Substance Designer reads 16-bit PNG
 * natively.
 *
 * No external deps: we hand-assemble the PNG (signature + IHDR + IDAT +
 * IEND chunks with CRC32) and use the browser's CompressionStream for
 * the deflate pass.
 */

import type { FlowField } from './types.ts';

export interface FlowEncodeOptions {
  /** Flip Y for UV-down convention (Substance / OpenGL UV). */
  flipY: boolean;
  /** Subtract the field's mean velocity before normalizing. Useful when
   *  a strong wind dominates the velocity field and the interesting
   *  deflections around shapes get crushed into a tiny fraction of the
   *  encoded range. With this on, the exported map captures the
   *  variation from the bulk flow — "where does the fluid go differently
   *  than the average?" — which surfaces the river-lane structure that
   *  was previously hidden behind the wind bias. */
  subtractMean: boolean;
}

export async function encodeFlowmapPng(
  field: FlowField,
  opts: FlowEncodeOptions,
): Promise<Blob> {
  const w = field.width;
  const h = field.height;
  const fx = field.fx;
  const fy = field.fy;

  // Optionally subtract the field's mean before normalizing — captures
  // deviation from the bulk (wind) flow.
  let meanX = 0, meanY = 0;
  if (opts.subtractMean) {
    let count = 0;
    for (let i = 0; i < fx.length; i++) {
      if (fx[i] === 0 && fy[i] === 0) continue; // walls
      meanX += fx[i]; meanY += fy[i]; count++;
    }
    if (count > 0) { meanX /= count; meanY /= count; }
  }

  // Normalize so the longest (post-mean-subtraction) vector maps to ±1.
  let maxMag2 = 0;
  for (let i = 0; i < fx.length; i++) {
    if (fx[i] === 0 && fy[i] === 0) continue; // walls stay at zero
    const dx = fx[i] - meanX;
    const dy = fy[i] - meanY;
    const m = dx * dx + dy * dy;
    if (m > maxMag2) maxMag2 = m;
  }
  const invMax = maxMag2 > 0 ? 1 / Math.sqrt(maxMag2) : 0;
  const ySign = opts.flipY ? -1 : 1;

  // Build raw pixel data with PNG filter byte (type 0 = None) at the
  // start of each scanline. RGB16 big-endian = 6 bytes per pixel.
  const bytesPerPixel = 6;
  const rowBytes = 1 + w * bytesPerPixel;
  const raw = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) {
    const rowOff = y * rowBytes;
    raw[rowOff] = 0; // filter type = None
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Wall pixels (where fx and fy are both exactly 0) encode as
      // mid-gray regardless of options — they represent "no flow".
      const isWall = fx[i] === 0 && fy[i] === 0;
      const dx = isWall ? 0 : (fx[i] - meanX) * invMax;            // [-1, 1]
      const dy = isWall ? 0 : (fy[i] - meanY) * invMax * ySign;
      const nx = dx;
      const ny = dy;
      const r = clamp16((nx * 0.5 + 0.5) * 65535);
      const g = clamp16((ny * 0.5 + 0.5) * 65535);
      const off = rowOff + 1 + x * bytesPerPixel;
      raw[off]     = (r >>> 8) & 0xff;       // big-endian R hi
      raw[off + 1] = r & 0xff;               // R lo
      raw[off + 2] = (g >>> 8) & 0xff;       // G hi
      raw[off + 3] = g & 0xff;               // G lo
      raw[off + 4] = 0;                      // B hi
      raw[off + 5] = 0;                      // B lo
    }
  }

  const compressed = await deflate(raw);
  return assemblePng(w, h, compressed);
}

function clamp16(v: number): number {
  if (v < 0) return 0;
  if (v > 65535) return 65535;
  return Math.round(v);
}

/** Encode a UV-channel pair (both already in [0, 1]) as a 16-bit RGB
 *  PNG. R = U * 65535, G = V * 65535, B = inside-mask (65535 where the
 *  band pixel lies INSIDE a shape, 0 outside / no band). No
 *  normalization, no centering — the values are already in the
 *  encodable range. Used for the per-shape contour-band UV map.
 *
 *  Optional Y-flip for UV-down conventions. Pixels where U == 0 AND V == 0
 *  are written as (0, 0, 0) — the "no band here" sentinel. */
export async function encodeContourUvPng(
  field: {
    width: number; height: number;
    fx: Float32Array; fy: Float32Array;
    inside?: Uint8Array;
  },
  opts: { flipY: boolean },
): Promise<Blob> {
  const w = field.width;
  const h = field.height;
  const fx = field.fx;
  const fy = field.fy;
  const inside = field.inside ?? null;

  const bytesPerPixel = 6;
  const rowBytes = 1 + w * bytesPerPixel;
  const raw = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) {
    const rowOff = y * rowBytes;
    raw[rowOff] = 0;
    const srcY = opts.flipY ? (h - 1 - y) : y;
    for (let x = 0; x < w; x++) {
      const i = srcY * w + x;
      const u = fx[i];
      const v = fy[i];
      const r = clamp16(u * 65535);
      const g = clamp16(v * 65535);
      const b = inside && inside[i] ? 65535 : 0;
      const off = rowOff + 1 + x * bytesPerPixel;
      raw[off]     = (r >>> 8) & 0xff;
      raw[off + 1] = r & 0xff;
      raw[off + 2] = (g >>> 8) & 0xff;
      raw[off + 3] = g & 0xff;
      raw[off + 4] = (b >>> 8) & 0xff;
      raw[off + 5] = b & 0xff;
    }
  }

  const compressed = await deflate(raw);
  return assemblePng(w, h, compressed);
}

/** Build the PNG file bytes given the doc dimensions and pre-deflated
 *  IDAT payload. Shared by all 16-bit-RGB encoders. */
function assemblePng(w: number, h: number, idatPayload: Uint8Array): Blob {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, w, false);
  ihdrView.setUint32(4, h, false);
  ihdrData[8] = 16;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const ihdr = chunk('IHDR', ihdrData);
  const idat = chunk('IDAT', idatPayload);
  const iend = chunk('IEND', new Uint8Array(0));

  const total = sig.length + ihdr.length + idat.length + iend.length;
  const png = new Uint8Array(total);
  let p = 0;
  png.set(sig, p); p += sig.length;
  png.set(ihdr, p); p += ihdr.length;
  png.set(idat, p); p += idat.length;
  png.set(iend, p);
  return new Blob([png], { type: 'image/png' });
}

/** zlib-wrapped deflate via the browser's CompressionStream. PNG IDAT
 *  expects the zlib container (header + adler32), which `'deflate'`
 *  provides — `'deflate-raw'` would skip those and produce a broken PNG. */
async function deflate(input: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  // Re-wrap into a fresh ArrayBuffer-backed view to satisfy
  // BufferSource typing across TS-lib versions (which now distinguishes
  // ArrayBuffer-backed Uint8Array from SharedArrayBuffer-backed).
  const copy = new Uint8Array(input.length);
  copy.set(input);
  void writer.write(copy);
  void writer.close();
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}

/** Build a PNG chunk: 4 bytes length, 4 bytes type, payload, 4 bytes CRC.
 *  CRC covers type + payload. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ 0xffffffff) >>> 0;
}
