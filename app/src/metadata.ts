import { BACKGROUND_INDEX, PALETTE } from './palette.ts';
import type { MaskDocument } from './document.ts';

/**
 * Sidecar metadata describing a mask export. Designed for downstream
 * pipelines that need to know what IDs are present in a file without
 * having to scan its pixels.
 */
export interface MaskMetadata {
  schema: 'mira-mask-metadata';
  version: 1;
  exportedAt: string;
  image: {
    filename: string;
    width: number;
    height: number;
  };
  palette: {
    /** Total palette size (always 25 in current spec). */
    size: number;
    /** Pixel value that represents background. */
    backgroundIndex: number;
  };
  ids: {
    /** Number of distinct palette indices that appear in the document. */
    count: number;
    /** Sorted list of 0-based indices present (e.g. [3, 11, 16]). */
    present: number[];
    /** Sorted list of human-facing labels present (e.g. ["004", "012", "017"]). */
    labels: string[];
    /** Per-id breakdown with color, name, and pixel coverage. */
    entries: Array<{
      index: number;
      label: string;
      name: string;
      r: number;
      g: number;
      b: number;
      pixelCount: number;
    }>;
  };
  background: {
    pixelCount: number;
  };
}

export function computeMaskMetadata(doc: MaskDocument, filename: string): MaskMetadata {
  const counts = new Uint32Array(256);
  const px = doc.pixels;
  for (let i = 0; i < px.length; i++) counts[px[i]]++;

  const entries: MaskMetadata['ids']['entries'] = [];
  const present: number[] = [];
  const labels: string[] = [];
  for (const entry of PALETTE) {
    const c = counts[entry.index];
    if (c > 0) {
      present.push(entry.index);
      labels.push(entry.label);
      entries.push({
        index: entry.index,
        label: entry.label,
        name: entry.name,
        r: entry.r,
        g: entry.g,
        b: entry.b,
        pixelCount: c,
      });
    }
  }

  return {
    schema: 'mira-mask-metadata',
    version: 1,
    exportedAt: new Date().toISOString(),
    image: { filename, width: doc.width, height: doc.height },
    palette: { size: PALETTE.length, backgroundIndex: BACKGROUND_INDEX },
    ids: { count: entries.length, present, labels, entries },
    background: { pixelCount: counts[BACKGROUND_INDEX] },
  };
}
