/**
 * Bake the deformed pillow mesh back into doc.pixels. Pure function: takes
 * a MaskDocument and a SimWorld, mutates the doc, returns nothing.
 *
 * Pipeline:
 *   1. Run CCL on the current doc to identify the regions that became
 *      bodies (>= MIN_BODY_PIXELS). Erase their pixels.
 *   2. For each body in index order, scanline-rasterize every triangle
 *      with the body's palette index, maintaining a per-pixel body-id map.
 *      When a pixel would land next to a same-palette pixel owned by a
 *      DIFFERENT body, skip writing it — this leaves a 1-pixel background
 *      gap that keeps same-color bodies as separate CCL regions even
 *      after they've been pressed together in the simulation.
 *
 * Smaller regions that never became bodies pass through unchanged.
 * No antialiasing — every written pixel is a clean palette index,
 * satisfying the app's hard "no AA" invariant.
 */

import { BACKGROUND_INDEX } from '../../palette.ts';
import { connectedComponents, NO_REGION } from '../../ccl.ts';
import type { MaskDocument } from '../../document.ts';
import type { SimWorld } from './types.ts';

// Must match MIN_BODY_PIXELS in worldBuild.ts. If they ever diverge,
// regions on one side of the threshold get double-handled or skipped.
const MIN_BODY_PIXELS = 20;
const NO_OWNER = -1;

export function bakePillow(doc: MaskDocument, world: SimWorld): void {
  // 1. Erase pixels of regions large enough to have become bodies.
  const { regions, regionCount } = connectedComponents(doc);
  const regionPixelCount = new Uint32Array(regionCount);
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (r !== NO_REGION) regionPixelCount[r]++;
  }
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (r !== NO_REGION && regionPixelCount[r] >= MIN_BODY_PIXELS) {
      doc.pixels[i] = BACKGROUND_INDEX;
    }
  }

  // 2. Rasterize each body, tracking per-pixel body ownership so the
  //    same-palette gap rule can prevent merging.
  const owner = new Int32Array(doc.pixels.length).fill(NO_OWNER);
  for (let bi = 0; bi < world.bodies.length; bi++) {
    const body = world.bodies[bi];
    const pal = body.paletteIndex;
    const verts = body.vertices;
    for (const tri of body.triangles) {
      const a = verts[tri.v0];
      const b = verts[tri.v1];
      const c = verts[tri.v2];
      rasterizeTriangle(doc, owner, a.px, a.py, b.px, b.py, c.px, c.py, pal, bi);
    }
  }
}

/** Hard-edged barycentric scanline + same-palette gap enforcement.
 *  Tests pixel centers against the triangle's edge functions; writes the
 *  palette index when inside AND no 4-neighbor pixel is the same palette
 *  index owned by a different body. */
function rasterizeTriangle(
  doc: MaskDocument,
  owner: Int32Array,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  paletteIdx: number,
  bodyId: number,
): void {
  const W = doc.width;
  const H = doc.height;
  const pixels = doc.pixels;

  // 2 × signed area of the triangle. Signs of the sub-areas cancel with
  // this when we normalize, so the barycentric check works for either
  // winding.
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denom) < 1e-9) return; // degenerate

  const xMin = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const xMax = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
  const yMin = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const yMax = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));

  const invDenom = 1 / denom;

  for (let y = yMin; y <= yMax; y++) {
    const py = y + 0.5;
    const row = y * W;
    for (let x = xMin; x <= xMax; x++) {
      const px = x + 0.5;
      const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) * invDenom;
      const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) * invDenom;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;

      const i = row + x;
      // Same-palette gap rule: if any 4-neighbor is the same palette but
      // belongs to a different body, skip this pixel so CCL sees the two
      // bodies as separate regions instead of merging them.
      if (y > 0) {
        const n = i - W;
        if (owner[n] !== NO_OWNER && owner[n] !== bodyId && pixels[n] === paletteIdx) continue;
      }
      if (y < H - 1) {
        const n = i + W;
        if (owner[n] !== NO_OWNER && owner[n] !== bodyId && pixels[n] === paletteIdx) continue;
      }
      if (x > 0) {
        const n = i - 1;
        if (owner[n] !== NO_OWNER && owner[n] !== bodyId && pixels[n] === paletteIdx) continue;
      }
      if (x < W - 1) {
        const n = i + 1;
        if (owner[n] !== NO_OWNER && owner[n] !== bodyId && pixels[n] === paletteIdx) continue;
      }

      pixels[i] = paletteIdx;
      owner[i] = bodyId;
    }
  }
}
