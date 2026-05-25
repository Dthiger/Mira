/**
 * Per-tick simulation step for pillow mode. Pure Verlet integration with
 * Jakobsen-style constraint relaxation: positions are the only state we
 * carry, velocity is the difference between current and previous positions.
 *
 * Drag is implemented as a per-vertex POSITION CONSTRAINT, not a force.
 * At dragBegin, every vertex inside the drag radius gets an anchor — its
 * offset from the cursor at that moment, plus a smoothstep falloff weight.
 * Each constraint-relaxation iteration, those verts are pulled back toward
 * (cursor + offset) * weight. The springs deform the rest of the body to
 * follow. This makes drag dominant over springs (a force-based push gets
 * almost fully canceled by 8 spring relax iters per frame).
 */

import type { SimWorld, SimVertex, SimBody } from './types.ts';

// "Egg yolks in water" tuning: high viscous damping so bodies don't keep
// drifting, soft springs and slow shape restoration so deformation lingers
// and oozes back, and gentle collision separation so bodies cushion into
// each other rather than snapping apart.
const DAMPING = 0.75;
const CONSTRAINT_ITERS = 8;
const SHAPE_MATCH_STRENGTH = 0.025;
// Per-iter share of the boundary-penetration depth applied to the
// intruding vert. The other (1 - this) is split between the two boundary
// verts of the contacted edge. 0.4 means each side gets ~40% of the
// overlap per iter — over 8 iters the bodies fully separate but the
// approach is gentle.
const COLLISION_PUSH_FRACTION = 0.4;

export interface DragAnchor {
  bodyIdx: number;
  vertIdx: number;
  /** Vertex position relative to the cursor at dragBegin time. Target
   *  each frame is (cursor + offset). */
  offsetX: number;
  offsetY: number;
  /** Smoothstep falloff weight in [0, dragStrength]. 1 means hard-pin
   *  to (cursor + offset); near-zero means barely follow. */
  weight: number;
}

export interface DragInput {
  cursorX: number;
  cursorY: number;
  anchors: DragAnchor[];
}

export interface StepOptions {
  /** Current global stiffness multiplier (slider value). */
  stiffness: number;
  /** Active drag (cursor + anchors) or null. */
  drag: DragInput | null;
  /** Document width / height for containment. */
  docW: number;
  docH: number;
}

export function stepPillow(world: SimWorld, dt: number, opts: StepOptions): void {
  world.globalTime += dt;
  integrate(world);
  for (let iter = 0; iter < CONSTRAINT_ITERS; iter++) {
    relaxSprings(world, opts.stiffness);
    relaxShapeMatching(world, SHAPE_MATCH_STRENGTH * opts.stiffness);
    enforcePins(world);
    enforceDragAnchors(world, opts.drag);
    resolveCollisions(world);
    enforceContainment(world, opts.docW, opts.docH);
  }
  updateCentroids(world);
}

/** Inter-body vertex-vertex collision. Spatial hash by COLLISION_DIST cells,
 *  test each non-pinned vert against verts in its own cell and the 8
 *  neighbors. Each colliding pair pushes apart by half the overlap.
 *  Same-body pairs are skipped (springs handle those); cross-body pairs
 *  are processed exactly once (only when otherBodyIdx > thisBodyIdx).
 *  Cost: O(N) under reasonable spatial distribution. */
function resolveCollisions(world: SimWorld): void {
  if (world.bodies.length < 2) return;
  for (let b = 0; b < world.bodies.length; b++) {
    const verts = world.bodies[b].vertices;
    for (let vi = 0; vi < verts.length; vi++) {
      const v = verts[vi];
      if (v.pinned) continue;
      for (let ob = 0; ob < world.bodies.length; ob++) {
        if (ob === b) continue;
        const other = world.bodies[ob];
        if (!pointInPolygon(v.px, v.py, other)) continue;
        pushOutOfPolygon(v, other);
      }
    }
  }
}

function pointInPolygon(px: number, py: number, body: SimBody): boolean {
  const verts = body.vertices;
  const bi = body.boundaryIndices;
  const n = bi.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = verts[bi[i]];
    const b = verts[bi[j]];
    if (((a.py > py) !== (b.py > py)) &&
        (px < (b.px - a.px) * (py - a.py) / (b.py - a.py) + a.px)) {
      inside = !inside;
    }
  }
  return inside;
}

