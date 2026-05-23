/**
 * Pillow-mode public API. Owns world lifecycle, the RAF simulation loop,
 * drag input, and a sim-internal per-stroke undo stack.
 *
 * The undo stack is intentionally separate from the document's history -
 * pillow drags don't touch doc.pixels until the user clicks Bake. Reset
 * snaps vertices back to their rest positions; the undo stack is cleared.
 */

import { buildPillowWorld } from './worldBuild.ts';
import { renderPillow } from './render.ts';
import {
  stepPillow, resetToRest, snapshotPositions, restorePositions,
  type DragForce,
} from './step.ts';
import type { SimWorld } from './types.ts';
import type { MaskDocument } from '../../document.ts';

// Tunables exposed to the toolbar.
export const params = {
  stiffness: 1.0,
  dragRadius: 60,
  dragStrength: 0.7,
};

let world: SimWorld | null = null;
let active = false;
let ctx: CanvasRenderingContext2D | null = null;
let rafId = 0;

let docW = 0;
let docH = 0;

let currentDrag: DragForce | null = null;
let strokeStartSnap: Float64Array | null = null;
const undoStack: Float64Array[] = [];

export function pillowIsActive(): boolean { return active; }
export function getPillowWorld(): SimWorld | null { return world; }

export function enterPillow(doc: MaskDocument, simCanvas: HTMLCanvasElement): void {
  if (active) return;
  simCanvas.width = doc.width;
  simCanvas.height = doc.height;
  const c = simCanvas.getContext('2d');
  if (!c) throw new Error('Could not acquire 2d context for sim canvas');
  c.imageSmoothingEnabled = false;
  ctx = c;
  docW = doc.width;
  docH = doc.height;
  world = buildPillowWorld(doc);
  undoStack.length = 0;
  active = true;
  loop();
}

export function exitPillow(): void {
  if (!active) return;
  active = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx = null;
  world = null;
  currentDrag = null;
  strokeStartSnap = null;
  undoStack.length = 0;
}

// ---------- Drag input ----------

export function dragBegin(docX: number, docY: number): void {
  if (!world) return;
  strokeStartSnap = snapshotPositions(world);
  currentDrag = {
    cursorX: docX, cursorY: docY,
    prevX: docX, prevY: docY,
    radius: params.dragRadius,
    strength: params.dragStrength,
  };
}

export function dragMove(docX: number, docY: number): void {
  if (!currentDrag) return;
  currentDrag.prevX = currentDrag.cursorX;
  currentDrag.prevY = currentDrag.cursorY;
  currentDrag.cursorX = docX;
  currentDrag.cursorY = docY;
}

export function dragEnd(): void {
  if (!currentDrag || !strokeStartSnap) return;
  // Push the BEFORE snapshot so undo restores the pre-stroke state.
  undoStack.push(strokeStartSnap);
  currentDrag = null;
  strokeStartSnap = null;
}

// ---------- Toolbar actions ----------

export function pillowUndo(): boolean {
  if (!world || undoStack.length === 0) return false;
  const snap = undoStack.pop()!;
  restorePositions(world, snap);
  return true;
}

export function pillowReset(): void {
  if (!world) return;
  resetToRest(world);
  undoStack.length = 0;
  currentDrag = null;
  strokeStartSnap = null;
}

export function pillowCanUndo(): boolean { return undoStack.length > 0; }

// ---------- RAF loop ----------

let lastFrameMs = 0;
function loop(): void {
  if (!active || !ctx || !world) return;
  const now = performance.now();
  const dt = lastFrameMs ? Math.min(0.05, (now - lastFrameMs) / 1000) : 1 / 60;
  lastFrameMs = now;
  stepPillow(world, dt, {
    stiffness: params.stiffness,
    drag: currentDrag,
    docW,
    docH,
  });
  renderPillow(ctx, world);
  rafId = requestAnimationFrame(loop);
}
