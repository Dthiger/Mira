/**
 * Jump Flood Algorithm: produces an approximate Euclidean nearest-seed map
 * for every pixel in O(N log N) flood passes.
 *
 * `seedMask[i] = 1` means pixel i is a seed for itself initially.
 * If `filter` is provided, a seed is only valid for a destination when
 * filter(seedIndex, destIndex) returns true. Each pixel's currently cached
 * nearest is re-validated each pass so an initially-seeded pixel can discard
 * its own self-seed when the filter rejects it.
 */

export interface JfaState {
  /** Index of nearest seed for each pixel (or -1 if no valid seed found). */
  nearest: Int32Array;
  /** Squared Euclidean distance from each pixel to its nearest seed. */
  distSq: Float64Array;
}

export function jumpFlood(
  w: number,
  h: number,
  seedMask: Uint8Array,
  filter: ((seedI: number, destI: number) => boolean) | null,
): JfaState {
  const n = w * h;
  const nearest = new Int32Array(n).fill(-1);
  const distSq = new Float64Array(n);
  distSq.fill(Infinity);
  for (let i = 0; i < n; i++) {
    if (seedMask[i]) {
      nearest[i] = i;
      distSq[i] = 0;
    }
  }

  let step = 1;
  while (step < Math.max(w, h)) step <<= 1;
  step >>= 1;

  while (step >= 1) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let bestSeed = nearest[i];
        let bestD = distSq[i];

        if (filter && bestSeed >= 0 && !filter(bestSeed, i)) {
          bestSeed = -1;
          bestD = Infinity;
        }

        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy * step;
          if (ny < 0 || ny >= h) continue;
          const rowOff = ny * w;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx * step;
            if (nx < 0 || nx >= w) continue;
            const candidate = nearest[rowOff + nx];
            if (candidate < 0) continue;
            if (filter && !filter(candidate, i)) continue;
            const sx = candidate % w;
            const sy = (candidate / w) | 0;
            const ddx = x - sx;
            const ddy = y - sy;
            const d = ddx * ddx + ddy * ddy;
            if (d < bestD) {
              bestD = d;
              bestSeed = candidate;
            }
          }
        }

        nearest[i] = bestSeed;
        distSq[i] = bestD;
      }
    }
    step >>= 1;
  }

  return { nearest, distSq };
}
