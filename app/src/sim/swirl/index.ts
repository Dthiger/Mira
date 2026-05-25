/**
 * Swirl-mode public API. Owns the source/warped pixel buffers, the noise
 * function (rebuilt when seed changes), and the live preview render on
 * the sim canvas.
 *
 * Phase 5: GLOBAL mode only — the warp covers the entire doc. Adjusting
 * any slider triggers a re-warp and re-render. Bake copies the warped
 * buffer into doc.pixels.
 *
 * Phase 6 will add a local-drag mode where the warp is restricted to a
 * cursor-centered region with a falloff.
 */

import type { MaskDocument } from '../../document.ts';
import { buildNoise, warpDoc, type SwirlParams } from './warp.ts';
import { renderSwirl } from './render.ts';
import type { NoiseFunction2D } from 'simplex-noise';

const DEFAULTS: SwirlParams = { scale: 120, strength: 40, seed: 42 };
export const params: SwirlParams = { ...DEFAULTS };

/** Snap params back to defaults and rebuild the noise field. The toolbar
 *  is responsible for re-syncing its slider DOM values. */
export function swirlResetParams(): void {
  params.scale = DEFAULTS.scale;
  params.strength = DEFAULTS.strength;
  params.seed = DEFAULTS.seed;
  noise = buildNoise(params.seed);
  recompute();
}

export function getSwirlDefaults(): Readonly<SwirlParams> { return DEFAULTS; }

let docRef: MaskDocument | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let src: Uint8Array | null = null;        // snapshot of doc.pixels at enter
let dst: Uint8Array | null = null;        // warped output buffer
let noise: NoiseFunction2D | null = null;
let active = false;

export function swirlIsActive(): boolean { return active; }

export function enterSwirl(doc: MaskDocument, simCanvas: HTMLCanvasElement): void {
  if (active) return;
  simCanvas.width = doc.width;
  simCanvas.height = doc.height;
  const c = simCanvas.getContext('2d');
  if (!c) throw new Error('Could not acquire 2d context for sim canvas');
  c.imageSmoothingEnabled = false;
  ctx = c;
  docRef = doc;
  src = new Uint8Array(doc.pixels); // snapshot
  dst = new Uint8Array(doc.pixels.length);
  noise = buildNoise(params.seed);
  active = true;
  recompute();
}

export function exitSwirl(): void {
  if (!active) return;
  active = false;
  if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx = null;
  docRef = null;
  src = null;
  dst = null;
  noise = null;
}

/** Re-warp the source buffer with the current params and repaint the sim
 *  canvas. Called whenever a slider changes or the seed re-rolls. */
export function recompute(): void {
  if (!active || !src || !dst || !ctx || !docRef || !noise) return;
  warpDoc(src, dst, docRef.width, docRef.height, noise, params);
  renderSwirl(ctx, dst, docRef.width, docRef.height);
}

/** Apply a new seed: rebuild the noise function and recompute. */
export function reseed(seed: number): void {
  params.seed = seed;
  noise = buildNoise(seed);
  recompute();
}

/** Commit the warped buffer back into doc.pixels. Caller is responsible
 *  for history.commit() before this and renderer.renderAll() after. */
export function swirlBake(): void {
  if (!docRef || !dst) return;
  docRef.pixels.set(dst);
}
