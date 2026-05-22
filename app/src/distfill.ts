/**
 * Distance-fill export composition.
 *
 * For each pixel, find the nearest connected painted region and encode:
 *   R, G  - palette color of that region (8-bit promoted to 16-bit via *257
 *           so the high byte still reads as the canonical palette value)
 *   B     - 65535 if pixel was originally BACKGROUND, 0 if it was painted.
 *           Inverted from the on-screen mask so downstream shaders can
 *           subtract directly (background reads as 1.0 in normalized float).
 *   A     - smooth-step gradient:
 *             outside (B=65535): [0, 32767]   - 0 at the Voronoi boundary,
 *                                                ~32767 right at the shape edge
 *             inside  (B=0):     [32768, 65535] - 32768 at the shape edge,
 *                                                 65535 at the medial axis
 *
 * The midpoint 32768 corresponds exactly to the shape boundary, so a
 * downstream shader can recover the original mask with `B > 0.5` or `A > 0.5`.
 */

import { encode as encodePng } from 'fast-png';
import { BACKGROUND_INDEX, PALETTE_BY_INDEX } from './palette.ts';
import { connectedComponents, NO_REGION } from './ccl.ts';
import { jumpFlood } from './jfa.ts';
import type { MaskDocument } from './document.ts';

export interface DistanceFillResult {
  /** 16-bit RGBA, row-major, length = width * height * 4. */
  data: Uint16Array;
  width: number;
  height: number;
  regionCount: number;
}

function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

export function computeDistanceFill(doc: MaskDocument): DistanceFillResult {
  const w = doc.width;
  const h = doc.height;
  const n = w * h;
  const px = doc.pixels;

  const { regions, regionPaletteIndex, regionCount } = connectedComponents(doc);

  if (regionCount === 0) {
    return { data: new Uint16Array(n * 4), width: w, height: h, regionCount: 0 };
  }

  const paintedMask = new Uint8Array(n);
  const bgMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (px[i] === BACKGROUND_INDEX) bgMask[i] = 1;
    else paintedMask[i] = 1;
  }

  // Pass A: nearest painted pixel (any region).
  const passA = jumpFlood(w, h, paintedMask, null);

  // Each pixel's owning region.
  const cellRegion = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const s = passA.nearest[i];
    cellRegion[i] = s >= 0 ? regions[s] : NO_REGION;
  }

  // Pass B: nearest painted pixel from a *different* region than the dest's owner.
  const passB = jumpFlood(w, h, paintedMask, (seedI, destI) =>
    regions[seedI] !== cellRegion[destI],
  );

  // Pass C: nearest background pixel (used to measure distance-to-edge from inside a shape).
  const passC = jumpFlood(w, h, bgMask, null);

  // Per-region max inside distance, for normalizing the inside alpha gradient.
  const regionMaxInsideDist = new Float64Array(regionCount);
  for (let i = 0; i < n; i++) {
    if (paintedMask[i] === 0) continue;
    const r = regions[i];
    const d = Math.sqrt(passC.distSq[i]);
    if (d > regionMaxInsideDist[r]) regionMaxInsideDist[r] = d;
  }

  // Compose the 16-bit RGBA buffer.
  const out = new Uint16Array(n * 4);
  for (let i = 0; i < n; i++) {
    const isPainted = paintedMask[i] === 1;
    const r = cellRegion[i];
    const palIdx = r >= 0 ? regionPaletteIndex[r] : -1;
    // Look up by internal index (PALETTE array is sorted by label).
    const palEntry = palIdx >= 0 ? PALETTE_BY_INDEX.get(palIdx) : undefined;

    const o = i * 4;
    out[o + 0] = palEntry ? palEntry.r * 257 : 0;
    out[o + 1] = palEntry ? palEntry.g * 257 : 0;
    out[o + 2] = isPainted ? 0 : 65535;

    let alpha = 0;
    if (isPainted) {
      const distInside = Math.sqrt(passC.distSq[i]);
      const maxD = regionMaxInsideDist[r];
      const t = maxD > 0 ? distInside / maxD : 1;
      alpha = 32768 + Math.round(smoothstep(t) * 32767);
    } else if (palEntry) {
      const distMine = Math.sqrt(passA.distSq[i]);
      const distOtherSq = passB.distSq[i];
      if (!isFinite(distOtherSq)) {
        // Only one region in the whole doc - no Voronoi boundary, so use an
        // absolute-distance fallback keyed off the region's interior radius.
        const ref = Math.max(1, regionMaxInsideDist[r]) * 4;
        const t = Math.max(0, 1 - distMine / ref);
        alpha = Math.round(smoothstep(t) * 32767);
      } else {
        const distOther = Math.sqrt(distOtherSq);
        const denom = distMine + distOther;
        const t = denom > 0 ? Math.max(0, (distOther - distMine) / denom) : 0;
        alpha = Math.round(smoothstep(t) * 32767);
      }
    }
    out[o + 3] = alpha;
  }

  return { data: out, width: w, height: h, regionCount };
}

export function encodeDistanceFillPng(result: DistanceFillResult): Blob {
  const bytes = encodePng({
    width: result.width,
    height: result.height,
    data: result.data,
    depth: 16,
    channels: 4,
  });
  return new Blob([bytes as BlobPart], { type: 'image/png' });
}
