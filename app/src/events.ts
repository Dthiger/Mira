/**
 * Pointer, keyboard, and wheel routing.
 *
 * The stage handles all canvas-area pointer events. Left button drives the
 * active tool; middle button pans (or sizes with Alt); right button sizes.
 * Wheel zooms; Shift+wheel cycles palette. Keyboard maps tools, undo/redo,
 * lasso commands, fit-to-view, and help.
 */

import { stageEl, helpDialog } from './dom.ts';
import {
  state, renderer, history, brush, lasso, bucket, brushState, isBrushShaped,
} from './state.ts';
import { eventToDoc, fitToView, wheelZoom, pan } from './viewport.ts';
import { setTool, syncBrushEraseModeToTool } from './toolManager.ts';
import { setBrushSize } from './ui/sizePopover.ts';
import { cyclePaletteColor } from './ui/colorPicker.ts';
import { updateStatusbar, refreshUsedIdsStatus } from './ui/statusBar.ts';
import { redrawOverlay } from './redraw.ts';

let lastClientX = 0;
let lastClientY = 0;
let sizeAtDragStart = 0;

let lastColorCycleAt = 0;
const COLOR_CYCLE_THROTTLE_MS = 60;

/** Lasso onStateChange callback. Wires the transition active -> inactive
 *  to refreshUsedIdsStatus and the always-fires redraw. */
export function onLassoStateChange(): void {
  const lassoActive = lasso.isActive();
  if (state.lassoWasActive && !lassoActive) refreshUsedIdsStatus();
  state.lassoWasActive = lassoActive;
  redrawOverlay();
}

export function initEvents(): void {
  stageEl.addEventListener('pointerdown', (evt) => {
    if (evt.button === 1 || evt.button === 2) evt.preventDefault();

    // Middle button: pan, or Alt+MMB = brush-size drag.
    if (evt.button === 1) {
      stageEl.setPointerCapture(evt.pointerId);
      if (evt.altKey) {
        state.dragMode = 'size';
        sizeAtDragStart = brushState.size;
        lastClientX = evt.clientX;
        stageEl.classList.add('sizing');
      } else {
        state.dragMode = 'pan';
        lastClientX = evt.clientX;
        lastClientY = evt.clientY;
        stageEl.classList.add('panning');
      }
      return;
    }

    // Right button: brush-size drag (no modifier needed).
    if (evt.button === 2) {
      stageEl.setPointerCapture(evt.pointerId);
      state.dragMode = 'size';
      sizeAtDragStart = brushState.size;
      lastClientX = evt.clientX;
      stageEl.classList.add('sizing');
      return;
    }

    if (evt.button === 0) {
      const { dx, dy } = eventToDoc(evt);
      stageEl.setPointerCapture(evt.pointerId);
      if (isBrushShaped(state.activeTool)) {
        history.commit();
        state.dragMode = 'paint';
        stageEl.classList.add('painting');
        brush.begin(dx, dy);
      } else if (state.activeTool === 'bucket') {
        history.commit();
        bucket.apply(dx, dy);
        updateStatusbar();
        refreshUsedIdsStatus();
      } else {
        const wasEmpty = !lasso.isActive();
        if (wasEmpty) history.commit();
        state.dragMode = 'lasso';
        lasso.pointerDown(dx, dy);
      }
    }
  });

  stageEl.addEventListener('pointermove', (evt) => {
    if (state.dragMode === 'pan') {
      pan(evt.clientX - lastClientX, evt.clientY - lastClientY);
      lastClientX = evt.clientX;
      lastClientY = evt.clientY;
      return;
    }
    if (state.dragMode === 'size') {
      setBrushSize(sizeAtDragStart + (evt.clientX - lastClientX));
      return;
    }
    const { dx, dy } = eventToDoc(evt);
    state.cursorX = dx;
    state.cursorY = dy;
    if (state.dragMode === 'paint') brush.move(dx, dy);
    else if (state.dragMode === 'lasso') lasso.pointerMove(dx, dy);
    redrawOverlay();
  });

  stageEl.addEventListener('pointerup', (evt) => {
    if (stageEl.hasPointerCapture(evt.pointerId)) {
      stageEl.releasePointerCapture(evt.pointerId);
    }
    if (state.dragMode === 'paint') { brush.end(); refreshUsedIdsStatus(); }
    else if (state.dragMode === 'lasso') lasso.pointerUp();
    stageEl.classList.remove('panning', 'sizing', 'painting');
    state.dragMode = null;
  });

  stageEl.addEventListener('contextmenu', (evt) => evt.preventDefault());

  stageEl.addEventListener('dblclick', () => {
    if (state.activeTool === 'lasso') lasso.doubleClick();
  });

  stageEl.addEventListener('wheel', (evt) => {
    evt.preventDefault();
    if (evt.shiftKey) {
      const now = performance.now();
      if (now - lastColorCycleAt < COLOR_CYCLE_THROTTLE_MS) return;
      lastColorCycleAt = now;
      cyclePaletteColor(evt.deltaY > 0 ? 1 : -1);
      return;
    }
    const { sx, sy } = eventToDoc(evt);
    wheelZoom(evt.deltaY < 0 ? 'in' : 'out', sx, sy);
  }, { passive: false });

  window.addEventListener('keydown', (evt) => {
    const meta = evt.ctrlKey || evt.metaKey;

    if (evt.key === 'Control' && !state.ctrlHeld) {
      state.ctrlHeld = true;
      syncBrushEraseModeToTool();
    }

    if (meta && evt.key.toLowerCase() === 'z') {
      evt.preventDefault();
      if (evt.shiftKey) {
        if (history.redo()) { renderer.renderAll(); updateStatusbar(); refreshUsedIdsStatus(); }
      } else {
        if (history.undo()) { renderer.renderAll(); updateStatusbar(); refreshUsedIdsStatus(); }
      }
      return;
    }
    if (meta && evt.key.toLowerCase() === 'y') {
      evt.preventDefault();
      if (history.redo()) { renderer.renderAll(); updateStatusbar(); refreshUsedIdsStatus(); }
      return;
    }

    if (evt.key === 'Escape' && state.activeTool === 'lasso') { lasso.cancel(); return; }
    if (evt.key === 'Enter' && state.activeTool === 'lasso') { lasso.doubleClick(); return; }
    if (meta) return;

    const k = evt.key.length === 1 ? evt.key.toLowerCase() : evt.key;
    if (k === 'b') setTool('brush');
    else if (k === 'l') setTool('lasso');
    else if (k === 'g') setTool('bucket');
    else if (k === 'e') {
      if (evt.shiftKey) {
        setTool(state.activeTool === 'erase-selected' ? 'brush' : 'erase-selected');
      } else {
        setTool(state.activeTool === 'erase-all' ? 'brush' : 'erase-all');
      }
    }
    else if (k === 'f') fitToView();
    else if (k === '?') {
      evt.preventDefault();
      if (helpDialog.open) helpDialog.close(); else helpDialog.showModal();
    }
  });

  window.addEventListener('keyup', (evt) => {
    if (evt.key === 'Control' && state.ctrlHeld) {
      state.ctrlHeld = false;
      syncBrushEraseModeToTool();
    }
  });

  // If the window loses focus while Ctrl is held, reset so we don't get
  // stuck in erase mode.
  window.addEventListener('blur', () => {
    if (state.ctrlHeld) {
      state.ctrlHeld = false;
      syncBrushEraseModeToTool();
    }
  });
}
