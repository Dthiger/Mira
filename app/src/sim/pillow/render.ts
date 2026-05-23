/**
 * Render a SimWorld onto a dedicated canvas. Each body's triangles are filled
 * with its palette color. `imageSmoothingEnabled = false` keeps edges crisp;
 * the canvas inherits the canvas-stack transform so pan/zoom work for free.
 */

import { PALETTE_BY_INDEX, paletteHex } from '../../palette.ts';
import type { SimWorld } from './types.ts';

export function renderPillow(ctx: CanvasRenderingContext2D, world: SimWorld): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const body of world.bodies) {
    const entry = PALETTE_BY_INDEX.get(body.paletteIndex);
    if (!entry) continue;
    ctx.fillStyle = paletteHex(entry);
    ctx.beginPath();
    for (const t of body.triangles) {
      const a = body.vertices[t.v0];
      const b = body.vertices[t.v1];
      const c = body.vertices[t.v2];
      ctx.moveTo(a.px, a.py);
      ctx.lineTo(b.px, b.py);
      ctx.lineTo(c.px, c.py);
      ctx.closePath();
    }
    ctx.fill();
  }
}
