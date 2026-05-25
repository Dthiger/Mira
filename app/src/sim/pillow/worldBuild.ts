/**
 * Build a `SimWorld` from the current document. Each connected region of
 * identical palette value (CCL) becomes a `SimBody` with a POLAR-SHELL mesh
 * topology: a single center vertex, K concentric rings of N vertices each
 * arranged angularly around the centroid, and triangle faces connecting
 * adjacent rings (plus a fan from the center to the innermost ring).
 *
 * Why polar shell over Delaunay or grid:
 *   - Looks intentional, like contour rings on a topographic map.
 *   - Spring lengths are uniform within each ring -> consistent stiffness
 *     under uniform pressure (a real squishy ball deforms in rings).
 *   - Radial spokes give shear resistance from the center outward.
 *
 * Mathematical caveat: this is correct ONLY for star-shaped regions (every
 * boundary point is visible from the centroid). Strongly concave shapes
 * may produce overlapping triangles where rays cross concave bays. For
 * painted blobs (usually convex-ish) this is fine.
 *
 * Regions under MIN_BODY_PIXELS are skipped; they pass through bake
 * unchanged.
 */

import { connectedComponents, NO_REGION } from '../../ccl.ts';
import type { MaskDocument } from '../../document.ts';
import type { SimWorld, SimBody, SimVertex, SimEdge, SimTriangle } from './types.ts';

const MIN_BODY_PIXELS = 20;
const BOUNDARY_VERTEX_SPACING = 4;           // doc-px between simplified boundary verts (the polygon rays are cast against)
const SLICE_ARC_TARGET = 8;                  // doc-px target arc length between adjacent ring verts — controls boundary smoothness after bake
const RING_RADIAL_TARGET = 26;               // doc-px target distance between adjacent rings
const K_EDGE = 0.5; // softer springs — body should squish and ooze, not snap back

export function buildPillowWorld(doc: MaskDocument): SimWorld {
  const { regions, regionPaletteIndex, regionCount } = connectedComponents(doc);
  const w = doc.width;
  const h = doc.height;

  const bodies: SimBody[] = [];

  const regionPixelCount = new Uint32Array(regionCount);
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (r !== NO_REGION) regionPixelCount[r]++;
  }

  for (let r = 0; r < regionCount; r++) {
    if (regionPixelCount[r] < MIN_BODY_PIXELS) continue;
    const body = buildBodyForRegion(r, regions, regionPaletteIndex[r], w, h, bodies.length);
    if (body) bodies.push(body);
  }

  return { bodies, globalTime: 0 };
}

function buildBodyForRegion(
  regionId: number,
  regions: Int32Array,
  paletteIndex: number,
  w: number,
  h: number,
  bodyIndex: number,
): SimBody | null {
  // 1. Topmost-leftmost pixel of the region.
  let startX = -1, startY = -1;
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (regions[y * w + x] === regionId) { startX = x; startY = y; break outer; }
    }
  }
  if (startX < 0) return null;

  // 2. Trace + simplify the boundary. The boundary polygon is only used
  //    to compute ray hit distances for the polar shell; it doesn't appear
  //    in the mesh directly.
  const raw = traceBoundary(regions, regionId, startX, startY, w, h);
  if (raw.length < 3) return null;
  const simplified = simplifyByDistance(raw, BOUNDARY_VERTEX_SPACING);
  if (simplified.length < 3) return null;

  // 3. Centroid of the simplified polygon (area-weighted).
  const { cx, cy } = polygonCentroid(simplified);

  // 4. Estimate body radius with a coarse 8-direction ray probe. Used to
  //    pick mesh density (N slices, K rings).
  let coarseAvg = 0;
  for (let s = 0; s < 8; s++) {
    const theta = (s / 8) * Math.PI * 2;
    coarseAvg += rayBoundaryDistance(simplified, cx, cy, Math.cos(theta), Math.sin(theta));
  }
  coarseAvg /= 8;
  if (coarseAvg < 4) return null;

  const N_SLICES = clamp(Math.round((2 * Math.PI * coarseAvg) / SLICE_ARC_TARGET), 16, 96);
  const K_RINGS = clamp(Math.round(coarseAvg / RING_RADIAL_TARGET), 2, 6);

  // 5. Resample boundary ray distances at the final N_SLICES.
  const dists = new Float64Array(N_SLICES);
  for (let s = 0; s < N_SLICES; s++) {
    const theta = (s / N_SLICES) * Math.PI * 2;
    dists[s] = rayBoundaryDistance(simplified, cx, cy, Math.cos(theta), Math.sin(theta));
  }

  // 6. Build vertices: a single center vert + K rings of N verts each.
  const vertices: SimVertex[] = [];
  const centerIdx = vertices.length;
  vertices.push(makeVertex(cx, cy, false, bodyIndex));

  const ringIdx: number[][] = [];
  for (let k = 1; k <= K_RINGS; k++) {
    const t = k / K_RINGS;
    const ring: number[] = [];
    for (let s = 0; s < N_SLICES; s++) {
      const theta = (s / N_SLICES) * Math.PI * 2;
      const r = dists[s] * t;
      const x = cx + Math.cos(theta) * r;
      const y = cy + Math.sin(theta) * r;
      // No auto-pinning at the doc edge: bodies should be free to float
      // into the expanded buffer area (see enforceContainment in step.ts).
      // Shape matching + containment together keep them stable.
      ring.push(vertices.length);
      vertices.push(makeVertex(x, y, false, bodyIndex));
    }
    ringIdx.push(ring);
  }

  // 7. Triangulate. Center fan -> innermost ring, then quad strips between
  //    each adjacent ring pair (split into 2 triangles per quad).
  const triangles: SimTriangle[] = [];
  for (let s = 0; s < N_SLICES; s++) {
    const a = ringIdx[0][s];
    const b = ringIdx[0][(s + 1) % N_SLICES];
    triangles.push({ v0: centerIdx, v1: a, v2: b });
  }
  for (let k = 0; k < K_RINGS - 1; k++) {
    for (let s = 0; s < N_SLICES; s++) {
      const a = ringIdx[k][s];
      const b = ringIdx[k][(s + 1) % N_SLICES];
      const c = ringIdx[k + 1][(s + 1) % N_SLICES];
      const d = ringIdx[k + 1][s];
      triangles.push({ v0: a, v1: b, v2: c });
      triangles.push({ v0: a, v1: c, v2: d });
    }
  }

  // 8. Spring edges = triangle edges. No random diagonals needed; the
  //    radial spokes already provide shear resistance.
  const edgeSet = new Map<string, SimEdge>();
  for (const t of triangles) {
    addEdge(edgeSet, vertices, t.v0, t.v1, K_EDGE);
    addEdge(edgeSet, vertices, t.v1, t.v2, K_EDGE);
    addEdge(edgeSet, vertices, t.v2, t.v0, K_EDGE);
  }
  const edges: SimEdge[] = Array.from(edgeSet.values());

  // 9. Centroid (recompute from final verts for the SimBody's stored value).
  let ccx = 0, ccy = 0;
  for (const v of vertices) { ccx += v.px; ccy += v.py; }
  ccx /= vertices.length;
  ccy /= vertices.length;

  // 10. Outer ring = closed boundary polygon for inter-body collision.
  const boundaryIndices = ringIdx[K_RINGS - 1].slice();

  return {
    paletteIndex,
    vertices,
    edges,
    triangles,
    boundaryIndices,
    centroid: { x: ccx, y: ccy },
  };
}

