import { BACKGROUND_INDEX } from './palette.ts';

export class MaskDocument {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(width: number, height: number) {
    if ((width & (width - 1)) !== 0 || (height & (height - 1)) !== 0) {
      throw new Error(`Document dimensions must be powers of 2 (got ${width}x${height})`);
    }
    if (width > 2048 || height > 2048) {
      throw new Error(`Document dimensions cannot exceed 2048 (got ${width}x${height})`);
    }
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
    this.pixels.fill(BACKGROUND_INDEX);
  }

  getIndex(x: number, y: number): number {
    return this.pixels[y * this.width + x];
  }

  setIndex(x: number, y: number, index: number): void {
    this.pixels[y * this.width + x] = index;
  }

  snapshot(): Uint8Array {
    return new Uint8Array(this.pixels);
  }

  restore(snapshot: Uint8Array): void {
    if (snapshot.length !== this.pixels.length) {
      throw new Error(`Snapshot size mismatch: got ${snapshot.length}, expected ${this.pixels.length}`);
    }
    this.pixels.set(snapshot);
  }
}
