/**
 * Bootstrap. Wires the modules together in the right order and registers
 * the non-tool toolbar/footer actions (fit, undo/redo, help, save/load/
 * export, reference image, zoom preset).
 */

import './style.css';
import { icon, type IconName } from './icons.ts';

// Singletons + element refs - importing for their side-effecting init.
import {
  DOC_SIZE, state, doc, renderer, history, setLassoCallback,
} from './state.ts';
import {
  refImg, refInput, refOpacity, refOpacityReadout,
  exportDistBtn, saveBtn, loadBtn, loadInput,
  fitBtn, undoBtn, redoBtn,
  helpBtn, helpDialog, helpClose,
  zoomReadout,
} from './dom.ts';

import { fitToView, setZoomAtViewportCenter, registerOnTransformChanged } from './viewport.ts';
import { initColorPicker } from './ui/colorPicker.ts';
import { initSizePopover, updateSizePopover } from './ui/sizePopover.ts';
import { updateCursorGlyph } from './ui/cursors.ts';
import { redrawLassoPreview } from './ui/lassoPreview.ts';
import { refreshUsedIdsStatus, updateStatusbar } from './ui/statusBar.ts';
import { initToolManager } from './toolManager.ts';
import { initEvents, onLassoStateChange } from './events.ts';

import { computeDistanceFill, encodeDistanceFillPng } from './distfill.ts';
import { computeMaskMetadata } from './metadata.ts';
import { encodeSaveFile, loadSaveFile } from './savefile.ts';

// ---------- Init order ----------

// Inject SVG icons into anything with [data-icon].
document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
  el.innerHTML = icon(el.dataset.icon as IconName);
});

renderer.renderAll();

// The viewport's transform-changed callbacks need to refresh the cursor
// glyph (its screen-space position depends on scale/tx/ty) and the lasso
// preview (its SVG is in screen space).
registerOnTransformChanged(updateCursorGlyph);
registerOnTransformChanged(redrawLassoPreview);

// Lasso's state-change callback drives the central redraw + the
// active->inactive transition that fires refreshUsedIdsStatus.
setLassoCallback(onLassoStateChange);

initColorPicker();
initSizePopover();
initToolManager();
initEvents();

fitToView();
updateSizePopover();
refreshUsedIdsStatus();

// ---------- Misc toolbar/footer actions ----------

fitBtn.addEventListener('click', fitToView);

// Click the zoom % to cycle 50% -> 100% -> 200% -> 50%. Snaps to whichever
// preset is closest (log-distance, so the steps feel symmetric on the
// multiplicative scale axis) and then advances to the next one.
const ZOOM_PRESETS = [0.5, 1.0, 2.0];
zoomReadout.addEventListener('click', () => {
  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < ZOOM_PRESETS.length; i++) {
    const d = Math.abs(Math.log(state.scale / ZOOM_PRESETS[i]));
    if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
  }
  setZoomAtViewportCenter(ZOOM_PRESETS[(nearestIdx + 1) % ZOOM_PRESETS.length]);
});

undoBtn.addEventListener('click', () => {
  if (history.undo()) {
    renderer.renderAll();
    updateStatusbar();
    refreshUsedIdsStatus();
  }
});
redoBtn.addEventListener('click', () => {
  if (history.redo()) {
    renderer.renderAll();
    updateStatusbar();
    refreshUsedIdsStatus();
  }
});

function updateHistoryButtons(): void {
  undoBtn.disabled = !history.canUndo();
  redoBtn.disabled = !history.canRedo();
}
history.setOnChange(updateHistoryButtons);
updateHistoryButtons();

// ---------- Help dialog ----------

helpBtn.addEventListener('click', () => helpDialog.showModal());
helpClose.addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', (evt) => {
  if (evt.target === helpDialog) helpDialog.close();
});

// ---------- Reference image ----------

refImg.style.opacity = String(Number(refOpacity.value) / 100);
refOpacityReadout.textContent = `${refOpacity.value}%`;

refInput.addEventListener('change', () => {
  const file = refInput.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  refImg.onload = () => URL.revokeObjectURL(url);
  refImg.src = url;
  refImg.style.display = 'block';
});

refOpacity.addEventListener('input', () => {
  refImg.style.opacity = String(Number(refOpacity.value) / 100);
  refOpacityReadout.textContent = `${refOpacity.value}%`;
});

// ---------- Save / Load / Export ----------

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadMetadataSidecar(pngFilename: string, jsonFilename: string): void {
  const meta = computeMaskMetadata(doc, pngFilename);
  const json = JSON.stringify(meta, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), jsonFilename);
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  try {
    const blob = await encodeSaveFile(doc);
    downloadBlob(blob, `mira-state-${DOC_SIZE}x${DOC_SIZE}.png`);
  } catch (err) {
    console.error('Save failed:', err);
    window.alert(`Save failed: ${(err as Error).message}`);
  } finally {
    saveBtn.disabled = false;
  }
});

loadBtn.addEventListener('click', () => loadInput.click());
loadInput.addEventListener('change', async () => {
  const file = loadInput.files?.[0];
  loadInput.value = '';
  if (!file) return;
  try {
    history.commit();
    const result = await loadSaveFile(file, doc);
    renderer.renderAll();
    updateStatusbar();
    refreshUsedIdsStatus();
    if (result.unknownPixelCount > 0) {
      console.warn(
        `Load: ${result.unknownPixelCount} pixel(s) had unknown colors and ` +
        `were set to background. Palette mismatch?`,
      );
    }
  } catch (err) {
    console.error('Load failed:', err);
    window.alert(`Load failed: ${(err as Error).message}`);
  }
});

exportDistBtn.addEventListener('click', async () => {
  exportDistBtn.disabled = true;
  // Yield so the disabled state paints before the heavy work.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => setTimeout(r, 0));
  try {
    const t0 = performance.now();
    const result = computeDistanceFill(doc);
    const blob = encodeDistanceFillPng(result);
    const t1 = performance.now();
    console.log(`Distance fill: ${result.regionCount} regions, ${(t1 - t0).toFixed(0)} ms`);
    const pngName = `mira-distance-${DOC_SIZE}x${DOC_SIZE}.png`;
    const jsonName = `mira-distance-${DOC_SIZE}x${DOC_SIZE}.json`;
    downloadBlob(blob, pngName);
    downloadMetadataSidecar(pngName, jsonName);
  } finally {
    exportDistBtn.disabled = false;
  }
});

