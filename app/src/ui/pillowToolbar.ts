/**
 * Pillow-mode toolbar wiring: drag/strength/stiffness sliders, Bake, Reset.
 * Bake actually rasterizes back to doc.pixels (Phase 4 work); for Phase 2
 * the button is wired but the implementation is a stub that snapshots
 * history and re-renders.
 */

import { params, pillowReset } from '../sim/pillow/index.ts';
import { exitToPaint } from '../simManager.ts';

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

  resetBtn.addEventListener('click', () => pillowReset());
  bakeBtn.addEventListener('click', () => {
    // Phase 4 will replace this with actual rasterization. For now: leave
    // the mesh state intact, just inform the user it's a stub.
    console.warn('Bake not implemented yet (Phase 4)');
    exitToPaint();
  });
}
