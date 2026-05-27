/**
 * Real-time 2D Stable Fluids (Stam 1999), background-as-fluid topology.
 *
 * The painted regions are OBSTACLES (walls); the surrounding background
 * is the fluid. The simulation evolves the velocity field around the
 * shapes — fluid flows past, slows down at the walls, forms wakes and
 * vortices in cavities. This is what the BathBomb-style demo does and
 * it's what you want for a Substance flowmap that drives displacement
 * around tissue features.
 *
 * The sim runs on an internal lower-resolution grid (SIM_RES²) for
 * real-time speed, then bilinear-upsamples to doc resolution for display
 * and export. JS at 1024² can't hit 30 fps for full Stam (Jacobi alone
 * is ~150M ops/frame); 256² is ~5–10 ms/step on modern hardware and
 * keeps the RAF loop responsive.
 *
 * One step is the standard Stam recipe (no viscosity, projection only):
 *   1. self-advect velocity (semi-Lagrangian, bilinear interp)
 *   2. compute divergence
 *   3. Jacobi pressure solve (~20 iters; Dirichlet p=0 at walls)
 *   4. subtract pressure gradient
 *   5. zero velocity at wall pixels (enforced implicitly by the mask)
 */

import { NO_REGION } from '../../ccl.ts';
import type { FlowField } from './types.ts';

/** Internal sim resolution. 384² is ~2.25× more work than 256² but
 *  produces noticeably finer vortex structure. Drop back to 256 if your
 *  hardware can't sustain 30 fps. */
export const SIM_RES = 384;
const PRESSURE_ITERS = 20;
const DT = 1.0;

export interface FluidSimState {
  /** Sim grid is SIM_RES × SIM_RES, separate from doc resolution. */
  W: number;
  H: number;
  /** Sim-to-doc mapping. */
  docW: number;
  docH: number;
  /** fluidMask[i] = 1 if sim pixel is fluid (corresponding doc pixel is
   *  background). Shape pixels become walls. */
  fluidMask: Uint8Array;
  velX: Float32Array;
  velY: Float32Array;
  velXScratch: Float32Array;
  velYScratch: Float32Array;
  pressureA: Float32Array;
  pressureB: Float32Array;
  divergence: Float32Array;
  /** Snapshot of the initial seed velocity (post-CFL rescaling). Used
   *  as the continuous forcing pattern — adding a small fraction back
   *  each step keeps the fluid energized so it doesn't decay to a
   *  steady state. Curl-of-noise is divergence-free so this doesn't
   *  fight the pressure projection. */
  seedVelX: Float32Array;
  seedVelY: Float32Array;
  /** Per-step directional push (sim-px / step). Like a constant wind
   *  through the domain. Combined with open boundaries this drives
   *  classic flow-past-obstacle behavior — fluid enters one side, gets
   *  deflected by shapes, sheds vortices in their wakes, leaves the
   *  other side. Live-tunable (no re-seed). */
  dirX: number;
  dirY: number;
  /** Per-step turbulence — fraction of the seed curl-noise field
   *  re-injected each step. 0 = no turbulence (fluid decays to steady
   *  state), 0.05 = mild stirring, 0.2 = strong chaotic. Live-tunable. */
  forceMag: number;
  stepsRun: number;
  /** Scaling applied to seed velocity (CFL-safe). Output scaled back up
   *  by 1/this when assembling so external code sees the user's
   *  magnitudes. */
  outputScale: number;
}

/** Default per-step fraction of the seed velocity re-injected as
 *  forcing — "turbulence". Higher = more chaotic stirring, lower = the
 *  fluid decays toward a steady state. Now a sim-state field so the
 *  user can tune it live; this is the initial value. */
const DEFAULT_FORCE_MAG = 0.05;
/** Velocity-magnitude clamp (in sim-pixels-per-step). CFL stability for
 *  semi-Lagrangian + bilinear is fine up to about 2; we cap at 2.5 to
 *  absorb noise headroom. Without this, repeated forcing can let velocity
 *  drift past CFL and the advection step starts aliasing into thin
 *  diagonal streaks. */
const MAX_VEL = 2.5;

/** Build a background fluid sim. Walls are everywhere a region exists;
 *  fluid lives in the background. Velocity seeded by sampling the
 *  doc-resolution initial field at the center of each sim pixel. */
