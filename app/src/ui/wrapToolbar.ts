/**
 * Wrap-mode toolbar: Band-thickness slider, Min-shape slider, Y-flip
 * toggle, Export wrap UV button, Reset.
 */

import { DOC_SIZE } from '../state.ts';
import {
  params, exportOptions, recompute, wrapResetParams, getWrapDefaults, exportWrap,
} from '../sim/wrap/index.ts';

function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function initWrapToolbar(): void {
  const band = $('#wrap-band') as HTMLInputElement;
  const bandReadout = $('#wrap-band-readout');
  const min = $('#wrap-min') as HTMLInputElement;
  const minReadout = $('#wrap-min-readout');
  const inner = $('#wrap-inner') as HTMLInputElement;
  const flipY = $('#wrap-flipy') as HTMLInputElement;
  const exportBtn = $('#wrap-export-btn');
  const resetBtn = $('#wrap-reset-btn');

  band.addEventListener('input', () => {
    params.bandThicknessDoc = Number(band.value);
    bandReadout.textContent = band.value;
    recompute();
  });
  min.addEventListener('input', () => {
    params.minRegionPixels = Number(min.value);
    minReadout.textContent = min.value;
    recompute();
  });
  inner.addEventListener('change', () => {
    params.innerBand = inner.checked;
    recompute();
  });
  flipY.addEventListener('change', () => {
    exportOptions.flipY = flipY.checked;
  });

  resetBtn.addEventListener('click', () => {
    wrapResetParams();
    const d = getWrapDefaults();
    band.value = String(d.bandThicknessDoc); bandReadout.textContent = String(d.bandThicknessDoc);
    min.value = String(d.minRegionPixels); minReadout.textContent = String(d.minRegionPixels);
    inner.checked = d.innerBand;
  });

  exportBtn.addEventListener('click', async () => {
    try {
      const blob = await exportWrap();
      downloadBlob(blob, `mira-wrap-uv-${DOC_SIZE}x${DOC_SIZE}-rg16.png`);
    } catch (err) {
      console.error('Wrap UV export failed:', err);
      window.alert(`Wrap UV export failed: ${(err as Error).message}`);
    }
  });
}
