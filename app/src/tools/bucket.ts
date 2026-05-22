import type { MaskDocument } from '../document.ts';
import type { PaintRenderer } from '../renderer.ts';

export interface BucketState {
  colorIndex: number;
}

/**
 * Paint bucket: 4-connected scanline flood fill.
 * On click, replaces every pixel reachable from the seed that shares the
 * seed's current palette index. No-ops if the seed is already the new color.
 */
export class BucketTool {
  private readonly doc: MaskDocument;
  private readonly renderer: PaintRenderer;
  private readonly state: BucketState;

  constructor(doc: MaskDocument, renderer: PaintRenderer, state: BucketState) {
    this.doc = doc;
    this.renderer = renderer;
    this.state = state;
  }

  /** Returns true if any pixels were filled. */
  apply(x: number, y: number): boolean {
    const w = this.doc.width;
    const h = this.doc.height;
    const px = this.doc.pixels;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return false;

    const target = px[yi * w + xi];
    const newColor = this.state.colorIndex;
    if (target === newColor) return false;

    // Scanline flood fill (Smith). Stack holds seeds for new spans to explore.
    const stack: number[] = [yi * w + xi];
    let xMin = xi, xMax = xi, yMin = yi, yMax = yi;

    while (stack.length > 0) {
      const seed = stack.pop()!;
      const sy = (seed / w) | 0;
      const sx = seed - sy * w;
      if (px[seed] !== target) continue;

      const row = sy * w;
      let lx = sx;
      while (lx > 0 && px[row + lx - 1] === target) lx--;
      let rx = sx;
      while (rx < w - 1 && px[row + rx + 1] === target) rx++;

      for (let i = lx; i <= rx; i++) px[row + i] = newColor;

      if (lx < xMin) xMin = lx;
      if (rx > xMax) xMax = rx;
      if (sy < yMin) yMin = sy;
      if (sy > yMax) yMax = sy;

      if (sy > 0) {
        const above = row - w;
        // Push at most one seed per contiguous matching span above
        let inSpan = false;
        for (let i = lx; i <= rx; i++) {
          if (px[above + i] === target) {
            if (!inSpan) { stack.push(above + i); inSpan = true; }
          } else {
            inSpan = false;
          }
        }
      }
      if (sy < h - 1) {
        const below = row + w;
        let inSpan = false;
        for (let i = lx; i <= rx; i++) {
          if (px[below + i] === target) {
            if (!inSpan) { stack.push(below + i); inSpan = true; }
          } else {
            inSpan = false;
          }
        }
      }
    }

    this.renderer.renderRect(xMin, yMin, xMax - xMin + 1, yMax - yMin + 1);
    return true;
  }
}
