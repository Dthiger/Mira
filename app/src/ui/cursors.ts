/**
 * Cursor visuals on the canvas:
 *   - `brushCursor`: SVG ring showing the brush radius (lives inside the
 *     transformed canvas-stack and uses non-scaling stroke so it stays a
 *     fixed screen-pixel thickness at any zoom)
 *   - `cursorGlyph`: a software-drawn `+` / `−` glyph that stands in for
 *     the OS cursor over the canvas (the OS cursor often vanishes during
 *     fast drags, this one doesn't)
 */

import {
  brushCursorSvg, brushCursorOuter, brushCursorInner, cursorGlyph,
} from '../dom.ts';
import {
  DOC_SIZE, state, brushState, isBrushShaped,
} from '../state.ts';

export function updateBrushCursor(): void {
  if (!isBrushShaped(state.activeTool) || state.cursorX < 0) {
    brushCursorSvg.classList.remove('active');
    return;
  }
  brushCursorSvg.classList.add('active');
  const r = brushState.size / 2;
  const cx = String(state.cursorX);
  const cy = String(state.cursorY);
  const rs = String(r);
  brushCursorOuter.setAttribute('cx', cx);
  brushCursorOuter.setAttribute('cy', cy);
  brushCursorOuter.setAttribute('r', rs);
  brushCursorInner.setAttribute('cx', cx);
  brushCursorInner.setAttribute('cy', cy);
  brushCursorInner.setAttribute('r', rs);
}

export function updateCursorGlyph(): void {
  if (
    state.cursorX < 0 || state.cursorY < 0 ||
    state.cursorX >= DOC_SIZE || state.cursorY >= DOC_SIZE
  ) {
    cursorGlyph.classList.remove('active');
    return;
  }
  if (state.dragMode === 'pan' || state.dragMode === 'size') {
    cursorGlyph.classList.remove('active');
    return;
  }
  cursorGlyph.classList.add('active');
  // brushState.eraseMode is the single source of truth: it's set by the
  // tool manager based on activeTool + ctrlHeld so this read covers the
  // erase tools and the Ctrl+brush case.
  const erasing = brushState.eraseMode !== 'off';
  cursorGlyph.textContent = erasing ? '−' : '+';
  // Doc -> stage-local screen coords (mirrors the canvas-stack transform).
  const sx = state.cursorX * state.scale + state.tx;
  const sy = state.cursorY * state.scale + state.ty;
  cursorGlyph.style.left = `${sx}px`;
  cursorGlyph.style.top = `${sy}px`;
}
