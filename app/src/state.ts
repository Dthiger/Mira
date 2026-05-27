/**
 * Shared mutable app state and singleton instances.
 *
 * Everything that lives here is either:
 *   - An app-wide constant (DOC_SIZE, ToolName union, etc.)
 *   - A singleton instance created once at app start (doc, renderer, tools)
 *   - A mutable field on the `state` object that other modules read/write
 *
 * Reading is via direct property access (`state.scale`, etc.); writing is
 * via direct assignment from whichever module owns that piece of state. The
 * owner conventions are documented inline.
 */

import { MaskDocument } from './document.ts';
import { PaintRenderer } from './renderer.ts';
import { History } from './history.ts';
import { BrushTool, type BrushState } from './tools/brush.ts';
import { LassoTool, type LassoState } from './tools/lasso.ts';
import { BucketTool, type BucketState } from './tools/bucket.ts';
import { paintCanvas, stackEl, overlayCanvas, brushCursorSvg } from './dom.ts';

export const DOC_SIZE = 1024;
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 64;

export type ToolName = 'brush' | 'lasso' | 'bucket' | 'erase-all' | 'erase-selected';
export type DragMode = null | 'paint' | 'lasso' | 'pan' | 'size';

/** App-level mode. Paint = normal mask editing; pillow/swirl are sim modes
 *  that hide the paint toolbar and present their own controls. */
export type AppMode = 'paint' | 'pillow' | 'swirl' | 'flow';

/** Tools that share the brush engine - and therefore the brush size, the
 *  brush-radius preview, and the floating size popover. */
export const BRUSH_SHAPED_TOOLS: readonly ToolName[] = ['brush', 'erase-all', 'erase-selected'];
export const isBrushShaped = (t: ToolName): boolean => BRUSH_SHAPED_TOOLS.includes(t);

// ---------- Canvas dimensions ----------
stackEl.style.width = `${DOC_SIZE}px`;
stackEl.style.height = `${DOC_SIZE}px`;
overlayCanvas.width = DOC_SIZE;
overlayCanvas.height = DOC_SIZE;
brushCursorSvg.setAttribute('viewBox', `0 0 ${DOC_SIZE} ${DOC_SIZE}`);

// ---------- Singletons ----------
export const doc = new MaskDocument(DOC_SIZE, DOC_SIZE);
export const renderer = new PaintRenderer(paintCanvas, doc);

export const overlayCtx = overlayCanvas.getContext('2d')!;
overlayCtx.imageSmoothingEnabled = false;

export const history = new History(doc);

export const brushState: BrushState = { colorIndex: 0, size: 16, eraseMode: 'off' };
export const lassoState: LassoState = { colorIndex: 0 };
export const bucketState: BucketState = { colorIndex: 0 };

// The lasso instance needs an onStateChange callback that triggers the
// app-wide redraw - that callback is set later by main.ts via setLassoCallback.
let lassoOnStateChange: () => void = () => {};
export function setLassoCallback(cb: () => void): void { lassoOnStateChange = cb; }

export const brush = new BrushTool(doc, renderer, brushState);
export const lasso = new LassoTool(doc, renderer, lassoState, () => lassoOnStateChange());
export const bucket = new BucketTool(doc, renderer, bucketState);

// ---------- Mutable state object ----------
// Reads happen anywhere; writes are tagged with the owning module in the
// comments below.
export const state = {
  /** Owned by viewport.ts */
  scale: 1,
  /** Owned by viewport.ts */
  tx: 0,
  /** Owned by viewport.ts */
  ty: 0,

  /** Active tool. Owned by toolManager.ts. */
  activeTool: 'brush' as ToolName,

  /** App mode. Owned by simManager.ts. */
  mode: 'paint' as AppMode,

  /** Last cursor doc-coords (or -1, -1 if off canvas). Owned by events.ts. */
  cursorX: -1,
  /** Last cursor doc-coords. Owned by events.ts. */
  cursorY: -1,

  /** Active pointer drag mode. Owned by events.ts. */
  dragMode: null as DragMode,

  /** Ctrl-held override. Owned by events.ts (keydown/keyup). */
  ctrlHeld: false,

  /** Last-seen state-change flag for the lasso, used to fire one-shot
   *  refreshes when the lasso transitions active -> inactive. */
  lassoWasActive: false,
};
