/**
 * 4-connected connected-component labeling for a MaskDocument.
 *
 * Each connected blob of identical palette value becomes one region.
 * Background pixels (BACKGROUND_INDEX) are not assigned a region.
 *
 * Standard two-pass union-find with path compression. Output region labels
 * are compacted to [0, regionCount).
 */

import { BACKGROUND_INDEX } from './palette.ts';
import type { MaskDocument } from './document.ts';

export const NO_REGION = -1;

export interface CclResult {
  /** Per-pixel region index, or NO_REGION for background pixels. */
  regions: Int32Array;
  /** regionPaletteIndex[r] = palette index that region r is filled with. */
  regionPaletteIndex: Uint8Array;
  /** Number of distinct regions. */
  regionCount: number;
}

export function connectedComponents(doc: MaskDocument): CclResult {
  const w = doc.width;
  const h = doc.height;
  const px = doc.pixels;
  const regions = new Int32Array(w * h).fill(NO_REGION);

  const parent: number[] = [];
  const paletteIdx: number[] = [];

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): number {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return ra;
    parent[rb] = ra;
    return ra;
  }

  let nextLabel = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = px[i];
      if (v === BACKGROUND_INDEX) continue;

      const left = x > 0 ? regions[i - 1] : NO_REGION;
      const up = y > 0 ? regions[i - w] : NO_REGION;
      const leftMatches = left !== NO_REGION && paletteIdx[left] === v;
      const upMatches = up !== NO_REGION && paletteIdx[up] === v;

      if (leftMatches && upMatches) {
        regions[i] = union(left, up);
      } else if (leftMatches) {
        regions[i] = left;
      } else if (upMatches) {
        regions[i] = up;
      } else {
        parent.push(nextLabel);
        paletteIdx.push(v);
        regions[i] = nextLabel++;
      }
    }
  }

  // Compact labels and remap.
  const rootToFinal = new Map<number, number>();
  let finalCount = 0;
  const n = regions.length;
  for (let i = 0; i < n; i++) {
    const r = regions[i];
    if (r === NO_REGION) continue;
    const root = find(r);
    let f = rootToFinal.get(root);
    if (f === undefined) {
      f = finalCount++;
      rootToFinal.set(root, f);
    }
    regions[i] = f;
  }

  const finalPaletteIdx = new Uint8Array(finalCount);
  rootToFinal.forEach((final, root) => {
    finalPaletteIdx[final] = paletteIdx[root];
  });

  return { regions, regionPaletteIndex: finalPaletteIdx, regionCount: finalCount };
}
