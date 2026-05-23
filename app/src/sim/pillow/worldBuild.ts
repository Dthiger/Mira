/**
 * Build a `SimWorld` from the current document. Each connected region of
 * identical palette value (CCL) becomes a `SimBody`: a triangle mesh built
 * by tracing the boundary, simplifying, and ear-clipping the polygon, then
 * scattering a few interior vertices and linking everything with springs.
 *
 * Regions under MIN_BODY_PIXELS are skipped (they pass through bake
 * unchanged). Holes inside regions are ignored - a nested region is just
 * another body that happens to lie inside, and the bake z-order draws
 * outer-then-inner so the result matches what the user sees.
 */

import earcut from 'earcut';
import { connectedComponents, NO_REGION } from '../../ccl.ts';
import type { MaskDocument } from '../../document.ts';
import type { SimWorld, SimBody, SimVertex, SimEdge, SimTriangle } from './types.ts';

const MIN_BODY_PIXELS = 20;
const BOUNDARY_VERTEX_SPACING = 4;           // doc-px per simplified boundary vertex
const INTERIOR_VERTEX_AREA_PER = 200;        // doc-px² per interior vertex
const PIN_DIST = 2;                          // canvas-frame pin tolerance
const K_EDGE = 0.8;
const K_DIAG = 0.5;
const DIAG_FRACTION = 0.15;                  // ~15% of vertex pairs get a diagonal