export function initFluidSim(
  regionsMap: Int32Array,
  docW: number,
  docH: number,
  initialFx: Float32Array,
  initialFy: Float32Array,
): FluidSimState {
  const W = SIM_RES;
  const H = SIM_RES;
  const N = W * H;
  const scaleX = docW / W;
  const scaleY = docH / H;

  const fluidMask = new Uint8Array(N);
  const velX = new Float32Array(N);
  const velY = new Float32Array(N);

  // Build mask + sample seed velocity. A sim cell is wall if ANY doc
  // pixel in its block is in a region — conservative, so thin shape
  // edges can't leak fluid through. Seed velocity is averaged over the
  // bg pixels in the block (= proper downsampling instead of point
  // sampling, which was aliased).
  let maxMag2 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = y * W + x;
      const docXLo = (x * scaleX) | 0;
      const docYLo = (y * scaleY) | 0;
      const docXHi = Math.min(docW, ((x + 1) * scaleX) | 0);
      const docYHi = Math.min(docH, ((y + 1) * scaleY) | 0);
      let anyRegion = false;
      let sumFx = 0, sumFy = 0, sumN = 0;
      outer: for (let dy = docYLo; dy < docYHi; dy++) {
        for (let dx = docXLo; dx < docXHi; dx++) {
          const docI = dy * docW + dx;
          if (regionsMap[docI] !== NO_REGION) { anyRegion = true; break outer; }
          sumFx += initialFx[docI];
          sumFy += initialFy[docI];
          sumN++;
        }
      }
      if (anyRegion || sumN === 0) continue; // wall
      fluidMask[si] = 1;
      const inv = 1 / sumN;
      const fx = sumFx * inv;
      const fy = sumFy * inv;
      velX[si] = fx;
      velY[si] = fy;
      const m = fx * fx + fy * fy;
      if (m > maxMag2) maxMag2 = m;
    }
  }

  // Rescale velocity so peak magnitude is ~2 sim-px/step (CFL-friendly
  // for semi-Lagrangian + bilinear).
  const peak = Math.sqrt(maxMag2);
  const targetPeak = 2.0;
  const inScale = peak > 1e-9 ? targetPeak / peak : 1;
  const outputScale = inScale > 1e-9 ? 1 / inScale : 1;
  if (inScale !== 1) {
    for (let i = 0; i < N; i++) {
      velX[i] *= inScale;
      velY[i] *= inScale;
    }
  }

  return {
    W, H, docW, docH,
    fluidMask, velX, velY,
    velXScratch: new Float32Array(N),
    velYScratch: new Float32Array(N),
    pressureA: new Float32Array(N),
    pressureB: new Float32Array(N),
    divergence: new Float32Array(N),
    seedVelX: new Float32Array(velX),
    seedVelY: new Float32Array(velY),
    dirX: 0, dirY: 0,
    forceMag: DEFAULT_FORCE_MAG,
    stepsRun: 0, outputScale,
  };
}

/** Live-set the turbulence (per-step seed-noise re-injection fraction). */
export function setTurbulence(sim: FluidSimState, forceMag: number): void {
  sim.forceMag = Math.max(0, forceMag);
}

/** Live-set the constant directional push. Doesn't require re-seeding,
 *  takes effect on the next sim step. */
export function setDirectionalForce(sim: FluidSimState, dirX: number, dirY: number): void {
  sim.dirX = dirX;
  sim.dirY = dirY;
}

/** One-shot velocity injection at a sim-grid location with smoothstep
 *  falloff. Used by the mouse-drag interaction — each pointermove adds
 *  a force proportional to drag speed in the drag direction. Walls are
 *  skipped. The force gets advected on the next sim step like any other
 *  fluid motion. */
export function injectForce(
  sim: FluidSimState,
  simX: number,
  simY: number,
  fx: number,
  fy: number,
  radius: number,
): void {
  const { W, H, fluidMask, velX, velY } = sim;
  if (radius <= 0) return;
  const r2 = radius * radius;
  const invR = 1 / radius;
  const xMin = Math.max(0, Math.floor(simX - radius));
  const yMin = Math.max(0, Math.floor(simY - radius));
  const xMax = Math.min(W - 1, Math.ceil(simX + radius));
  const yMax = Math.min(H - 1, Math.ceil(simY + radius));
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const i = y * W + x;
      if (!fluidMask[i]) continue;
      const dx = x - simX;
      const dy = y - simY;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const t = 1 - Math.sqrt(d2) * invR;
      const w = t * t * (3 - 2 * t); // smoothstep
      velX[i] += fx * w;
      velY[i] += fy * w;
    }
  }
}

/** Advance the sim by `n` Stam steps. */
export function fluidStep(sim: FluidSimState, n = 1): void {
  for (let k = 0; k < n; k++) {
    applyForcing(sim);
    clampVelocity(sim);
    advect(sim);
    computeDivergence(sim);
    solvePressure(sim);
    subtractPressureGradient(sim);
    applyOpenBoundaries(sim);
    sim.stepsRun++;
  }
}

/** Clamp per-pixel velocity magnitude to MAX_VEL so semi-Lagrangian
 *  advection stays within its CFL budget. Without this, repeated
 *  forcing slowly grows velocity past the stability limit and the
 *  advection step starts producing thin diagonal streaks. */
