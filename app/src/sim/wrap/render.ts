/**
 * Render a wrap-UV field to a canvas as RGB (U → R, V → G, inside-mask
 * → B). 8-bit display preview of the same encoding the 16-bit PNG
 * export uses — WYSIWYG, just at lower precision. The inner band shows
 * with a blue tint so you can tell the two sides apart at a glance.
 */

import type { WrapField } from './build.ts';

export function renderWrapUv(
  ctx: CanvasRenderingContext2D,
  field: WrapField,
): void {
  const w = field.width;
  const h = field.height;
  const img = ctx.getImageData(0, 0, w, h);
  const out = img.data;
  for (let i = 0, p = 0; i < field.fx.length; i++, p += 4) {
    out[p]     = Math.round(field.fx[i] * 255);
    out[p + 1] = Math.round(field.fy[i] * 255);
    out[p + 2] = field.inside[i] ? 255 : 0;
    out[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