function pushOutOfPolygon(v: SimVertex, other: SimBody): void {
  // Find the closest point on `other`'s boundary polygon to v.
  const verts = other.vertices;
  const bi = other.boundaryIndices;
  const n = bi.length;
  let bestDist2 = Infinity;
  let bestCx = 0, bestCy = 0;
  let bestIdx0 = 0, bestIdx1 = 0, bestT = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = verts[bi[i]];
    const b = verts[bi[j]];
    const ex = b.px - a.px;
    const ey = b.py - a.py;
    const lenSq = ex * ex + ey * ey;
    let t = 0;
    if (lenSq > 1e-9) {
      t = ((v.px - a.px) * ex + (v.py - a.py) * ey) / lenSq;
      if (t < 0) t = 0; else if (t > 1) t = 1;
    }
    const cx = a.px + ex * t;
    const cy = a.py + ey * t;
    const dx = v.px - cx;
    const dy = v.py - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestCx = cx; bestCy = cy;
      bestIdx0 = bi[i]; bestIdx1 = bi[j];
      bestT = t;
    }
  }
  const moveX = bestCx - v.px;
  const moveY = bestCy - v.py;
  const dist = Math.hypot(moveX, moveY);
  if (dist < 1e-6) return;
  const nx = moveX / dist;
  const ny = moveY / dist;
  // Half the separation moves v outward; the other half pushes the two
  // boundary verts of the contacted edge inward (barycentric weight).
  const halfMove = dist * COLLISION_PUSH_FRACTION;
  v.px += nx * halfMove;
  v.py += ny * halfMove;
  const e0 = other.vertices[bestIdx0];
  const e1 = other.vertices[bestIdx1];
  const w1 = bestT;
  const w0 = 1 - bestT;
  if (!e0.pinned) {
    e0.px -= nx * halfMove * w0;
    e0.py -= ny * halfMove * w0;
  }
  if (!e1.pinned) {
    e1.px -= nx * halfMove * w1;
    e1.py -= ny * halfMove * w1;
  }
}


/** Müller-style shape matching (2D): find the best translation + rotation
 *  that maps the rest configuration onto the current verts, and nudge each
 *  vert toward its matched target. This is what keeps the body from
 *  tangling — even if local distance constraints settle into an inverted
 *  configuration, this constraint always pulls toward a valid rest shape.
 *
 *  Closed-form optimal 2D rotation: θ = atan2(B, A), where
 *    A = Σ (rx·px + ry·py),  B = Σ (ry·px − rx·py)
 *  for vert positions centered on rest/current centroids respectively.
 *  See Müller et al., "Meshless Deformations Based on Shape Matching" (2005). */
function relaxShapeMatching(world: SimWorld, strength: number): void {
  if (strength <= 0) return;
  for (const body of world.bodies) {
    const verts = body.vertices;
    const n = verts.length;
    if (n < 3) continue;

    // Centroids (current + rest).
    let cx = 0, cy = 0, rcx = 0, rcy = 0;
    for (const v of verts) {
      cx += v.px; cy += v.py;
      rcx += v.rx; rcy += v.ry;
    }
    cx /= n; cy /= n; rcx /= n; rcy /= n;

    // Optimal rotation angle.
    let A = 0, B = 0;
    for (const v of verts) {
      const px = v.px - cx, py = v.py - cy;
      const rx = v.rx - rcx, ry = v.ry - rcy;
      A += rx * px + ry * py;
      B += rx * py - ry * px;
    }
    const inv = 1 / Math.hypot(A, B);
    if (!isFinite(inv)) continue;
    const cosT = A * inv;
    const sinT = B * inv;

    // Target = R(θ) · (rest − rest_centroid) + current_centroid. Blend each
    // vert toward its target by `strength` per iter.
    for (const v of verts) {
      if (v.pinned) continue;
      const rx = v.rx - rcx, ry = v.ry - rcy;
      const tx = cosT * rx - sinT * ry + cx;
      const ty = sinT * rx + cosT * ry + cy;
      v.px += (tx - v.px) * strength;
      v.py += (ty - v.py) * strength;
    }
  }
}

function enforceDragAnchors(world: SimWorld, drag: DragInput | null): void {
  if (!drag) return;
  for (const a of drag.anchors) {
    const v = world.bodies[a.bodyIdx].vertices[a.vertIdx];
    if (v.pinned) continue;
    const targetX = drag.cursorX + a.offsetX;
    const targetY = drag.cursorY + a.offsetY;
    v.px += (targetX - v.px) * a.weight;
    v.py += (targetY - v.py) * a.weight;
  }
}

/** Build anchors for a drag stroke: every non-pinned vertex within `radius`
 *  of `cursor` gets an anchor with the smoothstep falloff weight scaled by
 *  `strength`. Called once at dragBegin. */
export function buildDragAnchors(
  world: SimWorld,
  cursorX: number,
  cursorY: number,
  radius: number,
  strength: number,
): DragAnchor[] {
  const out: DragAnchor[] = [];
  const r2 = radius * radius;
  for (let b = 0; b < world.bodies.length; b++) {
    const body = world.bodies[b];
    for (let i = 0; i < body.vertices.length; i++) {
      const v = body.vertices[i];
      if (v.pinned) continue;
      const ddx = v.px - cursorX;
      const ddy = v.py - cursorY;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 > r2) continue;
      const t = 1 - Math.sqrt(d2) / radius;
      const falloff = t * t * (3 - 2 * t);
      const w = falloff * strength;
      if (w < 1e-3) continue;
      out.push({ bodyIdx: b, vertIdx: i, offsetX: ddx, offsetY: ddy, weight: w });
    }
  }
  return out;
}

