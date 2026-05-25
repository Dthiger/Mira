/**
 * Curl-of-noise warp of an indexed-palette mask.
 *
 * For each output pixel (x, y) we sample a scalar 2D simplex-noise field at
 * (x, y) / scale, compute its curl (perpendicular to the gradient), and use
 * that as a 2D displacement. The source pixel at (x - strength * curl_x,
 * y - strength * curl_y) is rounded to the nearest integer and copied into
 * the output (nearest-neighbor lookup keeps the no-AA invariant: every
 * output pixel is a clean palette index, never an average).
 *
 * Curl of a 2D scalar potential f is (df/dy, -df/dx). The resulting vector
 * field is divergence-free, so particles advect along contour lines of f
 * without bunching up or spreading out — the visual signature is organic
 * intermingling without color quantity changing.
 */

import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { BACKGROUND_INDEX } from '../../palette.ts';

export interface SwirlParams {
  /** doc-px scale of the noise field. Larger = bigger swirls. */
  scale: number;
  /** Maximum displacement magnitude in doc-px. */
  strength: number;
  /** PRNG seed for the noise field. */
  seed: number;
}

/** Builds a seeded simplex-noise function. simplex-noise's `createNoise2D`
 *  accepts a `() => number` PRNG, so we wrap a deterministic mulberry32. */
export function buildNoise(seed: number): NoiseFunction2D {
  // mulberry32: tiny seedable PRNG, good enough for noise seeding.
  let state = (seed >>> 0) || 1;
  const prng = (): number => {
    state |= 0; state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return createNoise2D(prng);
}

/** Warp `src` into `dst`. Both Uint8Array of palette indices, width*height
 *  long. `dst` is fully overwritten. Source pixels that resolve outside the
 *  doc become `BACKGROUND_INDEX`. */
export function warpDoc(
  src: Uint8Array,
  dst: Uint8Array,
  width: number,
  height: number,
  noise: NoiseFunction2D,
  params: SwirlParams,
): void {
  const invScale = 1 / params.scale;
  const strength = params.strength;
  const eps = 1;
  const inv2eps = 1 / (2 * eps);
  // Curl gain so per-step displacement is roughly scale-independent.
  const curlGain = params.scale * 0.2;
  const STEPS = 5;
  const stepLen = strength / STEPS;

  // Precompute curl on a coarse grid; the inner loop bilinear-samples it.
  // Without this we'd be doing 4 noise() calls per substep per pixel —
  // ~24M calls for a 1024² doc. With it we do ~260K, and the per-pixel
  // hot loop is just array math.
  //
  // Adaptive resolution: target ≥4 grid samples per noise wavelength so
  // bilinear interp doesn't alias. For small scales we need a dense grid;
  // big scales let us go coarse for free.
  const targetSpacing = Math.max(2, params.scale * 0.25);
  const N = Math.min(512, Math.max(32, Math.ceil(Math.max(width, height) / targetSpacing)));
  const Np1 = N + 1;
  const cellW = width / N;
  const cellH = height / N;
  const invCellW = N / width;
  const invCellH = N / height;
  const cornerCount = Np1 * Np1;
  const curlX = new Float32Array(cornerCount);
  const curlY = new Float32Array(cornerCount);
  for (let gy = 0; gy <= N; gy++) {
    const yy = gy * cellH;
    for (let gx = 0; gx <= N; gx++) {
      const xx = gx * cellW;
      const nx = xx * invScale;
      const ny = yy * invScale;
      const dfdx = (noise(nx + eps * invScale, ny) - noise(nx - eps * invScale, ny)) * inv2eps;
      const dfdy = (noise(nx, ny + eps * invScale) - noise(nx, ny - eps * invScale)) * inv2eps;
      const i = gy * Np1 + gx;
      curlX[i] = dfdy * curlGain;
      curlY[i] = -dfdx * curlGain;
    }
  }

  // Per-pixel: trace backward along the precomputed curl field.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let px = x;
      let py = y;
      for (let s = 0; s < STEPS; s++) {
        // Bilinear-sample the curl field at (px, py). Clamp to grid bounds.
        let fgx = px * invCellW;
        let fgy = py * invCellH;
        if (fgx < 0) fgx = 0; else if (fgx > N) fgx = N;
        if (fgy < 0) fgy = 0; else if (fgy > N) fgy = N;
        const gx0 = fgx | 0;
        const gy0 = fgy | 0;
        const gx1 = gx0 < N ? gx0 + 1 : N;
        const gy1 = gy0 < N ? gy0 + 1 : N;
        const u = fgx - gx0;
        const v = fgy - gy0;
        const omU = 1 - u;
        const omV = 1 - v;
        const w00 = omU * omV, w10 = u * omV, w01 = omU * v, w11 = u * v;
        const i00 = gy0 * Np1 + gx0;
        const i10 = gy0 * Np1 + gx1;
        const i01 = gy1 * Np1 + gx0;
        const i11 = gy1 * Np1 + gx1;
        const cx = w00 * curlX[i00] + w10 * curlX[i10] + w01 * curlX[i01] + w11 * curlX[i11];
        const cy = w00 * curlY[i00] + w10 * curlY[i10] + w01 * curlY[i01] + w11 * curlY[i11];
        px -= stepLen * cx;
        py -= stepLen * cy;
      }
      const sx = Math.round(px);
      const sy = Math.round(py);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
        dst[y * width + x] = BACKGROUND_INDEX;
      } else {
        dst[y * width + x] = src[sy * width + sx];
      }
    }
  }
}
