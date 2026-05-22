/**
 * Tool selection and erase-mode synchronization.
 *
 * The brush, erase-all, and erase-selected tools share the brush engine -
 * they all stamp circles, just with different write rules. Switching
 * between them just updates `brushState.eraseMode` and the UI badges.
 */

import { state, brushState, lasso, type ToolName } from './state.ts';
import { toolButtons, colorSwatch, stageEl } from './dom.ts';
import { updateCursorGlyph } from './ui/cursors.ts';
import { updateSizePopover } from './ui/sizePopover.ts';
import { redrawOverlay } from './redraw.ts';

/**
 * Maps the active tool (plus Ctrl-held override) to brushState.eraseMode
 * and refreshes the visuals that depend on it.
 */
export function syncBrushEraseModeToTool(): void {
  if (state.activeTool === 'erase-all') {
    brushState.eraseMode = 'all';
  } else if (state.activeTool === 'erase-selected') {
    brushState.eraseMode = state.ctrlHeld ? 'all' : 'selected';
  } else if (state.activeTool === 'brush') {
    brushState.eraseMode = state.ctrlHeld ? 'all' : 'off';
  } else {
    brushState.eraseMode = 'off';
  }
  const erasing = brushState.eraseMode !== 'off';
  colorSwatch.classList.toggle('erase', erasing);
  stageEl.classList.toggle('erasing', erasing);
  updateCursorGlyph();
}

export function setTool(tool: ToolName): void {
  if (tool === state.activeTool) return;
  if (state.activeTool === 'lasso') lasso.cancel();
  state.activeTool = tool;
  for (const b of toolButtons) {
    b.setAttribute('aria-pressed', b.dataset.tool === tool ? 'true' : 'false');
  }
  syncBrushEraseModeToTool();
  updateSizePopover();
  redrawOverlay();
}

export function initToolManager(): void {
  for (const btn of toolButtons) {
    btn.addEventListener('click', () => setTool(btn.dataset.tool as ToolName));
  }
}
