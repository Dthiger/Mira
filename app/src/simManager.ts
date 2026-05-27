/**
 * Sim-mode (pillow / swirl) lifecycle and toolbar wiring. Owns
 * `state.mode` transitions, hides/shows mode-specific UI groups, and
 * routes button clicks into the right sim module.
 *
 * Phase 1: pillow only (enter -> render at rest). Swirl follows in Phase 5.
 */

import { state, doc } from './state.ts';
import { pillowBtn, swirlBtn, flowBtn, simCanvas } from './dom.ts';
import { enterPillow, exitPillow, pillowIsActive } from './sim/pillow/index.ts';
import { enterSwirl, exitSwirl, swirlIsActive } from './sim/swirl/index.ts';
import { enterFlow, exitFlow, flowIsActive } from './sim/flow/index.ts';

type SimMode = 'pillow' | 'swirl' | 'flow';

export function enterMode(mode: SimMode): void {
  if (state.mode === mode) return;
  // Always exit any current sim mode before entering a new one.
  exitCurrentMode();
  if (mode === 'pillow') {
    enterPillow(doc, simCanvas);
    pillowBtn.setAttribute('aria-pressed', 'true');
  } else if (mode === 'swirl') {
    enterSwirl(doc, simCanvas);
    swirlBtn.setAttribute('aria-pressed', 'true');
  } else if (mode === 'flow') {
    enterFlow(doc, simCanvas);
    flowBtn.setAttribute('aria-pressed', 'true');
  }
  state.mode = mode;
  document.body.classList.add(`mode-${mode}`);
}

export function exitToPaint(): void {
  exitCurrentMode();
  state.mode = 'paint';
}

function exitCurrentMode(): void {
  if (pillowIsActive()) exitPillow();
  if (swirlIsActive()) exitSwirl();
  if (flowIsActive()) exitFlow();
  pillowBtn.setAttribute('aria-pressed', 'false');
  swirlBtn.setAttribute('aria-pressed', 'false');
  flowBtn.setAttribute('aria-pressed', 'false');
  document.body.classList.remove('mode-pillow', 'mode-swirl', 'mode-flow');
}

export function initSimManager(): void {
  pillowBtn.addEventListener('click', () => {
    if (state.mode === 'pillow') exitToPaint();
    else enterMode('pillow');
  });
  swirlBtn.addEventListener('click', () => {
    if (state.mode === 'swirl') exitToPaint();
    else enterMode('swirl');
  });
  flowBtn.addEventListener('click', () => {
    if (state.mode === 'flow') exitToPaint();
    else enterMode('flow');
  });
}
