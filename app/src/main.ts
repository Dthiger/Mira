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
import { initSimManager } from './simManager.ts';
import { initPillowToolbar } from './ui/pillowToolbar.ts';
import { initSwirlToolbar } from './ui/swirlToolbar.ts';
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

// DEBUG: ?autopaint paints 3 test circles into doc.pixels so headless
// screenshots / quick repro can exercise pillow mode without a human
// drawing first.
{
  const qp = new URLSearchParams(location.search);
  if (qp.has('autopaint')) {
    const mode = qp.get('autopaint');
    // baketouch: two same-color circles painted with a clean gap (so they
    // become TWO bodies in sim), then programmatically shifted into contact
    // before bake. Exercises the bake's same-palette gap rule.
    const circles: Array<{ x: number; y: number; r: number; palIdx: number }> =
      mode === 'baketouch'
        ? [
            { x: 350, y: 500, r: 130, palIdx: 7 },
            { x: 690, y: 500, r: 130, palIdx: 7 },
          ]
        : [
            { x: 300, y: 350, r: 90, palIdx: 0 },
            { x: 600, y: 350, r: 110, palIdx: 5 },
            { x: 450, y: 650, r: 100, palIdx: 12 },
          ];
    for (const c of circles) {
      const r2 = c.r * c.r;
      for (let y = Math.max(0, c.y - c.r); y < Math.min(doc.height, c.y + c.r); y++) {
        for (let x = Math.max(0, c.x - c.r); x < Math.min(doc.width, c.x + c.r); x++) {
          const ddx = x - c.x, ddy = y - c.y;
          if (ddx * ddx + ddy * ddy <= r2) doc.setIndex(x, y, c.palIdx);
        }
      }
    }
    renderer.renderAll();
    console.log('[autopaint] painted 3 circles');

    if (mode === 'pillow' || mode === 'bake' || mode === 'baketouch' || mode === 'swirl') {
      // Click the matching sim button after layout settles so simManager
      // runs through its normal path.
      setTimeout(() => {
        const btnId = mode === 'swirl' ? 'swirl-btn' : 'pillow-btn';
        const btn = document.getElementById(btnId) as HTMLButtonElement | null;
        btn?.click();
        console.log(`[autopaint] ${btnId} clicked`);
        if (mode === 'swirl') {
          // Push scale up + medium strength to verify the scale
          // normalization keeps the warp visible at large noise scales.
          setTimeout(() => {
            const scale = document.getElementById('swirl-scale') as HTMLInputElement;
            scale.value = '350';
            scale.dispatchEvent(new Event('input', { bubbles: true }));
            const sl = document.getElementById('swirl-strength') as HTMLInputElement;
            sl.value = '100';
            sl.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[autopaint] swirl scale=350 strength=100');
          }, 100);
        }
        if (mode === 'bake' || mode === 'baketouch') {
          setTimeout(() => {
            if (mode === 'baketouch') {
              // Shift body 1's verts left so its polar polygon overlaps
              // body 0's — simulating "two same-color bodies pressed
              // together by drag" without needing real drag automation.
              import('./sim/pillow/index.ts').then(({ getPillowWorld }) => {
                const world = getPillowWorld();
                if (world && world.bodies.length >= 2) {
                  const shift = -200; // x-shift for body 1 to overlap body 0
                  for (const v of world.bodies[1].vertices) {
                    v.px += shift; v.qx += shift; v.rx += shift;
                  }
                  console.log('[baketouch] shifted body 1 by', shift);
                }
                const bake = document.getElementById('pillow-bake-btn') as HTMLButtonElement | null;
                bake?.click();
                console.log('[autopaint] bake button clicked');
                import('./ccl.ts').then(({ connectedComponents }) => {
                  const r = connectedComponents(doc);
                  console.log('[baketouch] post-bake regionCount =', r.regionCount);
                });
              });
            } else {
              const bake = document.getElementById('pillow-bake-btn') as HTMLButtonElement | null;
              bake?.click();
              console.log('[autopaint] bake button clicked');
            }
          }, 200);
        } else {
          setTimeout(() => {
            const dbg = (window as unknown as { __pillowDebug?: Record<string, unknown> }).__pillowDebug;
            const el = document.createElement('pre');
            el.id = 'autopaint-debug';
            el.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(255,255,0,0.95);color:#000;padding:6px 12px;font:11px monospace;white-space:pre-wrap;max-width:90vw;';
            el.textContent = `__pillowDebug = ${JSON.stringify(dbg, null, 2)}`;
            document.body.appendChild(el);
          }, 200);
        }
      }, 50);
    }
  }
}

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
initSimManager();
initPillowToolbar();
initSwirlToolbar();
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

