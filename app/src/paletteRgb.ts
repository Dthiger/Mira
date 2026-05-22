/**
 * Shared palette index <-> RGB lookups.
 *
 * Three call sites need the same conceptual mapping (index -> RGB) but with
 * different shapes:
 *   - PaintRenderer wants a flat Uint8Array of [r, g, b, a] indexable by
 *     `index * 4` for the per-pixel inner loop (uses alpha=0 for background
 *     so the reference image and dark backdrop show through).
 *   - savefile.ts wants the same RGB triplets but with opaque BG (the save
 *     file should preview the mask correctly in any image viewer).
 *   - distfill.ts wants the per-palette (r, g) for its compose loop.
 *
 * This module owns those tables and the reverse lookup used by savefile load.
 * All exports are built once at module init from the canonical PALETTE.
 */

import { BACKGROUND_INDEX, PALETTE } from './palette.ts';

/**
 * 256 * 4 bytes, indexed by `paletteIndex * 4`. Background = transparent
 * black so the paint canvas lets the reference image and the canvas-stack's
 * dark backdrop show through where the user hasn't painted.
 */
export const PAINT_RGBA: Uint8Array = (() => {
  const t = new Uint8Array(256 * 4);
  for (const e of PALETTE) {
    const o = e.index * 4;
    t[o] = e.r; t[o + 1] = e.g; t[o + 2] = e.b; t[o + 3] = 255;
  }
  // BACKGROUND_INDEX -> transparent (r/g/b stay 0; alpha 0)
  return t;
})();

/**
 * Index -> RGB triplet, BG = opaque black. Used by the save file encoder
 * which renders the doc onto an opaque canvas before producing the PNG.
 */
export const RGB_BY_INDEX: ReadonlyMap<number, readonly [number, number, number]> = (() => {
  const m = new Map<number, readonly [number, number, number]>();
  m.set(BACKGROUND_INDEX, [0, 0, 0]);
  for (const e of PALETTE) m.set(e.index, [e.r, e.g, e.b]);
  return m;
})();

/**
 * Packed 24-bit RGB key (r<<16 | g<<8 | b) -> palette index. Used by the
 * save file loader to reverse-map painted pixels back to indices. Pure
 * black maps to BACKGROUND_INDEX so files round-trip cleanly.
 */
export const INDEX_BY_RGB: ReadonlyMap<number, number> = (() => {
  const m = new Map<number, number>();
  m.set(0, BACKGROUND_INDEX);
  for (const e of PALETTE) m.set((e.r << 16) | (e.g << 8) | e.b, e.index);
  return m;
})();
