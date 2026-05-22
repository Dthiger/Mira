import './style.css';
import { PALETTE, PALETTE_BY_INDEX, BACKGROUND_INDEX, paletteHex } from './palette.ts';
import { MaskDocument } from './document.ts';
import { PaintRenderer } from './renderer.ts';
import { BrushTool, type BrushState } from './tools/brush.ts';
import { LassoTool, type LassoState } from './tools/lasso.ts';
import { BucketTool, type BucketState } from './tools/bucket.ts';
import { History } from './history.ts';
import { icon, type IconName } from './icons.ts';
import { computeDistanceFill, encodeDistanceFillPng } from './distfill.ts';
import { computeMaskMetadata } from './metadata.ts';
import { encodeSaveFile, loadSaveFile } from './savefile.ts';

const DOC_SIZE = 1024;
const MIN_SCALE = 0.05;
const MAX_SCALE = 64;
const WHEEL_FACTOR = 1.1;

type ToolName = 'brush' | 'lasso' | 'bucket' | 'erase-all' | 'erase-selected';

const $ = <T extends Element>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

const stageEl = $<HTMLElement>('#stage');
const stackEl = $<HTMLDivElement>('#canvas-stack');
const paintCanvas = $<HTMLCanvasElement>('#paint-canvas');
const overlayCanvas = $<HTMLCanvasElement>('#overlay-canvas');
const refImg = $<HTMLImageElement>('#ref-img');
const colorPicker = $<HTMLDivElement>('#color-picker');
const colorTrigger = $<HTMLButtonElement>('#color-trigger');
const colorMenu = $<HTMLDivElement>('#color-menu');
const colorTriggerLabel = $<HTMLSpanElement>('#color-trigger-label');
const colorSwatch = $<HTMLSpanElement>('#color-swatch');
const sizeSlider = $<HTMLInputElement>('#size-slider');
const sizeReadout = $<HTMLSpanElement>('#size-readout');
const sizePopover = $<HTMLDivElement>('#size-popover');
const refInput = $<HTMLInputElement>('#ref-input');
const refOpacity = $<HTMLInputElement>('#ref-opacity');
const refOpacityReadout = $<HTMLSpanElement>('#ref-opacity-readout');
const exportDistBtn = $<HTMLButtonElement>('#export-dist-btn');
const saveBtn = $<HTMLButtonElement>('#save-btn');
const loadBtn = $<HTMLButtonElement>('#load-btn');
const loadInput = $<HTMLInputElement>('#load-input');
const fitBtn = $<HTMLButtonElement>('#fit-btn');
const undoBtn = $<HTMLButtonElement>('#undo-btn');
const redoBtn = $<HTMLButtonElement>('#redo-btn');
const helpBtn = $<HTMLButtonElement>('#help-btn');
const helpDialog = $<HTMLDialogElement>('#help-dialog');
const helpClose = $<HTMLButtonElement>('#help-close');
const zoomReadout = $<HTMLSpanElement>('#zoom-readout');
const brushCursorSvg = $<SVGSVGElement>('#brush-cursor');
const brushCursorOuter = $<SVGCircleElement>('#brush-cursor-outer');
const brushCursorInner = $<SVGCircleElement>('#brush-cursor-inner');
const cursorGlyph = $<HTMLDivElement>('#cursor-glyph');
const lassoSvg = $<SVGSVGElement>('#lasso-preview');
const lassoPath = $<SVGPathElement>('#lasso-path');
const lassoPathHalo = $<SVGPathElement>('#lasso-path-halo');
const lassoHandles = $<SVGGElement>('#lasso-handles');
const lassoCloseIndicator = $<SVGCircleElement>('#lasso-close');
const statusPos = $<HTMLSpanElement>('#status-pos');
const statusId = $<HTMLSpanElement>('#status-id');
const statusSwatch = $<HTMLSpanElement>('#status-swatch');
const statusUsedCount = $<HTMLSpanElement>('#status-used-count');
const statusUsedPopup = $<HTMLDivElement>('#status-used-popup');
const SVG_NS = 'http://www.w3.org/2000/svg';

// Inject SVG icons into anything with [data-icon].
document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
  const name = el.dataset.icon as IconName;
  el.innerHTML = icon(name);
});

