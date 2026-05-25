/**
 * Pillow-mode toolbar wiring: drag/strength/stiffness sliders, wireframe
 * toggle, Reset, Bake. Bake snapshots the doc for undo, rasterizes the
 * deformed mesh back into doc.pixels, re-renders, and exits to paint.
 */

import { doc, renderer, history } from '../state.ts';
import { params, pillowReset, getPillowWorld } from '../sim/pillow/index.ts';
import { renderOptions } from '../sim/pillow/render.ts';
import { bakePillow } from '../sim/pillow/bake.ts';
import { exitToPaint } from '../simManager.ts';
import { updateStatusbar, refreshUsedIdsStatus } from './statusBar.ts';

function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
}

export function initPillowToolbar(): void {
  const radius = $('#pillow-radius') as HTMLInputElement;
  const radiusReadout = $('#pillow-radius-readout');
  const strength = $('#pillow-strength') as HTMLInputElement;
  const strengthReadout = $('#pillow-strength-readout');
  const stiffness = $('#pillow-stiffness') as HTMLInputElement;
  const stiffnessReadout = $('#pillow-stiffness-readout');
  const resetBtn = $('#pillow-reset-btn');
  const bakeBtn = $('#pillow-bake-btn');
  const wireframe = $('#pillow-wireframe') as HTMLInputElement;

  radius.addEventListener('input', () => {
    params.dragRadius = Number(radius.value);
    radiusReadout.textContent = String(params.dragRadius);
  });
  strength.addEventListener('input', () => {
    params.dragStrength = Number(strength.value) / 100;
    strengthReadout.textContent = params.dragStrength.toFixed(2);
  });
  stiffness.addEventListener('input', () => {
    params.stiffness = Number(stiffness.value) / 100;
    stiffnessReadout.textContent = params.stiffness.toFixed(2);
  });

  wireframe.addEventListener('change', () => {
    renderOptions.wireframe = wireframe.checked;
    renderOptions.vertDots = wireframe.checked;
  });
  // Initialize from checkbox's HTML default.
  renderOptions.wireframe = wireframe.checked;
  renderOptions.vertDots = wireframe.checked;

  resetBtn.addEventListener('click', () => pillowReset());
  bakeBtn.addEventListener('click', () => {
    const world = getPillowWorld();
    if (!world) { exitToPaint(); return; }
    // Snapshot the pre-bake doc into doc-level history so Ctrl+Z in paint
    // mode reverts the bake. The bake itself runs synchronously and is
    // safe to do before exit; exitToPaint tears down the sim world.
    history.commit();
    bakePillow(doc, world);
    renderer.renderAll();
    updateStatusbar();
    refreshUsedIdsStatus();
    exitToPaint();
  });
}
