/**
 * Render the flow field to the sim canvas using the same RG encoding
 * that the exported PNG uses — WYSIWYG. R = (x+1)/2, G = (y+1)/2,
 * B = 0. Zero-flow pixels render as (128, 128, 0) olive; the strongest
 * flows render as saturated red / green.
 */

import type { FlowField } from './types.ts';

export function renderFlow(
  ctx: CanvasRenderingContext2D,
  field: FlowField,
): void {
  const w = field.width;
  const h = field.height;
  const img = ctx.getImageData(0, 0, w, h);
  const out = img.data;
  const fx = field.fx;
  const fy = field.fy;

  // Normalize by max magnitude (matches the exporter), so the
  // strongest vector in the preview maps to ±1 → 0 or 255.
  let maxMag2 = 0;
  for (let i = 0; i < fx.length; i++) {
    const m = fx[i] * fx[i] + fy[i] * fy[i];
    if (m > maxMag2) maxMag2 = m;
  }
  const invMax = maxMag2 > 0 ? 1 / Math.sqrt(maxMag2) : 0;

  for (let i = 0, p = 0; i < fx.length; i++, p += 4) {
    const nx = fx[i] * invMax; // [-1, 1]
    const ny = fy[i] * invMax;
    out[p]     = Math.round((nx * 0.5 + 0.5) * 255);
    out[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    out[p + 2] = 0;
    out[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