function clampVelocity(sim: FluidSimState): void {
  const { fluidMask, velX, velY } = sim;
  const max2 = MAX_VEL * MAX_VEL;
  const n = fluidMask.length;
  for (let i = 0; i < n; i++) {
    if (!fluidMask[i]) continue;
    const vx = velX[i];
    const vy = velY[i];
    const m2 = vx * vx + vy * vy;
    if (m2 > max2) {
      const s = MAX_VEL / Math.sqrt(m2);
      velX[i] = vx * s;
      velY[i] = vy * s;
    }
  }
}

/** Continuous forcing per step:
 *    1. A small fraction of the seed curl-noise (turbulent stirring).
 *    2. A constant directional push (wind / driven flow). Combined with
 *       open boundaries this gives the "fluid flowing past obstacles"
 *       behavior — fluid enters one side, deflects around shapes, sheds
 *       vortices, and exits the other side.
 *  Both components are divergence-free or constant, so neither fights
 *  the pressure projection. */
function applyForcing(sim: FluidSimState): void {
  const { fluidMask, velX, velY, seedVelX, seedVelY, dirX, dirY, forceMag } = sim;
  const n = fluidMask.length;
  for (let i = 0; i < n; i++) {
    if (!fluidMask[i]) continue;
    velX[i] += seedVelX[i] * forceMag + dirX;
    velY[i] += seedVelY[i] * forceMag + dirY;
  }
}

/** Zero-gradient (Neumann) boundary on the four sim-grid edges. Without
 *  this, the edges effectively act as walls (the inner loops skip them,
 *  so they stay at 0). Copy the inside-by-one row/col to the edge so
 *  fluid can enter and leave the domain — required for directional
 *  inflow to make sense ("wind from outside the doc bounds"). */
function applyOpenBoundaries(sim: FluidSimState): void {
  const { W, H, fluidMask, velX, velY } = sim;
  // Top + bottom rows.
  const lastRow = (H - 1) * W;
  const prevLast = (H - 2) * W;
  for (let x = 0; x < W; x++) {
    if (fluidMask[x] && fluidMask[W + x]) {
      velX[x] = velX[W + x];
      velY[x] = velY[W + x];
    }
    if (fluidMask[lastRow + x] && fluidMask[prevLast + x]) {
      velX[lastRow + x] = velX[prevLast + x];
      velY[lastRow + x] = velY[prevLast + x];
    }
  }
  // Left + right columns.
  for (let y = 0; y < H; y++) {
    const rowOff = y * W;
    if (fluidMask[rowOff] && fluidMask[rowOff + 1]) {
      velX[rowOff] = velX[rowOff + 1];
      velY[rowOff] = velY[rowOff + 1];
    }
    if (fluidMask[rowOff + W - 1] && fluidMask[rowOff + W - 2]) {
      velX[rowOff + W - 1] = velX[rowOff + W - 2];
      velY[rowOff + W - 1] = velY[rowOff + W - 2];
    }
  }
}

function advect(sim: FluidSimState): void {
  const { W, H, fluidMask, velX, velY, velXScratch, velYScratch } = sim;
  velXScratch.set(velX);
  velYScratch.set(velY);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!fluidMask[i]) { velX[i] = 0; velY[i] = 0; continue; }
      let sx = x - DT * velXScratch[i];
      let sy = y - DT * velYScratch[i];
      if (sx < 0.5) sx = 0.5; else if (sx > W - 1.5) sx = W - 1.5;
      if (sy < 0.5) sy = 0.5; else if (sy > H - 1.5) sy = H - 1.5;
      velX[i] = sampleMasked(velXScratch, fluidMask, W, sx, sy);
      velY[i] = sampleMasked(velYScratch, fluidMask, W, sx, sy);
    }
  }
}

function sampleMasked(
  buf: Float32Array, mask: Uint8Array, W: number,
  x: number, y: number,
): number {
  const x0 = x | 0;
  const y0 = y | 0;
  const u = x - x0;
  const v = y - y0;
  const i00 = y0 * W + x0;
  const i10 = i00 + 1;
  const i01 = i00 + W;
  const i11 = i01 + 1;
  const s00 = mask[i00] ? buf[i00] : 0;
  const s10 = mask[i10] ? buf[i10] : 0;
  const s01 = mask[i01] ? buf[i01] : 0;
  const s11 = mask[i11] ? buf[i11] : 0;
  return (1 - u) * (1 - v) * s00 + u * (1 - v) * s10
       + (1 - u) * v       * s01 + u * v       * s11;
}