stackEl.style.width = `${DOC_SIZE}px`;
stackEl.style.height = `${DOC_SIZE}px`;
overlayCanvas.width = DOC_SIZE;
overlayCanvas.height = DOC_SIZE;
brushCursorSvg.setAttribute('viewBox', `0 0 ${DOC_SIZE} ${DOC_SIZE}`);

const doc = new MaskDocument(DOC_SIZE, DOC_SIZE);
const renderer = new PaintRenderer(paintCanvas, doc);
renderer.renderAll();

const overlayCtx = overlayCanvas.getContext('2d')!;
overlayCtx.imageSmoothingEnabled = false;

const history = new History(doc);
history.setOnChange(updateHistoryButtons);

// The brush instance is shared by the brush, erase-all, and erase-selected
// tools - they all stamp circles. The state's eraseMode is set by
// syncBrushEraseModeToTool() based on which of those is active.
const brushState: BrushState = { colorIndex: 0, size: 16, eraseMode: 'off' };
const lassoState: LassoState = { colorIndex: 0 };
const bucketState: BucketState = { colorIndex: 0 };
const brush = new BrushTool(doc, renderer, brushState);
const lasso = new LassoTool(doc, renderer, lassoState, () => redrawOverlay());
const bucket = new BucketTool(doc, renderer, bucketState);
let activeTool: ToolName = 'brush';

// ---------- Viewport (CSS transform) ----------

let scale = 1;
let tx = 0;
let ty = 0;
// Declared up here (rather than next to redrawOverlay) so the very first
// applyTransform() -> updateCursorGlyph() call during init doesn't TDZ.
let cursorX = -1;
let cursorY = -1;

function applyTransform(): void {
  stackEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  zoomReadout.textContent = `${Math.round(scale * 100)}%`;
  updateCursorGlyph();
  redrawLassoPreview();
}

function fitToView(): void {
  const rect = stageEl.getBoundingClientRect();
  const margin = 24;
  const sx = (rect.width - margin * 2) / DOC_SIZE;
  const sy = (rect.height - margin * 2) / DOC_SIZE;
  scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(sx, sy)));
  tx = (rect.width - DOC_SIZE * scale) / 2;
  ty = (rect.height - DOC_SIZE * scale) / 2;
  applyTransform();
}

function eventToDoc(evt: PointerEvent | WheelEvent): { sx: number; sy: number; dx: number; dy: number } {
  const rect = stageEl.getBoundingClientRect();
  const sx = evt.clientX - rect.left;
  const sy = evt.clientY - rect.top;
  return { sx, sy, dx: (sx - tx) / scale, dy: (sy - ty) / scale };
}

fitToView();
window.addEventListener('resize', fitToView);

// ---------- Color picker (custom dropdown) ----------

for (const entry of PALETTE) {
  const opt = document.createElement('button');
  opt.type = 'button';
  opt.className = 'color-picker-option';
  opt.setAttribute('role', 'option');
  opt.dataset.index = String(entry.index);
  opt.innerHTML = `
    <span class="swatch" style="background:${paletteHex(entry)}"></span>
    <span class="color-picker-option-number">${entry.label}</span>
    <span class="color-picker-option-name">${entry.name}</span>
  `;
  opt.addEventListener('click', () => {
    updateColor(entry.index);
    closeColorMenu();
  });
  colorMenu.appendChild(opt);
}

colorTrigger.addEventListener('click', (evt) => {
  evt.stopPropagation();
  if (colorMenu.hidden) {
    refreshUsedIndicesInMenu();
    openColorMenu();
  } else {
    closeColorMenu();
  }
});

/**
 * One pass over the pixel buffer to find which palette indices the document
 * currently contains, then mark those options in the dropdown with `.used`
 * for the 50% teal highlight. ~5 ms at 1024² - cheap enough to do on every
 * dropdown open.
 */
function refreshUsedIndicesInMenu(): void {
  const seen = new Uint8Array(256);
  const px = doc.pixels;
  for (let i = 0; i < px.length; i++) seen[px[i]] = 1;
  colorMenu.querySelectorAll<HTMLElement>('.color-picker-option').forEach((opt) => {
    const idx = Number(opt.dataset.index);
    opt.classList.toggle('used', seen[idx] === 1);
  });
}

