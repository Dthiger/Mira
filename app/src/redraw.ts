/**
 * Centralized overlay redraw - fires the per-frame visual updates that
 * depend on cursor position, active tool, or tool state. Called by
 * pointermove and by tool/state transitions.
 *
 * Each individual update is also exported standalone (from its own
 * module) so callers that only need one can avoid the rest.
 */

import { overlayCtx, DOC_SIZE } from './state.ts';
import { redrawLassoPreview } from './ui/lassoPreview.ts';
import { updateBrushCursor, updateCursorGlyph } from './ui/cursors.ts';
import { updateStatusbar } from './ui/statusBar.ts';

export function redrawOverlay(): void {
  // The doc-sized overlay canvas isn't used after the lasso preview moved
  // to a screen-space SVG, but we clear it in case future doc-space
  // overlays land here.
  overlayCtx.clearRect(0, 0, DOC_SIZE, DOC_SIZE);
  redrawLassoPreview();
  updateBrushCursor();
  updateCursorGlyph();
  updateStatusbar();
}