export function buildPillowWorld(doc: MaskDocument): SimWorld {
  const { regions, regionPaletteIndex, regionCount } = connectedComponents(doc);
  const w = doc.width;
  const h = doc.height;

  const bodies: SimBody[] = [];

  // Per-region pixel count to enforce MIN_BODY_PIXELS.
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
  // 1. Find a starting boundary pixel (the topmost-leftmost pixel of the region).
  let startX = -1, startY = -1;
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (regions[y * w + x] === regionId) { startX = x; startY = y; break outer; }
    }
  }
  if (startX < 0) return null;

  // 2. Trace the outer boundary via Moore-neighbor / Theo Pavlidis-style walk.
  //    We use a simple 4-connected outer-boundary follower: at each step look
  //    for the next boundary pixel CCW around the current one.
  const raw = traceBoundary(regions, regionId, startX, startY, w, h);
  if (raw.length < 3) return null;

  // 3. Simplify the polyline to target spacing.
  const simplified = simplifyByDistance(raw, BOUNDARY_VERTEX_SPACING);
  if (simplified.length < 3) return null;

  // 4. Ear-clip triangulate. earcut takes a flat [x0,y0,x1,y1,...] array.
  const flat = new Float64Array(simplified.length * 2);
  for (let i = 0; i < simplified.length; i++) {
    flat[i * 2] = simplified[i].x;
    flat[i * 2 + 1] = simplified[i].y;
  }
  const triIndices = earcut(flat);
  if (triIndices.length === 0) return null;

  // 5. Build vertex array (boundary first; interior vertices appended below).
  const vertices: SimVertex[] = simplified.map((p) => ({
    px: p.x, py: p.y,
    qx: p.x, qy: p.y,
    rx: p.x, ry: p.y,
    pinned:
      p.x <= PIN_DIST || p.x >= w - PIN_DIST ||
      p.y <= PIN_DIST || p.y >= h - PIN_DIST,
    bodyIndex,
  }));

  // 6. Triangles (boundary-only at this point).
  const triangles: SimTriangle[] = [];
  for (let i = 0; i < triIndices.length; i += 3) {
    triangles.push({ v0: triIndices[i], v1: triIndices[i + 1], v2: triIndices[i + 2] });
  }

  // 7. Scatter interior vertices proportional to area.
  const area = polygonArea(simplified);
  const interiorCount = Math.max(0, Math.floor(area / INTERIOR_VERTEX_AREA_PER));
  for (let k = 0; k < interiorCount; k++) {
    const ip = randomInteriorPoint(simplified, regions, regionId, w);
    if (!ip) continue;
    // Find which triangle contains this point and split it into three.
    const triIdx = findContainingTriangle(triangles, vertices, ip.x, ip.y);
    if (triIdx < 0) continue;

    const newIdx = vertices.length;
    vertices.push({
      px: ip.x, py: ip.y,
      qx: ip.x, qy: ip.y,
      rx: ip.x, ry: ip.y,
      pinned: false,
      bodyIndex,
    });
    const tri = triangles[triIdx];
    triangles.splice(triIdx, 1);
    triangles.push({ v0: tri.v0, v1: tri.v1, v2: newIdx });
    triangles.push({ v0: tri.v1, v1: tri.v2, v2: newIdx });
    triangles.push({ v0: tri.v2, v1: tri.v0, v2: newIdx });
  }

  // 8. Spring edges: triangle edges (k_edge) + a fraction of random diagonals.
  const edgeSet = new Map<string, SimEdge>();
  for (const t of triangles) {
    addEdge(edgeSet, vertices, t.v0, t.v1, K_EDGE);
    addEdge(edgeSet, vertices, t.v1, t.v2, K_EDGE);
    addEdge(edgeSet, vertices, t.v2, t.v0, K_EDGE);
  }
  // Random long-range diagonals for shear resistance.
  const targetDiag = Math.floor(vertices.length * DIAG_FRACTION);
  for (let k = 0; k < targetDiag * 3 && edgeSet.size < (vertices.length * (vertices.length - 1)) / 2; k++) {
    const a = (Math.random() * vertices.length) | 0;
    const b = (Math.random() * vertices.length) | 0;
    if (a === b) continue;
    if (Math.abs(a - b) < 3) continue; // skip near-neighbors (already triangle edges typically)
    addEdge(edgeSet, vertices, a, b, K_DIAG);
  }
  const edges: SimEdge[] = Array.from(edgeSet.values());

  // 9. Centroid.
  let cx = 0, cy = 0;
  for (const v of vertices) { cx += v.px; cy += v.py; }
  cx /= vertices.length;
  cy /= vertices.length;

  return {
    paletteIndex,
    vertices,
    edges,
    triangles,
    centroid: { x: cx, y: cy },
  };
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
  // Square-tracing on the pixel grid. We trace the corner-vertex polygon of
  // the region rather than pixel centers, so the boundary aligns with the
  // pixel edges and the polygon area equals the region's pixel count.
  // For simplicity here, we emit pixel-corner vertices in CCW order using a
  // Moore-neighborhood follower starting at the top-left corner of the
  // starting pixel.
  const pts: PointF[] = [];
  const isIn = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && regions[y * w + x] === regionId;

  // 8-directions for Moore-neighbor trace, starting going east (right).
  // We trace pixel-center positions; this is a simpler approximation than
  // corner-tracing and is good enough for the visual mesh.
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  let cx = startX, cy = startY;
  let prevDir = 4; // came from the left (west)
  const maxIter = w * h * 4;
  let iter = 0;

  do {
    pts.push({ x: cx + 0.5, y: cy + 0.5 });
    // Look for the next boundary pixel by checking neighbors CCW from the
    // direction we came in from.
    let found = false;
    for (let i = 0; i < 8; i++) {
      const dir = (prevDir + 6 + i) % 8;        // start checking 90° to the left of incoming
      const nx = cx + dx[dir];
      const ny = cy + dy[dir];
      if (isIn(nx, ny)) {
        // Going from (cx,cy) toward (nx,ny). The "came from" direction is opposite.
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
  // Close the loop if last point is far from first.
  const first = out[0];
  const last = out[out.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (dx * dx + dy * dy < min2 && out.length > 3) out.pop();
  return out;
}

function polygonArea(poly: PointF[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(a) * 0.5;
}

function randomInteriorPoint(
  poly: PointF[],
  regions: Int32Array,
  regionId: number,
  w: number,
): PointF | null {
  // Rejection-sample over the polygon's bbox; reject if the underlying
  // pixel isn't part of this region (handles concave shapes correctly).
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const p of poly) {
    if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
  }
  for (let tries = 0; tries < 40; tries++) {
    const x = xMin + Math.random() * (xMax - xMin);
    const y = yMin + Math.random() * (yMax - yMin);
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0) continue;
    if (regions[yi * w + xi] === regionId) return { x, y };
  }
  return null;
}

function findContainingTriangle(
  tris: SimTriangle[],
  verts: SimVertex[],
  x: number,
  y: number,
): number {
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    const a = verts[t.v0], b = verts[t.v1], c = verts[t.v2];
    if (pointInTriangle(x, y, a.px, a.py, b.px, b.py, c.px, c.py)) return i;
  }
  return -1;
}

function pointInTriangle(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
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
