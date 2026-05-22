/**
 * Floating brush-size popover. Visible only when a brush-shaped tool is
 * active, positioned in viewport coords directly under the active tool
 * button. Repositions on tool switch and window resize.
 */

import { sizePopover, sizeSlider, sizeReadout, toolButtons } from '../dom.ts';
import { state, brushState, isBrushShaped } from '../state.ts';
import { updateBrushCursor } from './cursors.ts';

export function updateSizePopover(): void {
  if (!isBrushShaped(state.activeTool)) {
    sizePopover.hidden = true;
    return;
  }
  const activeBtn = toolButtons.find((b) => b.dataset.tool === state.activeTool);
  if (!activeBtn) {
    sizePopover.hidden = true;
    return;
  }
  sizePopover.hidden = false;
  const r = activeBtn.getBoundingClientRect();
  sizePopover.style.left = `${r.left}px`;
  sizePopover.style.top = `${r.bottom + 6}px`;
}

export function setBrushSize(n: number): void {
  brushState.size = Math.max(1, Math.min(200, Math.round(n)));
  sizeSlider.value = String(brushState.size);
  sizeReadout.textContent = String(brushState.size);
  // Only the brush ring depends on size; the cursor glyph, lasso preview,
  // and status bar are unaffected, so the full overlay redraw isn't needed.
  updateBrushCursor();
}

export function initSizePopover(): void {
  sizeSlider.addEventListener('input', () => setBrushSize(Number(sizeSlider.value)));
  window.addEventListener('resize', updateSizePopover);
}
