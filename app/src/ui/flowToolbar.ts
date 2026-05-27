/**
 * Flowmap-mode toolbar: scale / strength / tangentMix / boundaryFalloff /
 * seed sliders + Roll, Reset, Y-flip toggle, RG-preview toggle, and the
 * "Export PNG" button (writes a Substance-compatible flowmap to disk).
 */

import { DOC_SIZE } from '../state.ts';
import {
  params, exportOptions, recompute, reseed, flowResetParams,
  getFlowDefaults, exportFlowmap,
  simStep, simReset, play, pause, isSimPlaying, onPlaybackChange,
  setStepsPerFrame, setPush, setDragRadius, setTurbulenceLevel,
} from '../sim/flow/index.ts';

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

export function initFlowToolbar(): void {
  const scale = $('#flow-scale') as HTMLInputElement;
  const scaleReadout = $('#flow-scale-readout');
  const strength = $('#flow-strength') as HTMLInputElement;
  const strengthReadout = $('#flow-strength-readout');
  const tangent = $('#flow-tangent') as HTMLInputElement;
  const tangentReadout = $('#flow-tangent-readout');
  const falloff = $('#flow-falloff') as HTMLInputElement;
  const falloffReadout = $('#flow-falloff-readout');
  const seed = $('#flow-seed') as HTMLInputElement;
  const seedReadout = $('#flow-seed-readout');
  const flipY = $('#flow-flipy') as HTMLInputElement;
  const reseedBtn = $('#flow-reseed-btn');
  const resetBtn = $('#flow-reset-btn');
  const exportBtn = $('#flow-export-btn');
  const simSpeed = $('#flow-sim-speed') as HTMLInputElement;
  const simSpeedReadout = $('#flow-sim-speed-readout');
  const simPlayBtn = $('#flow-sim-play-btn') as HTMLButtonElement;
  const simStepBtn = $('#flow-sim-step-btn');
  const simResetBtn = $('#flow-sim-reset-btn');
  const simStepsCounter = $('#flow-sim-steps-counter');
  const pushAngle = $('#flow-push-angle') as HTMLInputElement;
  const pushAngleReadout = $('#flow-push-angle-readout');
  const pushStrength = $('#flow-push-strength') as HTMLInputElement;
  const pushStrengthReadout = $('#flow-push-strength-readout');

  // Single source of truth for Play button label + counter is the
  // playback-change callback from sim/flow/index.
  onPlaybackChange((isPlaying, steps) => {
    simPlayBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
    simStepsCounter.textContent = `${steps} steps`;
  });

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
  tangent.addEventListener('input', () => {
    params.tangentMix = Number(tangent.value) / 100;
    tangentReadout.textContent = params.tangentMix.toFixed(2);
    recompute();
  });
  falloff.addEventListener('input', () => {
    params.boundaryFalloff = Number(falloff.value);
    falloffReadout.textContent = String(params.boundaryFalloff);
    recompute();
  });
  seed.addEventListener('input', () => {
    const v = Number(seed.value);
    seedReadout.textContent = String(v);
    reseed(v);
  });
  flipY.addEventListener('change', () => {
    exportOptions.flipY = flipY.checked;
  });

  simSpeed.addEventListener('input', () => {
    const n = Number(simSpeed.value);
    setStepsPerFrame(n);
    simSpeedReadout.textContent = `${n}×`;
  });
  simPlayBtn.addEventListener('click', () => {
    if (isSimPlaying()) pause();
    else play();
  });
  simStepBtn.addEventListener('click', () => {
    simStep(1);
  });
  simResetBtn.addEventListener('click', () => {
    simReset();
  });

  pushAngle.addEventListener('input', () => {
    const a = Number(pushAngle.value);
    pushAngleReadout.textContent = `${a}°`;
    setPush(a, Number(pushStrength.value));
  });
  pushStrength.addEventListener('input', () => {
    const s = Number(pushStrength.value);
    pushStrengthReadout.textContent = String(s);
    setPush(Number(pushAngle.value), s);
  });

  const brush = $('#flow-brush-radius') as HTMLInputElement;
  const brushReadout = $('#flow-brush-radius-readout');
  brush.addEventListener('input', () => {
    const v = Number(brush.value);
    brushReadout.textContent = String(v);
    setDragRadius(v);
  });

  const turb = $('#flow-turbulence') as HTMLInputElement;
  const turbReadout = $('#flow-turbulence-readout');
  // Initialize the sim's turbulence from the slider's HTML default.
  setTurbulenceLevel(Number(turb.value));
  turb.addEventListener('input', () => {
    const v = Number(turb.value);
    turbReadout.textContent = String(v);
    setTurbulenceLevel(v);
  });

  reseedBtn.addEventListener('click', () => {
    const v = Math.floor(Math.random() * 1000);
    seed.value = String(v);
    seedReadout.textContent = String(v);
    reseed(v);
  });

  resetBtn.addEventListener('click', () => {
    flowResetParams();
    const d = getFlowDefaults();
    scale.value = String(d.scale); scaleReadout.textContent = String(d.scale);
    strength.value = String(d.strength); strengthReadout.textContent = String(d.strength);
    tangent.value = String(d.tangentMix * 100); tangentReadout.textContent = d.tangentMix.toFixed(2);
    falloff.value = String(d.boundaryFalloff); falloffReadout.textContent = String(d.boundaryFalloff);
    seed.value = String(d.seed); seedReadout.textContent = String(d.seed);
  });

  exportBtn.addEventListener('click', async () => {
    try {
      const blob = await exportFlowmap();
      downloadBlob(blob, `mira-flowmap-${DOC_SIZE}x${DOC_SIZE}-rg16.png`);
    } catch (err) {
      console.error('Flowmap export failed:', err);
      window.alert(`Flowmap export failed: ${(err as Error).message}`);
    }
  });
}
