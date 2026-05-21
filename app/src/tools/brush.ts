import type { MaskDocument } from '../document.ts';
import type { PaintRenderer } from '../renderer.ts';
import { BACKGROUND_INDEX, type EraseMode } from '../palette.ts';

export interface BrushState {
  /** Current palette index to paint (0..24). */
  colorIndex: number;
  /** Three-state erase mode (off / all / selected). */
  eraseMode: EraseMode;
  /** Brush diameter in pixels. */
  size: number;
}

interface DirtyRect { x0: number; y0: number; x1: number; y1: number; }

/**
 * Hard-edged circular brush. Fills every pixel whose center is within the
 * brush radius of the stamp center. Strokes between mouse-move samples are
 * connected via Bresenham-style line stamps so motion never leaves gaps.
 */
export class BrushTool {
  private readonly doc: MaskDocument;
  private readonly renderer: PaintRenderer;
  private readonly state: BrushState;
  private active = false;
  private lastX = 0;
  private lastY = 0;
  private dirty: DirtyRect | null = null;

  constructor(doc: MaskDocument, renderer: PaintRenderer, state: BrushState) {
    this.doc = doc;
    this.renderer = renderer;
    this.state = state;
  }

  begin(x: number, y: number): void {
    this.active = true;
    this.dirty = null;
    this.lastX = x;
    this.lastY = y;
    this.stamp(x, y);
    this.flush();
  }

  move(x: number, y: number): void {
    if (!this.active) return;
    this.stampLine(this.lastX, this.lastY, x, y);
    this.lastX = x;
    this.lastY = y;
    this.flush();
  }

  end(): void {
    this.active = false;
    this.flush();
  }

  isActive(): boolean { return this.active; }

  private stamp(cx: number, cy: number): void {
    const radius = this.state.size / 2;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.doc.width - 1, Math.ceil(cx + radius));
    const y1 = Math.min(this.doc.height - 1, Math.ceil(cy + radius));
    const w = this.doc.width;
    const px = this.doc.pixels;
    const colorIndex = this.state.colorIndex;
    const mode = this.state.eraseMode;
    const writeValue = mode === 'off' ? colorIndex : BACKGROUND_INDEX;
    const selectedOnly = mode === 'selected';

    let touched = false;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      const dy2 = dy * dy;
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy2 <= r2) {
          const i = row + x;
          if (selectedOnly) {
            if (px[i] === colorIndex) { px[i] = BACKGROUND_INDEX; touched = true; }
          } else {
            px[i] = writeValue;
            touched = true;
          }
        }
      }
    }
    if (touched) this.growDirty(x0, y0, x1 + 1, y1 + 1);
  }

  private stampLine(x0: number, y0: number, x1: number, y1: number): void {
    // Step at sub-radius increments so consecutive stamps overlap.
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, this.state.size / 4);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.stamp(x0 + dx * t, y0 + dy * t);
    }
  }

  private growDirty(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.dirty) {
      this.dirty = { x0, y0, x1, y1 };
    } else {
      if (x0 < this.dirty.x0) this.dirty.x0 = x0;
      if (y0 < this.dirty.y0) this.dirty.y0 = y0;
      if (x1 > this.dirty.x1) this.dirty.x1 = x1;
      if (y1 > this.dirty.y1) this.dirty.y1 = y1;
    }
  }

  private flush(): void {
    if (!this.dirty) return;
    const { x0, y0, x1, y1 } = this.dirty;
    this.renderer.renderRect(x0, y0, x1 - x0, y1 - y0);
    this.dirty = null;
  }
}
