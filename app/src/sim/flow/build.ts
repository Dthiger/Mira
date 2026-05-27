/**
 * Build a per-pixel flow vector field from the document, blending two
 * sources:
 *   A) Per-region curl-of-noise — each connected region gets its own
 *      curl-noise swirl (seeded with the global seed XOR'd by a region-ID
 *      hash so distinct regions don't share a flow pattern), giving each
 *      tissue its own coherent grain. Magnitude attenuates near the
 *      region's boundary so adjacent shapes have visibly separate flow.
 *   B) Boundary-tangent — the gradient of the distance-to-boundary field
 *      points INTO the region; rotated 90° it becomes tangent to the
 *      iso-distance contours, which near the boundary closely follow the
 *      shape's outline. Useful for "fibers run along this edge" effects.
 *
 * The two are blended via `params.tangentMix` ∈ [0, 1]. Output is
 * intended for export as a Substance Designer flowmap (RG-encoded PNG).
 */

import { createNoise2D } from 'simplex-noise';
import { connectedComponents, NO_REGION } from '../../ccl.ts';
import { jumpFlood, type JfaState } from '../../jfa.ts';
import type { MaskDocument } from '../../document.ts';
import type { FlowField, FlowParams } from './types.ts';

function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return (): number => {
    state |= 0; state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cached, doc-dependent data the flow build needs. Computed once per
 *  enterFlow (CCL + JFA are O(N) but not free; sliders only change params,
 *  not the doc, so we don't recompute these per slider change). */
export interface FlowCache {
  regions: Int32Array;
  jfa: JfaState;
}

export function buildFlowCache(doc: MaskDocument): FlowCache {
  const { regions } = connectedComponents(doc);
  // JFA finds the nearest pixel of a DIFFERENT region (or background) for
  // every pixel. Seeding all pixels and filtering at lookup time means
  // each pixel ends up with "nearest non-same-region pixel" — exact
  // Euclidean distance + exact source coords, no chamfer staircase
  // artifacts. The tangent direction is then derived analytically from
  // those source coords (rotate the outward unit vector 90°).
  const n = regions.length;
  const seedMask = new Uint8Array(n).fill(1);
  const jfa = jumpFlood(doc.width, doc.height, seedMask,
    (seedI, destI) => regions[seedI] !== regions[destI]);
  return { regions, jfa };
}

export function buildFlow(
  doc: MaskDocument,
  params: FlowParams,
  cache: FlowCache,
): FlowField {
  const w = doc.width;
  const h = doc.height;
  const n = w * h;
  const fx = new Float32Array(n);
  const fy = new Float32Array(n);

  const regions = cache.regions;
  const nearest = cache.jfa.nearest;
  const distSq = cache.jfa.distSq;
  const noise = createNoise2D(mulberry32(params.seed));

  const invScale = 1 / params.scale;
  const curlGain = params.scale * 0.2;
  const eps = 1;
  const inv2eps = 1 / (2 * eps);
  const internalWeight = 1 - params.tangentMix;
  const tangentWeight = params.tangentMix;
  const invFalloff = params.boundaryFalloff > 0 ? 1 / params.boundaryFalloff : 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = regions[i];
      if (r === NO_REGION) {
        // Background gets its OWN curl-noise pattern, applied directly
        // (no per-region offset, no tangent — there's no region boundary
        // to attenuate against). This is the seed flow for the fluid sim
        // when it's running.
        const nx = x * invScale;
        const ny = y * invScale;
        const dfdx = (noise(nx + eps * invScale, ny) - noise(nx - eps * invScale, ny)) * inv2eps;
        const dfdy = (noise(nx, ny + eps * invScale) - noise(nx, ny - eps * invScale)) * inv2eps;
        fx[i] = dfdy * curlGain * params.strength;
        fy[i] = -dfdx * curlGain * params.strength;
        continue;
      }

      // (A) Per-region curl noise. Offset the sample position by a
      //     region-ID-derived hash so adjacent regions read different
      //     patches of the noise field.
      const regionOffsetX = (r * 7919) % 9973;
      const regionOffsetY = (r * 6469) % 7919;
      const nx = (x + regionOffsetX) * invScale;
      const ny = (y + regionOffsetY) * invScale;
      const dfdx = (noise(nx + eps * invScale, ny) - noise(nx - eps * invScale, ny)) * inv2eps;
      const dfdy = (noise(nx, ny + eps * invScale) - noise(nx, ny - eps * invScale)) * inv2eps;
      const internalX = dfdy * curlGain;
      const internalY = -dfdx * curlGain;

      // (B) Boundary tangent — derive analytically from the JFA's
      //     nearest-seed coords. The outward unit vector at this pixel
      //     points TO the nearest non-same-region pixel; rotating 90° CCW
      //     gives the tangent that follows the boundary smoothly. No
      //     numerical gradient artifacts.
      let tangentX = 0;
      let tangentY = 0;
      const nearestI = nearest[i];
      const dist = Math.sqrt(distSq[i]);
      if (nearestI >= 0 && dist > 0.5) {
        const sx = nearestI % w;
        const sy = (nearestI / w) | 0;
        const ndx = sx - x;
        const ndy = sy - y;
        const inv = 1 / dist;
        // (ndx, ndy)/dist = outward unit normal. Rotate 90° CCW = tangent.
        tangentX = -ndy * inv;
        tangentY = ndx * inv;
      }

      // Blend internal swirl + tangent.
      let finalX = internalX * internalWeight + tangentX * tangentWeight;
      let finalY = internalY * internalWeight + tangentY * tangentWeight;

      // Boundary attenuation: smoothly fade flow magnitude to zero as we
      // approach the boundary so adjacent regions have visibly separated
      // flow fields.
      if (invFalloff > 0) {
        let t = dist * invFalloff;
        if (t > 1) t = 1;
        const att = t * t * (3 - 2 * t); // smoothstep
        finalX *= att;
        finalY *= att;
      }

      fx[i] = finalX * params.strength;
      fy[i] = finalY * params.strength;
    }
  }

  // Post-process: separable 3-tap box blur, two passes ≈ 5-tap Gaussian.
  // Smooths out residual angular discreteness in the tangent (which can
  // still happen along iso-distance ridges where JFA picks one of two
  // equidistant seeds) and softens the boundary feather edge. Cheap:
  // ~6 ops/pixel × 4 passes = 24M ops for a 1024² doc.
  separableBoxBlur(fx, w, h);
  separableBoxBlur(fx, w, h);
  separableBoxBlur(fy, w, h);
  separableBoxBlur(fy, w, h);

  return { width: w, height: h, fx, fy };
}

/** Separable 3-tap box blur, one full 2D pass (horizontal then vertical),
 *  in-place via a single scratch row/column. Mass-preserving at the
 *  interior; edges clamp by skipping the out-of-bounds tap. */
function separableBoxBlur(buf: Float32Array, w: number, h: number): void {
  const scratch = new Float32Array(Math.max(w, h));
  // Horizontal pass.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = x > 0 ? buf[row + x - 1] : buf[row + x];
      const c = buf[row + x];
      const r = x < w - 1 ? buf[row + x + 1] : buf[row + x];
      scratch[x] = (l + c + r) * (1 / 3);
    }
    for (let x = 0; x < w; x++) buf[row + x] = scratch[x];
  }
  // Vertical pass.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const u = y > 0 ? buf[(y - 1) * w + x] : buf[y * w + x];
      const c = buf[y * w + x];
      const d = y < h - 1 ? buf[(y + 1) * w + x] : buf[y * w + x];
      scratch[y] = (u + c + d) * (1 / 3);
    }
    for (let y = 0; y < h; y++) buf[y * w + x] = scratch[y];
  }
}