document.addEventListener('click', (evt) => {
  if (!colorMenu.hidden && !colorPicker.contains(evt.target as Node)) {
    closeColorMenu();
  }
});

function openColorMenu(): void {
  colorMenu.hidden = false;
  colorTrigger.setAttribute('aria-expanded', 'true');
}
function closeColorMenu(): void {
  colorMenu.hidden = true;
  colorTrigger.setAttribute('aria-expanded', 'false');
}

updateColor(0);

function updateColor(index: number): void {
  brushState.colorIndex = index;
  lassoState.colorIndex = index;
  bucketState.colorIndex = index;
  // Look up by internal index, NOT array position - PALETTE is sorted by label.
  const entry = PALETTE_BY_INDEX.get(index);
  if (!entry) return;
  colorSwatch.style.background = paletteHex(entry);
  colorTriggerLabel.textContent = `${entry.label} - ${entry.name}`;
  colorMenu.querySelectorAll<HTMLElement>('.color-picker-option').forEach((opt) => {
    opt.setAttribute('aria-selected', Number(opt.dataset.index) === index ? 'true' : 'false');
  });
}

// ---------- Brush size slider ----------

sizeSlider.addEventListener('input', () => setBrushSize(Number(sizeSlider.value)));

function setBrushSize(n: number): void {
  brushState.size = Math.max(1, Math.min(200, Math.round(n)));
  sizeSlider.value = String(brushState.size);
  sizeReadout.textContent = String(brushState.size);
  redrawOverlay();
}

// ---------- Tool selection ----------

document.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool as ToolName));
});

function setTool(tool: ToolName): void {
  if (tool === activeTool) return;
  if (activeTool === 'lasso') lasso.cancel();
  activeTool = tool;
  document.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.tool === tool ? 'true' : 'false');
  });
  syncBrushEraseModeToTool();
  updateSizePopover();
  redrawOverlay();
}

// Brush size popover floats under the active brush/eraser button. Hidden
// for lasso/bucket where size is meaningless. Positioned in viewport coords
// from the active button's bounding rect so wraps/resizes track correctly.
const SIZE_TOOLS: readonly ToolName[] = ['brush', 'erase-all', 'erase-selected'];

function updateSizePopover(): void {
  if (!SIZE_TOOLS.includes(activeTool)) {
    sizePopover.hidden = true;
    return;
  }
  const activeBtn = document.querySelector<HTMLButtonElement>(
    `.tool-btn[data-tool="${activeTool}"]`,
  );
  if (!activeBtn) {
    sizePopover.hidden = true;
    return;
  }
  // Make it visible before measuring so our own getBoundingClientRect on
  // sizePopover (used later) doesn't return 0 widths.
  sizePopover.hidden = false;
  const r = activeBtn.getBoundingClientRect();
  sizePopover.style.left = `${r.left}px`;
  sizePopover.style.top = `${r.bottom + 6}px`;
}

window.addEventListener('resize', updateSizePopover);
updateSizePopover();
refreshUsedIdsStatus();

// ---------- Fit / Undo / Redo buttons ----------

fitBtn.addEventListener('click', fitToView);

// Click the zoom readout to cycle through preset zoom levels.
// Snaps to whichever preset is closest (log-distance, so the steps feel
// symmetric on the multiplicative scale axis) and then advances to the
// next one in the cycle.
const ZOOM_PRESETS = [0.5, 1.0, 2.0];
zoomReadout.addEventListener('click', () => {
  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < ZOOM_PRESETS.length; i++) {
    const d = Math.abs(Math.log(scale / ZOOM_PRESETS[i]));
    if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
  }
  setZoomAtViewportCenter(ZOOM_PRESETS[(nearestIdx + 1) % ZOOM_PRESETS.length]);
});

function setZoomAtViewportCenter(targetScale: number): void {
  const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, targetScale));
  const rect = stageEl.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const applied = next / scale;
  tx = cx - (cx - tx) * applied;
  ty = cy - (cy - ty) * applied;
  scale = next;
  applyTransform();
}
undoBtn.addEventListener('click', () => { if (history.undo()) { renderer.renderAll(); updateStatusbar(); refreshUsedIdsStatus(); } });
redoBtn.addEventListener('click', () => { if (history.redo()) { renderer.renderAll(); updateStatusbar(); refreshUsedIdsStatus(); } });

