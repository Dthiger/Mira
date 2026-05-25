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
  buildDragAnchors, type DragInput,
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

let currentDrag: DragInput | null = null;
let strokeStartSnap: Float64Array | null = null;
const undoStack: Float64Array[] = [];

// TEMP DEBUG: counters/log surface exposed on window for in-browser inspection.
interface PillowDebug {
  enterCount: number;
  dragBeginCount: number;
  dragMoveCount: number;
  dragEndCount: number;
  rafTicks: number;
  appliedFrames: number;
  lastAnchorCount: number;
  bodyCount: number;
  vertCount: number;
  firstVertSample: { rx: number; px: number } | null;
}
const dbg: PillowDebug = {
  enterCount: 0, dragBeginCount: 0, dragMoveCount: 0, dragEndCount: 0,
  rafTicks: 0, appliedFrames: 0, lastAnchorCount: 0,
  bodyCount: 0, vertCount: 0, firstVertSample: null,
};
(window as unknown as { __pillowDebug: PillowDebug }).__pillowDebug = dbg;

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
  dbg.enterCount++;
  dbg.bodyCount = world.bodies.length;
  let total = 0;
  for (const b of world.bodies) total += b.vertices.length;
  dbg.vertCount = total;
  if (world.bodies.length > 0 && world.bodies[0].vertices.length > 0) {
    const v0 = world.bodies[0].vertices[0];
    dbg.firstVertSample = { rx: v0.rx, px: v0.px };
  }
  console.log('[pillow] enter:', { bodies: dbg.bodyCount, verts: dbg.vertCount });
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
  dbg.dragBeginCount++;
  if (!world) {
    console.warn('[pillow] dragBegin called but world is null');
    return;
  }
  strokeStartSnap = snapshotPositions(world);
  const anchors = buildDragAnchors(world, docX, docY, params.dragRadius, params.dragStrength);
  currentDrag = { cursorX: docX, cursorY: docY, anchors };
  dbg.lastAnchorCount = anchors.length;
  console.log('[pillow] dragBegin:', { docX, docY, radius: params.dragRadius, strength: params.dragStrength, anchors: anchors.length });
}

export function dragMove(docX: number, docY: number): void {
  dbg.dragMoveCount++;
  if (!currentDrag) return;
  currentDrag.cursorX = docX;
  currentDrag.cursorY = docY;
  if (dbg.dragMoveCount <= 3) {
    console.log('[pillow] dragMove:', { docX, docY });
  }
}

export function dragEnd(): void {
  dbg.dragEndCount++;
  if (!currentDrag || !strokeStartSnap) return;
  // Push the BEFORE snapshot so undo restores the pre-stroke state.
  undoStack.push(strokeStartSnap);
  currentDrag = null;
  strokeStartSnap = null;
  if (world && world.bodies.length > 0 && world.bodies[0].vertices.length > 0) {
    const v0 = world.bodies[0].vertices[0];
    console.log('[pillow] dragEnd; first vert now px=', v0.px.toFixed(2), 'rx=', v0.rx.toFixed(2));
  }
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
  dbg.rafTicks++;
  const dragWasActive = currentDrag !== null;
  const v0Before = world.bodies[0]?.vertices[0]?.px ?? 0;
  stepPillow(world, dt, {
    stiffness: params.stiffness,
    drag: currentDrag,
    docW,
    docH,
  });
  const v0After = world.bodies[0]?.vertices[0]?.px ?? 0;
  if (dragWasActive && Math.abs(v0After - v0Before) > 0.01) dbg.appliedFrames++;
  renderPillow(ctx, world);
  rafId = requestAnimationFrame(loop);
}