function makeVertex(x: number, y: number, pinned: boolean, bodyIndex: number): SimVertex {
  return {
    px: x, py: y,
    qx: x, qy: y,
    rx: x, ry: y,
    pinned,
    bodyIndex,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------- Boundary tracing ----------

interface PointF { x: number; y: number; }

function traceBoundary(
  regions: Int32Array,
  regionId: number,
  startX: number,
  startY: number,
  w: number,
  h: number,
): PointF[] {
  const pts: PointF[] = [];
  const isIn = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && regions[y * w + x] === regionId;

  // 8-direction Moore-neighbor trace. Encoding: 0=E, 1=SE, 2=S, 3=SW,
  // 4=W, 5=NW, 6=N, 7=NE. Increment = CW in screen coords (y down).
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  let cx = startX, cy = startY;
  let prevDir = 4; // came from west
  const maxIter = w * h * 4;
  let iter = 0;

  // At each step look at the 8 neighbors starting one step CW of the
  // "back" direction (where we came from) and stepping CW. The first IN
  // neighbor is the next boundary pixel.
  do {
    pts.push({ x: cx + 0.5, y: cy + 0.5 });
    let found = false;
    for (let i = 0; i < 8; i++) {
      const dir = (prevDir + 1 + i) % 8;
      const nx = cx + dx[dir];
      const ny = cy + dy[dir];
      if (isIn(nx, ny)) {
        prevDir = (dir + 4) % 8;
        cx = nx; cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
    iter++;
  } while (!(cx === startX && cy === startY) && iter < maxIter);

  return pts;
}

// ---------- Polyline helpers ----------

function simplifyByDistance(points: PointF[], minSpacing: number): PointF[] {
  if (points.length < 2) return points.slice();
  const min2 = minSpacing * minSpacing;
  const out: PointF[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = out[out.length - 1];
    const dx = points[i].x - last.x;
    const dy = points[i].y - last.y;
    if (dx * dx + dy * dy >= min2) out.push(points[i]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (dx * dx + dy * dy < min2 && out.length > 3) out.pop();
  return out;
}

function polygonCentroid(poly: PointF[]): { cx: number; cy: number } {
  let cx = 0, cy = 0, area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cross = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    cx += (poly[j].x + poly[i].x) * cross;
    cy += (poly[j].y + poly[i].y) * cross;
    area += cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-9) return { cx: poly[0].x, cy: poly[0].y };
  return { cx: cx / (6 * area), cy: cy / (6 * area) };
}

/** Farthest intersection of the ray (px,py) + t*(dx,dy), t>=0, with the
 *  closed polygon. For star-shaped polygons centered on (px,py) this is
 *  the unique boundary point along the ray. */
function rayBoundaryDistance(
  poly: PointF[],
  px: number, py: number,
  dx: number, dy: number,
): number {
  let maxT = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const ax = poly[i].x, ay = poly[i].y;
    const bx = poly[j].x, by = poly[j].y;
    const sx = bx - ax, sy = by - ay;
    const det = dy * sx - dx * sy;
    if (Math.abs(det) < 1e-9) continue;
    const t = ((ay - py) * sx - (ax - px) * sy) / det;
    const u = (dx * (ay - py) - dy * (ax - px)) / det;
    if (t >= 0 && u >= 0 && u <= 1 && t > maxT) maxT = t;
  }
  return maxT;
}

function addEdge(
  set: Map<string, SimEdge>,
  verts: SimVertex[],
  a: number,
  b: number,
  k: number,
): void {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  if (set.has(key)) return;
  const va = verts[a], vb = verts[b];
  const dx = va.px - vb.px;
  const dy = va.py - vb.py;
  set.set(key, { a, b, restLen: Math.hypot(dx, dy), k });
}
