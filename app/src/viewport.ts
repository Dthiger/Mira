/**
 * Viewport: pan, zoom, fit-to-view, and the doc<->screen coordinate math.
 *
 * State (scale, tx, ty) lives on the shared `state` object. This module
 * owns its mutation. Other modules read it as a current value.
 *
 * Listeners that depend on the transform changing (cursor glyph, brush
 * ring, lasso preview) re-render through registerOnTransformChanged.
 */

import { stageEl, stackEl, zoomReadout } from './dom.ts';
import { DOC_SIZE, MIN_SCALE, MAX_SCALE, state } from './state.ts';

const WHEEL_FACTOR = 1.1;

const onTransformChanged: Array<() => void> = [];
export function registerOnTransformChanged(cb: () => void): void {
  onTransformChanged.push(cb);
}

// Cached stage rect: refreshed on resize and scroll, read on every pointer
// event. getBoundingClientRect() forces layout, so reading it at 60 Hz
// during drags was paying a needless layout cost - the rect only changes
// when the page itself does.
let stageRect = stageEl.getBoundingClientRect();
export function refreshStageRect(): void { stageRect = stageEl.getBoundingClientRect(); }
export function getStageRect(): DOMRect { return stageRect; }

export function applyTransform(): void {
  stackEl.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  zoomReadout.textContent = `${Math.round(state.scale * 100)}%`;
  for (const cb of onTransformChanged) cb();
}

export function fitToView(): void {
  const margin = 24;
  const sx = (stageRect.width - margin * 2) / DOC_SIZE;
  const sy = (stageRect.height - margin * 2) / DOC_SIZE;
  state.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(sx, sy)));
  state.tx = (stageRect.width - DOC_SIZE * state.scale) / 2;
  state.ty = (stageRect.height - DOC_SIZE * state.scale) / 2;
  applyTransform();
}

/** Convert a pointer or wheel event to stage-local screen coords (sx, sy)
 *  and doc-space coords (dx, dy), applying the inverse viewport transform. */
export function eventToDoc(evt: PointerEvent | WheelEvent): {
  sx: number; sy: number; dx: number; dy: number;
} {
  const sx = evt.clientX - stageRect.left;
  const sy = evt.clientY - stageRect.top;
  return { sx, sy, dx: (sx - state.tx) / state.scale, dy: (sy - state.ty) / state.scale };
}

/** Convert doc-space coords back to stage-local screen coords. Inverse of
 *  the `dx`/`dy` half of eventToDoc; useful for positioning SVG overlays. */
export function docToScreen(dx: number, dy: number): { sx: number; sy: number } {
  return { sx: dx * state.scale + state.tx, sy: dy * state.scale + state.ty };
}

/** Zoom anchored at a specific screen point (sx, sy). Used by wheel zoom. */
export function setZoomAtScreenPoint(targetScale: number, sx: number, sy: number): void {
  const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, targetScale));
  const applied = next / state.scale;
  state.tx = sx - (sx - state.tx) * applied;
  state.ty = sy - (sy - state.ty) * applied;
  state.scale = next;
  applyTransform();
}

/** Zoom anchored at the viewport center. Used by the zoom-percent click. */
export function setZoomAtViewportCenter(targetScale: number): void {
  setZoomAtScreenPoint(targetScale, stageRect.width / 2, stageRect.height / 2);
}

/** Multiply scale by `factor`, anchored at the screen point under the wheel. */
export function wheelZoom(direction: 'in' | 'out', screenSx: number, screenSy: number): void {
  const f = direction === 'in' ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
  setZoomAtScreenPoint(state.scale * f, screenSx, screenSy);
}

/** Translate the canvas by a screen-pixel delta. Used by middle-mouse pan. */
export function pan(dxScreen: number, dyScreen: number): void {
  state.tx += dxScreen;
  state.ty += dyScreen;
  applyTransform();
}

window.addEventListener('resize', () => { refreshStageRect(); fitToView(); });
window.addEventListener('scroll', refreshStageRect, { passive: true });