function computeDivergence(sim: FluidSimState): void {
  const { W, H, fluidMask, velX, velY, divergence } = sim;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!fluidMask[i]) { divergence[i] = 0; continue; }
      const vxR = fluidMask[i + 1] ? velX[i + 1] : 0;
      const vxL = fluidMask[i - 1] ? velX[i - 1] : 0;
      const vyD = fluidMask[i + W] ? velY[i + W] : 0;
      const vyU = fluidMask[i - W] ? velY[i - W] : 0;
      divergence[i] = (vxR - vxL + vyD - vyU) * 0.5;
    }
  }
}

function solvePressure(sim: FluidSimState): void {
  const { W, H, fluidMask, divergence, pressureA, pressureB } = sim;
  pressureA.fill(0);
  pressureB.fill(0);
  let src = pressureA, dst = pressureB;
  for (let it = 0; it < PRESSURE_ITERS; it++) {
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!fluidMask[i]) { dst[i] = 0; continue; }
        const pR = fluidMask[i + 1] ? src[i + 1] : 0;
        const pL = fluidMask[i - 1] ? src[i - 1] : 0;
        const pD = fluidMask[i + W] ? src[i + W] : 0;
        const pU = fluidMask[i - W] ? src[i - W] : 0;
        dst[i] = (pR + pL + pD + pU - divergence[i]) * 0.25;
      }
    }
    const tmp = src; src = dst; dst = tmp;
  }
  if (src !== pressureA) pressureA.set(src);
}

function subtractPressureGradient(sim: FluidSimState): void {
  const { W, H, fluidMask, velX, velY, pressureA } = sim;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!fluidMask[i]) { velX[i] = 0; velY[i] = 0; continue; }
      const pR = fluidMask[i + 1] ? pressureA[i + 1] : 0;
      const pL = fluidMask[i - 1] ? pressureA[i - 1] : 0;
      const pD = fluidMask[i + W] ? pressureA[i + W] : 0;
      const pU = fluidMask[i - W] ? pressureA[i - W] : 0;
      velX[i] -= (pR - pL) * 0.5;
      velY[i] -= (pD - pU) * 0.5;
    }
  }
}

/** Compose the doc-resolution flow field: shape interiors are zero
 *  (walls have no flow — makes it visually obvious which pixels are
 *  solid). Background pixels read from the sim grid (bilinear-upsampled
 *  to doc res). The sim's outputScale is applied so external units match
 *  the static field. */
export function assembleFluidField(
  sim: FluidSimState,
  regionsMap: Int32Array,
  staticField: FlowField,
): FlowField {
  const docW = staticField.width;
  const docH = staticField.height;
  // Zero-init: shape pixels stay zero (walls show no flow in HSL/RG
  // preview AND in the exported PNG). This is what the user wants for
  // Substance — the shapes get their own normal-map treatment; the
  // flowmap encodes only the surrounding fluid.
  const fx = new Float32Array(docW * docH);
  const fy = new Float32Array(docW * docH);

  const { W, H, fluidMask, velX, velY, outputScale } = sim;
  const invScaleX = W / docW;
  const invScaleY = H / docH;

  for (let y = 0; y < docH; y++) {
    for (let x = 0; x < docW; x++) {
      const docI = y * docW + x;
      if (regionsMap[docI] !== NO_REGION) continue; // skip region interiors (already filled)
      // Bilinear sample sim velocity at doc pixel center.
      const sx = (x + 0.5) * invScaleX - 0.5;
      const sy = (y + 0.5) * invScaleY - 0.5;
      const sx0 = sx < 0 ? 0 : (sx | 0);
      const sy0 = sy < 0 ? 0 : (sy | 0);
      const sx1 = sx0 < W - 1 ? sx0 + 1 : sx0;
      const sy1 = sy0 < H - 1 ? sy0 + 1 : sy0;
      const u = sx - sx0;
      const v = sy - sy0;
      const i00 = sy0 * W + sx0;
      const i10 = sy0 * W + sx1;
      const i01 = sy1 * W + sx0;
      const i11 = sy1 * W + sx1;
      // Mask-aware bilinear: walls contribute zero.
      const m00 = fluidMask[i00], m10 = fluidMask[i10], m01 = fluidMask[i01], m11 = fluidMask[i11];
      const omu = 1 - u, omv = 1 - v;
      const w00 = omu * omv * m00;
      const w10 = u   * omv * m10;
      const w01 = omu * v   * m01;
      const w11 = u   * v   * m11;
      const wsum = w00 + w10 + w01 + w11;
      if (wsum > 0) {
        const inv = outputScale / wsum;
        fx[docI] = (w00 * velX[i00] + w10 * velX[i10] + w01 * velX[i01] + w11 * velX[i11]) * inv;
        fy[docI] = (w00 * velY[i00] + w10 * velY[i10] + w01 * velY[i01] + w11 * velY[i11]) * inv;
      }
    }
  }
  return { width: docW, height: docH, fx, fy };
}