function integrate(world: SimWorld): void {
  // Verlet step with damping folded into the previous-position update:
  //   q := p - DAMPING * (p - q)   (damp the implicit velocity)
  //   new_p := 2p - q             (no external acceleration for now)
  //   q := p, p := new_p
  for (const body of world.bodies) {
    for (const v of body.vertices) {
      if (v.pinned) {
        v.qx = v.px; v.qy = v.py;
        continue;
      }
      const dpx = v.px - v.qx;
      const dpy = v.py - v.qy;
      const dampedQx = v.px - DAMPING * dpx;
      const dampedQy = v.py - DAMPING * dpy;
      const newPx = 2 * v.px - dampedQx;
      const newPy = 2 * v.py - dampedQy;
      v.qx = v.px;
      v.qy = v.py;
      v.px = newPx;
      v.py = newPy;
    }
  }
}

function relaxSprings(world: SimWorld, stiffness: number): void {
  for (const body of world.bodies) {
    const verts = body.vertices;
    for (const e of body.edges) {
      const a = verts[e.a];
      const b = verts[e.b];
      const dx = b.px - a.px;
      const dy = b.py - a.py;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) continue;
      // Per-iteration spring constant is k * stiffness * 0.5 so 8 iters
      // converge close to ideal with a stable feel.
      const diff = ((dist - e.restLen) / dist) * e.k * stiffness * 0.5;
      const offX = dx * diff;
      const offY = dy * diff;
      if (!a.pinned) { a.px += offX; a.py += offY; }
      if (!b.pinned) { b.px -= offX; b.py -= offY; }
    }
  }
}

function enforcePins(world: SimWorld): void {
  for (const body of world.bodies) {
    for (const v of body.vertices) {
      if (!v.pinned) continue;
      v.px = v.rx;
      v.py = v.ry;
      v.qx = v.rx;
      v.qy = v.ry;
    }
  }
}

// Containment bounds are 20% larger than the document (10% buffer on each
// side) so painted shapes near the doc edge don't squash up against an
// invisible wall when bumped around.
const CONTAIN_BUFFER = 0.1;
function enforceContainment(world: SimWorld, docW: number, docH: number): void {
  const bufX = docW * CONTAIN_BUFFER;
  const bufY = docH * CONTAIN_BUFFER;
  const loX = -bufX, hiX = docW + bufX;
  const loY = -bufY, hiY = docH + bufY;
  for (const body of world.bodies) {
    for (const v of body.vertices) {
      if (v.pinned) continue;
      // Soft bounce: reflect halfway back across the boundary each iter.
      if (v.px < loX) v.px = loX + (loX - v.px) * 0.5;
      else if (v.px > hiX) v.px = hiX - (v.px - hiX) * 0.5;
      if (v.py < loY) v.py = loY + (loY - v.py) * 0.5;
      else if (v.py > hiY) v.py = hiY - (v.py - hiY) * 0.5;
    }
  }
}

function updateCentroids(world: SimWorld): void {
  for (const body of world.bodies) {
    let cx = 0, cy = 0;
    for (const v of body.vertices) { cx += v.px; cy += v.py; }
    const n = body.vertices.length;
    if (n > 0) {
      body.centroid.x = cx / n;
      body.centroid.y = cy / n;
    }
  }
}

/** Snapshot all vertex positions for the per-stroke undo. */
export function snapshotPositions(world: SimWorld): Float64Array {
  let total = 0;
  for (const body of world.bodies) total += body.vertices.length;
  const out = new Float64Array(total * 2);
  let i = 0;
  for (const body of world.bodies) {
    for (const v of body.vertices) {
      out[i++] = v.px;
      out[i++] = v.py;
    }
  }
  return out;
}

/** Restore a previously snapshotted set of vertex positions. */
export function restorePositions(world: SimWorld, snap: Float64Array): void {
  let i = 0;
  for (const body of world.bodies) {
    for (const v of body.vertices) {
      v.px = snap[i]; v.qx = snap[i]; i++;
      v.py = snap[i]; v.qy = snap[i]; i++;
    }
  }
}

/** Reset to rest positions (the "Reset" button). */
export function resetToRest(world: SimWorld): void {
  for (const body of world.bodies) {
    for (const v of body.vertices) {
      v.px = v.rx; v.py = v.ry;
      v.qx = v.rx; v.qy = v.ry;
    }
  }
}
