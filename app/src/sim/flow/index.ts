/**
 * Flowmap-mode public API. Manages the static A+B field, the background
 * Stam fluid sim (continuous via RAF), the combined render on the sim
 * canvas, and the PNG export.
 *
 * Topology: shapes are walls, background is fluid (BathBomb-style). The
 * fluid sim runs at SIM_RES² internally and bilinear-upsamples for
 * display + export.
 *
 * Display field = (static A+B inside regions) ⊕ (sim velocity in bg).
 * Inside regions: doesn't move (per-region curl + tangent stays put).
 * Outside regions: evolves frame by frame when the sim is playing.
 */

import type { MaskDocument } from '../../document.ts';
import { buildFlow, buildFlowCache, type FlowCache } from './build.ts';
import { renderFlow } from './render.ts';
import { encodeFlowmapPng, type FlowEncodeOptions } from './encode.ts';
import {
  initFluidSim, fluidStep, assembleFluidField, setDirectionalForce,
  setTurbulence, injectForce, type FluidSimState,
} from './fluid.ts';
import type { FlowField, FlowParams } from './types.ts';

const DEFAULTS: FlowParams = {
  scale: 140,
  strength: 80,
  seed: 42,
  tangentMix: 0.3,
  boundaryFalloff: 32,
  pushAngle: 0,
  pushStrength: 20,
};

/** Map a [0..100] push-strength slider to a per-step velocity increment
 *  in sim-pixel units. 100 → 0.1/step which, with CFL clamp at 2.5,
 *  saturates the field in ~25 steps (~1 second at 30fps). */
const PUSH_SCALE = 0.001;

export const params: FlowParams = { ...DEFAULTS };
export const exportOptions: FlowEncodeOptions = { flipY: false };

let docRef: MaskDocument | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let staticField: FlowField | null = null;
let displayField: FlowField | null = null;
let cache: FlowCache | null = null;
let sim: FluidSimState | null = null;
let active = false;

// RAF loop state
let rafId = 0;
let playing = false;
/** Steps-per-frame: small (1) for fine evolution, larger for faster
 *  visible change at the cost of frame-rate. */
let stepsPerFrame = 1;

const playListeners: Array<(playing: boolean, steps: number) => void> = [];
export function onPlaybackChange(cb: (playing: boolean, steps: number) => void): void {
  playListeners.push(cb);
}
function notifyPlayback(): void {
  for (const cb of playListeners) cb(playing, sim ? sim.stepsRun : 0);
}

export function flowIsActive(): boolean { return active; }
export function getFlowField(): FlowField | null { return displayField; }
export function isSimPlaying(): boolean { return playing; }
export function isSimRunning(): boolean { return sim !== null; }
export function getSimStepsRun(): number { return sim ? sim.stepsRun : 0; }
export function setStepsPerFrame(n: number): void { stepsPerFrame = Math.max(1, n | 0); }

export function enterFlow(doc: MaskDocument, simCanvas: HTMLCanvasElement): void {
  if (active) return;
  simCanvas.width = doc.width;
  simCanvas.height = doc.height;
  const c = simCanvas.getContext('2d');
  if (!c) throw new Error('Could not acquire 2d context for sim canvas');
  c.imageSmoothingEnabled = false;
  ctx = c;
  docRef = doc;
  cache = buildFlowCache(doc);
  sim = null;
  playing = false;
  active = true;
  recompute();
  notifyPlayback();
}

export function exitFlow(): void {
  if (!active) return;
  active = false;
  pause();
  if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx = null;
  docRef = null;
  staticField = null;
  displayField = null;
  cache = null;
  sim = null;
}

/** Rebuild the static A+B field and re-seed the sim if one was active.
 *  Called by all the slider edits. */
export function recompute(): void {
  if (!active || !docRef || !ctx || !cache) return;
  staticField = buildFlow(docRef, params, cache);
  if (sim) {
    sim = initFluidSim(cache.regions, staticField.width, staticField.height,
      staticField.fx, staticField.fy);
    applyPushParams();
    displayField = assembleFluidField(sim, cache.regions, staticField);
  } else {
    displayField = staticField;
  }
  renderFlow(ctx, displayField);
  notifyPlayback();
}

/** Live-update the sim's directional force from current params. Called
 *  on every recompute and also from setPush (no full recompute needed
 *  for direction edits since the seed velocity is unchanged). */
function applyPushParams(): void {
  if (!sim) return;
  const rad = params.pushAngle * Math.PI / 180;
  const mag = params.pushStrength * PUSH_SCALE;
  setDirectionalForce(sim, Math.cos(rad) * mag, Math.sin(rad) * mag);
}

