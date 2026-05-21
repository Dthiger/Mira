import { BACKGROUND_INDEX, PALETTE } from './palette.ts';
import type { MaskDocument } from './document.ts';

const RGBA_TABLE = (() => {
  const table = new Uint8Array(256 * 4);
  for (const entry of PALETTE) {
    const off = entry.index * 4;
    table[off + 0] = entry.r;
    table[off + 1] = entry.g;
    table[off + 2] = entry.b;
    table[off + 3] = 255;
  }
  // Background renders as fully TRANSPARENT in the paint canvas so the
  // reference image (and the canvas-stack's black backdrop) shows through.
  // Export pipelines composite onto opaque black for the final PNG.
  const bgOff = BACKGROUND_INDEX * 4;
  table[bgOff + 0] = 0;
  table[bgOff + 1] = 0;
  table[bgOff + 2] = 0;
  table[bgOff + 3] = 0;
  return table;
})();

export class PaintRenderer {
  private readonly doc: MaskDocument;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private readonly buf: Uint8ClampedArray;

  constructor(canvas: HTMLCanvasElement, doc: MaskDocument) {
    canvas.width = doc.width;
    canvas.height = doc.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error('Could not acquire 2d context for paint canvas');
    ctx.imageSmoothingEnabled = false;
    this.doc = doc;
    this.ctx = ctx;
    this.imageData = ctx.createImageData(doc.width, doc.height);
    this.buf = this.imageData.data;
  }

  /** Re-render every pixel from the index buffer. */
  renderAll(): void {
    const px = this.doc.pixels;
    const buf = this.buf;
    const n = px.length;
    for (let i = 0; i < n; i++) {
      const off = px[i] * 4;
      const out = i * 4;
      buf[out + 0] = RGBA_TABLE[off + 0];
      buf[out + 1] = RGBA_TABLE[off + 1];
      buf[out + 2] = RGBA_TABLE[off + 2];
      buf[out + 3] = RGBA_TABLE[off + 3];
    }
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  /** Re-render a subrectangle of the index buffer (faster for tool strokes). */
  renderRect(x0: number, y0: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    x0 = Math.max(0, Math.min(this.doc.width, x0 | 0));
    y0 = Math.max(0, Math.min(this.doc.height, y0 | 0));
    const x1 = Math.max(0, Math.min(this.doc.width, (x0 + w) | 0));
    const y1 = Math.max(0, Math.min(this.doc.height, (y0 + h) | 0));
    if (x0 >= x1 || y0 >= y1) return;

    const docW = this.doc.width;
    const px = this.doc.pixels;
    const buf = this.buf;
    for (let y = y0; y < y1; y++) {
      let srcOff = y * docW + x0;
      let dstOff = (y * docW + x0) * 4;
      for (let x = x0; x < x1; x++, srcOff++, dstOff += 4) {
        const palOff = px[srcOff] * 4;
        buf[dstOff + 0] = RGBA_TABLE[palOff + 0];
        buf[dstOff + 1] = RGBA_TABLE[palOff + 1];
        buf[dstOff + 2] = RGBA_TABLE[palOff + 2];
        buf[dstOff + 3] = RGBA_TABLE[palOff + 3];
      }
    }
    this.ctx.putImageData(this.imageData, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }
}
