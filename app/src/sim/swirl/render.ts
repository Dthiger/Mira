/**
 * Render a swirl warp's output buffer (Uint8Array of palette indices) onto
 * the sim canvas. Uses the same RGBA lookup table as the main paint
 * renderer so colors are pixel-identical.
 */

import { PAINT_RGBA } from '../../paletteRgb.ts';

export function renderSwirl(
  ctx: CanvasRenderingContext2D,
  pixels: Uint8Array,
  width: number,
  height: number,
): void {
  const img = ctx.getImageData(0, 0, width, height);
  const out = img.data;
  for (let i = 0, p = 0; i < pixels.length; i++, p += 4) {
    const o = pixels[i] * 4;
    out[p]     = PAINT_RGBA[o];
    out[p + 1] = PAINT_RGBA[o + 1];
    out[p + 2] = PAINT_RGBA[o + 2];
    out[p + 3] = PAINT_RGBA[o + 3];
  }
  ctx.putImageData(img, 0, 0);
}
