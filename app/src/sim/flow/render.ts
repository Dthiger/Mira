/**
 * Render the flow field to the sim canvas using the same RG encoding
 * that the exported PNG uses — WYSIWYG. R = (x+1)/2, G = (y+1)/2,
 * B = 0. When `subtractMean` is on, the mean velocity is removed first,
 * so the preview shows the deviation-from-bulk-flow (river-lane
 * structure) instead of the absolute velocity.
 */

import type { FlowField } from './types.ts';

export interface RenderOptions {
  subtractMean: boolean;
}

export function renderFlow(
  ctx: CanvasRenderingContext2D,
  field: FlowField,
  opts: RenderOptions,
): void {
  const w = field.width;
  const h = field.height;
  const img = ctx.getImageData(0, 0, w, h);
  const out = img.data;
  const fx = field.fx;
  const fy = field.fy;

  let meanX = 0, meanY = 0;
  if (opts.subtractMean) {
    let count = 0;
    for (let i = 0; i < fx.length; i++) {
      if (fx[i] === 0 && fy[i] === 0) continue;
      meanX += fx[i]; meanY += fy[i]; count++;
    }
    if (count > 0) { meanX /= count; meanY /= count; }
  }

  let maxMag2 = 0;
  for (let i = 0; i < fx.length; i++) {
    if (fx[i] === 0 && fy[i] === 0) continue;
    const dx = fx[i] - meanX;
    const dy = fy[i] - meanY;
    const m = dx * dx + dy * dy;
    if (m > maxMag2) maxMag2 = m;
  }
  const invMax = maxMag2 > 0 ? 1 / Math.sqrt(maxMag2) : 0;

  for (let i = 0, p = 0; i < fx.length; i++, p += 4) {
    const isWall = fx[i] === 0 && fy[i] === 0;
    const nx = isWall ? 0 : (fx[i] - meanX) * invMax;
    const ny = isWall ? 0 : (fy[i] - meanY) * invMax;
    out[p]     = Math.round((nx * 0.5 + 0.5) * 255);
    out[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    out[p + 2] = 0;
    out[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