helpBtn.addEventListener('click', () => helpDialog.showModal());
helpClose.addEventListener('click', () => helpDialog.close());
// Click outside the inner card closes the dialog (backdrop click).
helpDialog.addEventListener('click', (evt) => {
  if (evt.target === helpDialog) helpDialog.close();
});

let ctrlHeld = false;

/**
 * The brush instance is shared by the brush, erase-all, and erase-selected
 * tools. This function maps the active tool (plus Ctrl-held override) to
 * brushState.eraseMode, then refreshes the visuals that depend on it.
 */
function syncBrushEraseModeToTool(): void {
  if (activeTool === 'erase-all') {
    brushState.eraseMode = 'all';
  } else if (activeTool === 'erase-selected') {
    brushState.eraseMode = ctrlHeld ? 'all' : 'selected';
  } else if (activeTool === 'brush') {
    brushState.eraseMode = ctrlHeld ? 'all' : 'off';
  } else {
    brushState.eraseMode = 'off';
  }
  const erasing = brushState.eraseMode !== 'off';
  colorSwatch.classList.toggle('erase', erasing);
  stageEl.classList.toggle('erasing', erasing);
  updateCursorGlyph();
}

function updateHistoryButtons(): void {
  undoBtn.disabled = !history.canUndo();
  redoBtn.disabled = !history.canRedo();
}
updateHistoryButtons();

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

