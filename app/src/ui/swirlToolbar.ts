/**
 * Swirl-mode toolbar wiring: noise-scale / strength / seed sliders, Roll
 * button to randomize the seed, and Bake to commit the warped buffer into
 * doc.pixels.
 */

import { renderer, history } from '../state.ts';
import { params, recompute, reseed, swirlBake, swirlResetParams, getSwirlDefaults } from '../sim/swirl/index.ts';
import { exitToPaint } from '../simManager.ts';
import { updateStatusbar, refreshUsedIdsStatus } from './statusBar.ts';

function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
}

export function initSwirlToolbar(): void {
  const scale = $('#swirl-scale') as HTMLInputElement;
  const scaleReadout = $('#swirl-scale-readout');
  const strength = $('#swirl-strength') as HTMLInputElement;
  const strengthReadout = $('#swirl-strength-readout');
  const seed = $('#swirl-seed') as HTMLInputElement;
  const seedReadout = $('#swirl-seed-readout');
  const reseedBtn = $('#swirl-reseed-btn');
  const resetBtn = $('#swirl-reset-btn');
  const bakeBtn = $('#swirl-bake-btn');

  scale.addEventListener('input', () => {
    params.scale = Number(scale.value);
    scaleReadout.textContent = String(params.scale);
    recompute();
  });
  strength.addEventListener('input', () => {
    params.strength = Number(strength.value);
    strengthReadout.textContent = String(params.strength);
    recompute();
  });
  seed.addEventListener('input', () => {
    const v = Number(seed.value);
    seedReadout.textContent = String(v);
    reseed(v);
  });

  reseedBtn.addEventListener('click', () => {
    const v = Math.floor(Math.random() * 1000);
    seed.value = String(v);
    seedReadout.textContent = String(v);
    reseed(v);
  });

  resetBtn.addEventListener('click', () => {
    // Snap params back to defaults and re-sync the slider DOM values.
    swirlResetParams();
    const d = getSwirlDefaults();
    scale.value = String(d.scale);
    scaleReadout.textContent = String(d.scale);
    strength.value = String(d.strength);
    strengthReadout.textContent = String(d.strength);
    seed.value = String(d.seed);
    seedReadout.textContent = String(d.seed);
  });

  bakeBtn.addEventListener('click', () => {
    history.commit();
    swirlBake();
    renderer.renderAll();
    updateStatusbar();
    refreshUsedIdsStatus();
    exitToPaint();
  });
}
