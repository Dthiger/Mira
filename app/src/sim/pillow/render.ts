/**
 * Render a SimWorld onto a dedicated canvas. Each body's triangles are filled
 * with its palette color. `imageSmoothingEnabled = false` keeps edges crisp;
 * the canvas inherits the canvas-stack transform so pan/zoom work for free.
 */

import { PALETTE_BY_INDEX, paletteHex } from '../../palette.ts';
import type { SimWorld } from './types.ts';

// Toggle to overlay the triangle mesh wireframe + vert dots. Useful for
// verifying that the world was built and that drag actually moves verts.
export const renderOptions = { wireframe: true, vertDots: true };

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

  if (renderOptions.wireframe) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 1;
    for (const body of world.bodies) {
      ctx.beginPath();
      for (const e of body.edges) {
        const a = body.vertices[e.a];
        const b = body.vertices[e.b];
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
      }
      ctx.stroke();
    }
  }

  if (renderOptions.vertDots) {
    for (const body of world.bodies) {
      for (const v of body.vertices) {
        ctx.fillStyle = v.pinned ? '#ff3030' : '#ffffff';
        ctx.fillRect(v.px - 1.5, v.py - 1.5, 3, 3);
      }
    }
  }
}