/** Update push direction/strength without re-seeding the sim. Cheap;
 *  takes effect on the next step. */
export function setPush(angleDeg: number, strength: number): void {
  params.pushAngle = angleDeg;
  params.pushStrength = strength;
  applyPushParams();
}

/** Live-update the turbulence (per-step noise re-injection). Slider
 *  range 0–100 maps to forceMag 0–0.2. */
export function setTurbulenceLevel(slider: number): void {
  const forceMag = (slider / 100) * 0.2;
  if (sim) setTurbulence(sim, forceMag);
}

// ---------- Mouse-drag force injection ----------

/** Brush radius in DOC pixels for click-drag force injection. */
let dragRadiusDoc = 60;
let dragStrength = 0.4;
let dragActive = false;
let lastDragDocX = 0;
let lastDragDocY = 0;

export function setDragRadius(docPx: number): void { dragRadiusDoc = Math.max(4, docPx); }
export function setDragStrength(s: number): void { dragStrength = Math.max(0, s); }

function ensureSim(): void {
  if (sim) return;
  if (!active || !staticField || !cache) return;
  sim = initFluidSim(cache.regions, staticField.width, staticField.height,
    staticField.fx, staticField.fy);
  applyPushParams();
}

export function flowPointerDown(docX: number, docY: number): void {
  if (!active) return;
  ensureSim();
  dragActive = true;
  lastDragDocX = docX;
  lastDragDocY = docY;
}

export function flowPointerMove(docX: number, docY: number): void {
  if (!dragActive || !sim || !cache || !ctx || !staticField) return;
  const docDx = docX - lastDragDocX;
  const docDy = docY - lastDragDocY;
  lastDragDocX = docX;
  lastDragDocY = docY;
  if (docDx === 0 && docDy === 0) return;
  // Map doc-space cursor + delta into sim-grid coords.
  const docToSimX = sim.W / sim.docW;
  const docToSimY = sim.H / sim.docH;
  const simX = docX * docToSimX;
  const simY = docY * docToSimY;
  const simDx = docDx * docToSimX;
  const simDy = docDy * docToSimY;
  const simRadius = dragRadiusDoc * docToSimX;
  injectForce(sim, simX, simY, simDx * dragStrength, simDy * dragStrength, simRadius);
  // If the sim isn't running, step it once so the user sees immediate
  // feedback from the drag (otherwise the force just sits there).
  if (!playing) {
    fluidStep(sim, 1);
    displayField = assembleFluidField(sim, cache.regions, staticField);
    renderFlow(ctx, displayField);
    notifyPlayback();
  }
}

export function flowPointerUp(): void {
  dragActive = false;
}

export function reseed(seed: number): void {
  params.seed = seed;
  recompute();
}

export function flowResetParams(): void {
  params.scale = DEFAULTS.scale;
  params.strength = DEFAULTS.strength;
  params.seed = DEFAULTS.seed;
  params.tangentMix = DEFAULTS.tangentMix;
  params.boundaryFalloff = DEFAULTS.boundaryFalloff;
  params.pushAngle = DEFAULTS.pushAngle;
  params.pushStrength = DEFAULTS.pushStrength;
  recompute();
}

export function getFlowDefaults(): Readonly<FlowParams> { return DEFAULTS; }

// ---------- Sim control ----------

/** Initialize the sim if not already, advance n steps, render. */
export function simStep(steps: number): void {
  if (!active || !staticField || !cache || !ctx) return;
  if (!sim) {
    sim = initFluidSim(cache.regions, staticField.width, staticField.height,
      staticField.fx, staticField.fy);
    applyPushParams();
  }
  fluidStep(sim, steps);
  displayField = assembleFluidField(sim, cache.regions, staticField);
  renderFlow(ctx, displayField);
  notifyPlayback();
}

/** Drop the sim, return to the static A+B field. */
export function simReset(): void {
  pause();
  sim = null;
  if (staticField && ctx) {
    displayField = staticField;
    renderFlow(ctx, displayField);
  }
  notifyPlayback();
}

export function play(): void {
  if (playing || !active) return;
  playing = true;
  notifyPlayback();
  loop();
}

export function pause(): void {
  if (!playing) return;
  playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  notifyPlayback();
}

function loop(): void {
  if (!playing || !active) return;
  simStep(stepsPerFrame);
  rafId = requestAnimationFrame(loop);
}

export async function exportFlowmap(): Promise<Blob> {
  if (!displayField) throw new Error('No flow field to export — enter flow mode first');
  return encodeFlowmapPng(displayField, exportOptions);
}
