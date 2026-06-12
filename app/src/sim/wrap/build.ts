/**
 * Per-shape contour-band UV map.
 *
 * For each region in the doc (above a minimum size), compute its
 * centroid. Then for every background pixel within `bandThicknessDoc`
 * of any region's boundary, the output stores:
 *
 *   U = (atan2(py - cy, px - cx) + π) / (2π)  ∈ [0, 1]
 *   V = distance to nearest boundary / band thickness  ∈ [0, 1]
 *
 * U is the angular position around the region's centroid (0 at angle
 * −π, 1 at +π, wraps back to 0 — continuous sweep around the shape).
 * V is the distance into the band (0 at shape edge, 1 at outer edge).
 *
 * The angular parametrization is robust where a perimeter walk would
 * fail: it doesn't care about non-convex shapes, pinch points, diagonal
 * boundary connections, or any of the other things that confuse a
 * Moore-neighbor trace. For very strongly concave shapes (centroid
 * lying outside the region itself) the U direction can bend in unusual
 * ways near the concavity, but the U field stays continuous and the
 * band stays unbroken.
 *
 * Substance Designer can use this as a quasi-UV map: U sweeps around
 * the shape (great for grain that runs parallel to the boundary), V
 * radiates outward (great for fade-from-edge effects, anisotropic
 * patterns normal to the boundary, etc).
 *
 * With `innerBand` on, the band also extends INSIDE each shape: U uses
 * the same centroid/angle (continuous across the edge) and V mirrors
 * (0 at the edge rising to 1 going inward), with the `inside` mask set
 * so the export's B channel distinguishes the two sides. Pixels outside
 * any band stay at (0, 0, B=0).
 */

import { connectedComponents, NO_REGION } from '../../ccl.ts';
import type { MaskDocument } from '../../document.ts';
// Reuse flow's FlowField (just two Float32Arrays + dims) and FlowCache
// (CCL + JFA results). Both are shape-agnostic — they don't carry any
// fluid-sim semantics, so importing them here is purely structural.
import type { FlowField } from '../flow/types.ts';
import type { FlowCache } from '../flow/build.ts';

export interface ContourBandParams {
  /** Band radius in doc-px. */
  bandThicknessDoc: number;
  /** Skip regions smaller than this (in pixels) — tiny noise regions
   *  wouldn't make a useful UV band. */
  minRegionPixels: number;
  /** Also build the band INSIDE each shape. U stays continuous across
   *  the shape edge (same centroid, same angle), and V mirrors (0 at
   *  the edge rising to 1 going either direction), so there's no
   *  interpolation break at the boundary. The `inside` mask channel
   *  (B in the export) tells the two sides apart. */
  innerBand: boolean;
}

/** FlowField + a per-pixel "this band pixel is inside a shape" flag.
 *  The flag goes to the PNG's B channel so Substance can separate the
 *  inner and outer bands (or reconstruct a signed distance from V). */
export interface WrapField extends FlowField {
  inside: Uint8Array;
}

const TWO_PI = Math.PI * 2;

export function buildContourBand(
  doc: MaskDocument,
  cache: FlowCache,
  params: ContourBandParams,
): WrapField {
  const w = doc.width;
  const h = doc.height;
  const n = w * h;
  const fx = new Float32Array(n);
  const fy = new Float32Array(n);
  const inside = new Uint8Array(n);

  // 1. CCL + per-region pixel count + centroid accumulation.
  const { regions, regionCount } = connectedComponents(doc);
  const pixelCount = new Uint32Array(regionCount);
  const cxAcc = new Float64Array(regionCount);
  const cyAcc = new Float64Array(regionCount);
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const r = regions[rowOff + x];
      if (r === NO_REGION) continue;
      pixelCount[r]++;
      cxAcc[r] += x;
      cyAcc[r] += y;
    }
  }
  for (let r = 0; r < regionCount; r++) {
    if (pixelCount[r] > 0) {
      cxAcc[r] /= pixelCount[r];
      cyAcc[r] /= pixelCount[r];
    }
  }

  // 2. Per bg pixel within band: route to nearest region's centroid,
  //    angular U + radial V.
  const nearest = cache.jfa.nearest;
  const distSq = cache.jfa.distSq;
  const thickness = params.bandThicknessDoc;
  const thicknessSq = thickness * thickness;
  const invThickness = 1 / thickness;

  for (let i = 0; i < n; i++) {
    if (distSq[i] > thicknessSq) continue;

    const ownRegion = regions[i];
    let bandRegion: number;
    if (ownRegion === NO_REGION) {
      // Outer band: bg pixel near a shape — band belongs to the nearest
      // region (the JFA cache was built with a "different region"
      // filter, so `nearest` points at the closest shape pixel).
      const nearestI = nearest[i];
      if (nearestI < 0) continue;
      bandRegion = regions[nearestI];
      if (bandRegion === NO_REGION) continue;
    } else {
      // Inner band: in-region pixel near its own boundary. The same JFA
      // gives distance to the nearest different-region (usually bg)
      // pixel = distance to this shape's boundary from inside.
      if (!params.innerBand) continue;
      bandRegion = ownRegion;
    }
    if (pixelCount[bandRegion] < params.minRegionPixels) continue;

    const px = i % w;
    const py = (i / w) | 0;
    // Same centroid + same angle convention on both sides of the edge,
    // so U is continuous across it.
    const angle = Math.atan2(py - cyAcc[bandRegion], px - cxAcc[bandRegion]);
    const u = (angle + Math.PI) / TWO_PI; // [0, 1]
    const dist = Math.sqrt(distSq[i]);
    fx[i] = u;
    // V mirrors across the edge: ~0 at the boundary on both sides,
    // rising to 1 at the band's inner/outer extent. Continuous.
    fy[i] = dist * invThickness;
    if (ownRegion !== NO_REGION) inside[i] = 1;
  }

  return { width: w, height: h, fx, fy, inside };
}
