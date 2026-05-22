/**
 * Custom color picker dropdown. Built once at init; options are cached so
 * updateColor and the used-color highlight don't re-query the DOM.
 */

import { PALETTE, PALETTE_BY_INDEX, paletteHex } from '../palette.ts';
import {
  colorPicker, colorTrigger, colorMenu, colorTriggerLabel, colorSwatch,
} from '../dom.ts';
import { doc, brushState, lassoState, bucketState } from '../state.ts';

const colorOptions: HTMLButtonElement[] = [];

function openMenu(): void {
  colorMenu.hidden = false;
  colorTrigger.setAttribute('aria-expanded', 'true');
}
function closeMenu(): void {
  colorMenu.hidden = true;
  colorTrigger.setAttribute('aria-expanded', 'false');
}

export function updateColor(index: number): void {
  brushState.colorIndex = index;
  lassoState.colorIndex = index;
  bucketState.colorIndex = index;
  const entry = PALETTE_BY_INDEX.get(index);
  if (!entry) return;
  colorSwatch.style.background = paletteHex(entry);
  colorTriggerLabel.textContent = `${entry.label} - ${entry.name}`;
  for (const opt of colorOptions) {
    opt.setAttribute('aria-selected', Number(opt.dataset.index) === index ? 'true' : 'false');
  }
}

/** Mark options whose index appears in the current document so the dropdown
 *  can highlight them. Called when the menu opens. */
function refreshUsedIndicesInMenu(): void {
  const seen = new Uint8Array(256);
  const px = doc.pixels;
  for (let i = 0; i < px.length; i++) seen[px[i]] = 1;
  for (const opt of colorOptions) {
    const idx = Number(opt.dataset.index);
    opt.classList.toggle('used', seen[idx] === 1);
  }
}

/** Cycle to the next/previous palette entry in label order with wrap-around. */
export function cyclePaletteColor(delta: number): void {
  let pos = -1;
  for (let i = 0; i < PALETTE.length; i++) {
    if (PALETTE[i].index === brushState.colorIndex) { pos = i; break; }
  }
  if (pos < 0) pos = 0;
  const next = (pos + delta + PALETTE.length) % PALETTE.length;
  updateColor(PALETTE[next].index);
}

export function initColorPicker(): void {
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
      closeMenu();
    });
    colorMenu.appendChild(opt);
    colorOptions.push(opt);
  }

  colorTrigger.addEventListener('click', (evt) => {
    evt.stopPropagation();
    if (colorMenu.hidden) {
      refreshUsedIndicesInMenu();
      openMenu();
    } else {
      closeMenu();
    }
  });

  document.addEventListener('click', (evt) => {
    if (!colorMenu.hidden && !colorPicker.contains(evt.target as Node)) {
      closeMenu();
    }
  });

  updateColor(0);
}
