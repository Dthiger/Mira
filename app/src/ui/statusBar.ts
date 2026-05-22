/**
 * Bottom status bar:
 *   - POS: doc-pixel coordinates under the cursor
 *   - ID: swatch + label + name of the pixel at the cursor
 *   - USED: count of distinct palette indices in the doc, with hover
 *     popup listing each used color and its pixel count
 *
 * `updateStatusbar` runs on every pointermove (cheap O(1) read).
 * `refreshUsedIdsStatus` walks the whole pixel buffer and is called only
 * from discrete doc-changing events.
 */

import { PALETTE, PALETTE_BY_INDEX, BACKGROUND_INDEX, paletteHex } from '../palette.ts';
import {
  statusPos, statusId, statusSwatch, statusUsedCount, statusUsedPopup,
} from '../dom.ts';
import { DOC_SIZE, doc, state } from '../state.ts';

export function updateStatusbar(): void {
  const onCanvas =
    state.cursorX >= 0 && state.cursorY >= 0 &&
    state.cursorX < DOC_SIZE && state.cursorY < DOC_SIZE;
  if (!onCanvas) {
    statusPos.textContent = '—';
    statusId.textContent = '—';
    statusSwatch.style.background = 'transparent';
    return;
  }
  const x = Math.floor(state.cursorX);
  const y = Math.floor(state.cursorY);
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

export function refreshUsedIdsStatus(): void {
  const counts = new Uint32Array(256);
  const px = doc.pixels;
  for (let i = 0; i < px.length; i++) counts[px[i]]++;

  let rows = '';
  let usedCount = 0;
  for (const entry of PALETTE) {
    const c = counts[entry.index];
    if (c === 0) continue;
    usedCount++;
    rows +=
      `<div class="row">` +
        `<span class="swatch" style="background:${paletteHex(entry)}"></span>` +
        `<span class="label">${entry.label}</span>` +
        `<span class="name">${entry.name}</span>` +
        `<span class="count">${c.toLocaleString()} px</span>` +
      `</div>`;
  }

  statusUsedCount.textContent = String(usedCount);
  statusUsedPopup.innerHTML = usedCount === 0
    ? '<div class="empty">no indices painted yet</div>'
    : rows;
}