// ---------- Export ----------

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
  // Reset the input so picking the same file twice re-fires `change`.
  loadInput.value = '';
  if (!file) return;
  try {
    // Snapshot first so Ctrl+Z undoes the load.
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
  // Yield once so the disabled state actually paints before the heavy work.
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

// ---------- Pointer routing ----------

type DragMode = null | 'paint' | 'lasso' | 'pan' | 'size';

let dragMode: DragMode = null;
let lastClientX = 0;
let lastClientY = 0;
let sizeAtDragStart = 0;

stageEl.addEventListener('pointerdown', (evt) => {
  // Block default scroll/select on every relevant button down.
  if (evt.button === 1 || evt.button === 2) evt.preventDefault();

  // Middle button: pan, or Alt+MMB = brush-size drag.
  if (evt.button === 1) {
    stageEl.setPointerCapture(evt.pointerId);
    if (evt.altKey) {
      dragMode = 'size';
      sizeAtDragStart = brushState.size;
      lastClientX = evt.clientX;
      stageEl.classList.add('sizing');
    } else {
      dragMode = 'pan';
      lastClientX = evt.clientX;
      lastClientY = evt.clientY;
      stageEl.classList.add('panning');
    }
    return;
  }

  // Right button: brush-size drag (same gesture as Alt+MMB, no modifier needed).
  if (evt.button === 2) {
    stageEl.setPointerCapture(evt.pointerId);
    dragMode = 'size';
    sizeAtDragStart = brushState.size;
    lastClientX = evt.clientX;
    stageEl.classList.add('sizing');
    return;
  }

  // Left button: tool action.
  if (evt.button === 0) {
    const { dx, dy } = eventToDoc(evt);
    stageEl.setPointerCapture(evt.pointerId);
    if (activeTool === 'brush' || activeTool === 'erase-all' || activeTool === 'erase-selected') {
      history.commit();
      dragMode = 'paint';
      stageEl.classList.add('painting');
      brush.begin(dx, dy);
    } else if (activeTool === 'bucket') {
      history.commit();
      bucket.apply(dx, dy);
      updateStatusbar();
      refreshUsedIdsStatus();
      // No drag follows; capture will release on pointerup.
    } else {
      // Lasso: capture pre-shape snapshot only on the first click of a new shape.
      const wasEmpty = !lasso.isActive();
      if (wasEmpty) history.commit();
      dragMode = 'lasso';
      lasso.pointerDown(dx, dy);
    }
  }
});

stageEl.addEventListener('pointermove', (evt) => {
  if (dragMode === 'pan') {
    tx += evt.clientX - lastClientX;
    ty += evt.clientY - lastClientY;
    lastClientX = evt.clientX;
    lastClientY = evt.clientY;
    applyTransform();
    return;
  }
  if (dragMode === 'size') {
    const next = sizeAtDragStart + (evt.clientX - lastClientX);
    setBrushSize(next);
    return;
  }

  const { dx, dy } = eventToDoc(evt);
  if (dragMode === 'paint') brush.move(dx, dy);
  else if (dragMode === 'lasso') lasso.pointerMove(dx, dy);
  redrawOverlay(dx, dy);
});

stageEl.addEventListener('pointerup', (evt) => {
  if (stageEl.hasPointerCapture(evt.pointerId)) {
    stageEl.releasePointerCapture(evt.pointerId);
  }
  if (dragMode === 'paint') { brush.end(); refreshUsedIdsStatus(); }
  else if (dragMode === 'lasso') lasso.pointerUp();
  stageEl.classList.remove('panning', 'sizing', 'painting');
  dragMode = null;
});

stageEl.addEventListener('contextmenu', (evt) => evt.preventDefault());

stageEl.addEventListener('dblclick', () => {
  if (activeTool === 'lasso') lasso.doubleClick();
});

let lastColorCycleAt = 0;
const COLOR_CYCLE_THROTTLE_MS = 60;

stageEl.addEventListener('wheel', (evt) => {
  evt.preventDefault();

  // Shift + wheel cycles through palette colors (in label order). Throttled
  // by wall time so trackpad scroll-events don't whip through the palette.
  if (evt.shiftKey) {
    const now = performance.now();
    if (now - lastColorCycleAt < COLOR_CYCLE_THROTTLE_MS) return;
    lastColorCycleAt = now;
    cyclePaletteColor(evt.deltaY > 0 ? 1 : -1);
    return;
  }

  const { sx, sy } = eventToDoc(evt);
  const factor = evt.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
  const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
  const applied = next / scale;
  tx = sx - (sx - tx) * applied;
  ty = sy - (sy - ty) * applied;
  scale = next;
  applyTransform();
}, { passive: false });

function cyclePaletteColor(delta: number): void {
  let pos = -1;
  for (let i = 0; i < PALETTE.length; i++) {
    if (PALETTE[i].index === brushState.colorIndex) { pos = i; break; }
  }
  if (pos < 0) pos = 0;
  const next = (pos + delta + PALETTE.length) % PALETTE.length;
  updateColor(PALETTE[next].index);
}

window.addEventListener('keydown', (evt) => {
  const meta = evt.ctrlKey || evt.metaKey;

  // Ctrl held: temporary erase override on the brush tool (forces it into
  // erase-all behavior for the duration). No effect on lasso/bucket since
  // those are paint-only after the erase-as-tool refactor.
  if (evt.key === 'Control' && !ctrlHeld) {
    ctrlHeld = true;
    syncBrushEraseModeToTool();
  }

  if (meta && evt.key.toLowerCase() === 'z') {
    evt.preventDefault();
    if (evt.shiftKey) { if (history.redo()) { renderer.renderAll(); updateStatusbar(); refreshUsedIdsStatus(); } }
    else { if (history.undo()) { renderer.renderAll(); updateStatusbar(); refreshUsedIdsStatus(); } }
    return;
  }
  if (meta && evt.key.toLowerCase() === 'y') {
    evt.preventDefault();
    if (history.redo()) { renderer.renderAll(); updateStatusbar(); refreshUsedIdsStatus(); }
    return;
  }
  if (evt.key === 'Escape' && activeTool === 'lasso') lasso.cancel();
  else if (evt.key === 'Enter' && activeTool === 'lasso') lasso.doubleClick();
  else if (!meta && (evt.key === 'b' || evt.key === 'B')) setTool('brush');
  else if (!meta && (evt.key === 'l' || evt.key === 'L')) setTool('lasso');
  else if (!meta && (evt.key === 'g' || evt.key === 'G')) setTool('bucket');
  else if (!meta && (evt.key === 'e' || evt.key === 'E')) {
    // E switches to erase-all tool (or back to brush if already erase-all).
    // Shift+E switches to erase-selected (or back to brush).
    if (evt.shiftKey) {
      setTool(activeTool === 'erase-selected' ? 'brush' : 'erase-selected');
    } else {
      setTool(activeTool === 'erase-all' ? 'brush' : 'erase-all');
    }
  }
  else if (!meta && (evt.key === 'f' || evt.key === 'F')) fitToView();
  else if (!meta && evt.key === '?') {
    evt.preventDefault();
    if (helpDialog.open) helpDialog.close(); else helpDialog.showModal();
  }
});

window.addEventListener('keyup', (evt) => {
  if (evt.key === 'Control' && ctrlHeld) {
    ctrlHeld = false;
    syncBrushEraseModeToTool();
  }
});

// If the window loses focus while Ctrl is held, the keyup never fires —
// reset so we don't get stuck in erase mode.
window.addEventListener('blur', () => {
  if (ctrlHeld) {
    ctrlHeld = false;
    syncBrushEraseModeToTool();
  }
});

// ---------- Overlay redraw ----------

let lassoWasActive = false;

function redrawOverlay(cx?: number, cy?: number): void {
  if (cx !== undefined && cy !== undefined) {
    cursorX = cx;
    cursorY = cy;
  }

  // Lasso transitioning active -> inactive means it just committed (filled
  // pixels) or was cancelled. Refresh the used-ids tally either way; cancel
  // is a no-op for pixels but we save a branch by not checking.
  const lassoActive = lasso.isActive();
  if (lassoWasActive && !lassoActive) refreshUsedIdsStatus();
  lassoWasActive = lassoActive;
  // The doc-sized overlay canvas is no longer used (lasso preview moved to
  // a screen-space SVG so it can extend beyond canvas bounds), but keep the
  // clear in case future doc-space overlays land here.
  overlayCtx.clearRect(0, 0, DOC_SIZE, DOC_SIZE);

  redrawLassoPreview();
  updateBrushCursor();
  updateCursorGlyph();
  updateStatusbar();
}

/**
 * Walk the pixel buffer once to tally per-index usage, then update the
 * "Used: N" indicator and rebuild the hover popup. ~5 ms at 1024^2 - called
 * only from discrete doc-changing events, never from pointermove.
 */
function refreshUsedIdsStatus(): void {
  const counts = new Uint32Array(256);
  const px = doc.pixels;
  for (let i = 0; i < px.length; i++) counts[px[i]]++;

  const used: { entry: typeof PALETTE[number]; count: number }[] = [];
  for (const entry of PALETTE) {
    const c = counts[entry.index];
    if (c > 0) used.push({ entry, count: c });
  }

  statusUsedCount.textContent = String(used.length);

  // Rebuild popup
  while (statusUsedPopup.firstChild) statusUsedPopup.removeChild(statusUsedPopup.firstChild);
  if (used.length === 0) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'no indices painted yet';
    statusUsedPopup.appendChild(e);
    return;
  }
  for (const { entry, count } of used) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      `<span class="swatch" style="background:${paletteHex(entry)}"></span>` +
      `<span class="label">${entry.label}</span>` +
      `<span class="name">${entry.name}</span>` +
      `<span class="count">${count.toLocaleString()} px</span>`;
    statusUsedPopup.appendChild(row);
  }
}

function updateStatusbar(): void {
  const onCanvas =
    cursorX >= 0 && cursorY >= 0 && cursorX < DOC_SIZE && cursorY < DOC_SIZE;
  if (!onCanvas) {
    statusPos.textContent = '—';
    statusId.textContent = '—';
    statusSwatch.style.background = 'transparent';
    return;
  }
  const x = Math.floor(cursorX);
  const y = Math.floor(cursorY);
  statusPos.textContent = `${x}, ${y}`;
  const idx = doc.pixels[y * DOC_SIZE + x];
  if (idx === BACKGROUND_INDEX) {
    statusId.textContent = 'background';
    statusSwatch.style.background = '#000';
    return;
  }
  const entry = PALETTE_BY_INDEX.get(idx);
  if (!entry) {
    statusId.textContent = `?(${idx})`;
    statusSwatch.style.background = 'transparent';
    return;
  }
  statusId.textContent = `${entry.label} — ${entry.name}`;
  statusSwatch.style.background = paletteHex(entry);
}

function redrawLassoPreview(): void {
  if (activeTool !== 'lasso' || !lasso.isActive()) {
    lassoSvg.style.display = 'none';
    return;
  }
  lassoSvg.style.display = '';

  // Build the spline path. SVG is in screen coords - each doc-space sample
  // is mapped via the current viewport transform (scale + translate).
  const samples = lasso.getPreviewSamples(16);
  let d = '';
  for (let i = 0; i < samples.length; i++) {
    const sx = samples[i].x * scale + tx;
    const sy = samples[i].y * scale + ty;
    d += (i === 0 ? 'M' : 'L') + sx.toFixed(1) + ',' + sy.toFixed(1) + ' ';
  }
  if (lasso.isCloseable()) d += 'Z';
  lassoPath.setAttribute('d', d);
  lassoPathHalo.setAttribute('d', d);

  // Control-point handles: small white squares with a thin dark stroke.
  const ctrl = lasso.getControlPoints();
  while (lassoHandles.firstChild) lassoHandles.removeChild(lassoHandles.firstChild);
  for (const p of ctrl) {
    const r = document.createElementNS(SVG_NS, 'rect');
    const sx = p.x * scale + tx;
    const sy = p.y * scale + ty;
    r.setAttribute('x', (sx - 3).toFixed(1));
    r.setAttribute('y', (sy - 3).toFixed(1));
    r.setAttribute('width', '6');
    r.setAttribute('height', '6');
    lassoHandles.appendChild(r);
  }

  // Close indicator: a blue ring centered on the first point at the
  // doc-space close radius (so it visually shrinks/grows with zoom,
  // matching the actual hit-test region).
  const closeCenter = lasso.getCloseIndicator();
  if (closeCenter) {
    const sx = closeCenter.x * scale + tx;
    const sy = closeCenter.y * scale + ty;
    lassoCloseIndicator.setAttribute('cx', sx.toFixed(1));
    lassoCloseIndicator.setAttribute('cy', sy.toFixed(1));
    lassoCloseIndicator.setAttribute('r', (lasso.getCloseRadius() * scale).toFixed(1));
    lassoCloseIndicator.setAttribute('visibility', 'visible');
  } else {
    lassoCloseIndicator.setAttribute('visibility', 'hidden');
  }
}

function updateBrushCursor(): void {
  // The brush-radius preview belongs to any brush-shaped tool - brush itself
  // plus the two eraser tools (which all share the brush engine and size).
  // For lasso/bucket there is no "size" so the preview stays hidden.
  const usesBrushSize =
    activeTool === 'brush' ||
    activeTool === 'erase-all' ||
    activeTool === 'erase-selected';
  if (!usesBrushSize || cursorX < 0) {
    brushCursorSvg.classList.remove('active');
    return;
  }
  brushCursorSvg.classList.add('active');
  const r = brushState.size / 2;
  const cx = String(cursorX);
  const cy = String(cursorY);
  const rs = String(r);
  brushCursorOuter.setAttribute('cx', cx);
  brushCursorOuter.setAttribute('cy', cy);
  brushCursorOuter.setAttribute('r', rs);
  brushCursorInner.setAttribute('cx', cx);
  brushCursorInner.setAttribute('cy', cy);
  brushCursorInner.setAttribute('r', rs);
}

function updateCursorGlyph(): void {
  // This is called from applyTransform() during module init, before
  // `dragMode` / `persistentEraseMode` / `ctrlHeld` are declared lower in
  // the file. Touch only cursorX/cursorY first so the init call short-
  // circuits without triggering TDZ on those later bindings.
  if (cursorX < 0 || cursorY < 0 || cursorX >= DOC_SIZE || cursorY >= DOC_SIZE) {
    cursorGlyph.classList.remove('active');
    return;
  }
  if (dragMode === 'pan' || dragMode === 'size') {
    cursorGlyph.classList.remove('active');
    return;
  }
  cursorGlyph.classList.add('active');
  // brushState.eraseMode is the single source of truth: it's set by
  // syncBrushEraseModeToTool() based on activeTool + ctrlHeld, so reading it
  // covers the erase-all tool, erase-selected tool, and the Ctrl+brush case.
  const erasing = brushState.eraseMode !== 'off';
  cursorGlyph.textContent = erasing ? '−' : '+';
  // Doc -> stage-local screen coords, mirroring the canvas-stack transform.
  const sx = cursorX * scale + tx;
  const sy = cursorY * scale + ty;
  cursorGlyph.style.left = `${sx}px`;
  cursorGlyph.style.top = `${sy}px`;
}
