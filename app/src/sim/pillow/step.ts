/**
 * Per-tick simulation step for pillow mode. Pure Verlet integration with
 * Jakobsen-style constraint relaxation: positions are the only state we
 * carry, velocity is the difference between current and previous positions.
 *
 * Phase 2 of the spec: drag force + springs + pins + soft containment.
 * Inter-body collision lands in Phase 3.
 */

import type { SimWorld } from './types.ts';

const DAMPING = 0.85;
const CONSTRAINT_ITERS = 8;

export interface DragForce {
  /** Current cursor position in doc-space. */
  cursorX: number;
  cursorY: number;
  /** Cursor position on the previous frame. */
  prevX: number;
  prevY: number;
  /** Falloff radius in doc-px. */
  radius: number;
  /** [0..1] - 1 makes vertices follow the cursor exactly. */
  strength: number;
}

export interface StepOptions {
  /** Current global stiffness multiplier (slider value). */
  stiffness: number;
  /** Active drag or null. */
  drag: DragForce | null;
  /** Document width / height for containment. */
  docW: number;
  docH: number;
}

export function stepPillow(world: SimWorld, dt: number, opts: StepOptions): void {
  world.globalTime += dt;
  applyDrag(world, opts.drag);
  integrate(world);
  for (let iter = 0; iter < CONSTRAINT_ITERS; iter++) {
    relaxSprings(world, opts.stiffness);
    enforcePins(world);
    enforceContainment(world, opts.docW, opts.docH);
  }
  updateCentroids(world);
}

function applyDrag(world: SimWorld, drag: DragForce | null): void {
  if (!drag) return;
  const dx = drag.cursorX - drag.prevX;
  const dy = drag.cursorY - drag.prevY;
  if (dx === 0 && dy === 0) return;
  const r2 = drag.radius * drag.radius;
  for (const body of world.bodies) {
    for (const v of body.vertices) {
      if (v.pinned) continue;
      const ddx = v.px - drag.cursorX;
      const ddy = v.py - drag.cursorY;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 > r2) continue;
      // smoothstep falloff from 1 at center to 0 at radius
      const t = 1 - Math.sqrt(d2) / drag.radius;
      const falloff = t * t * (3 - 2 * t);
      const w = falloff * drag.strength;
      v.px += dx * w;
      v.py += dy * w;
    }
  }
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

function enforceContainment(world: SimWorld, docW: number, docH: number): void {
  for (const body of world.bodies) {
    for (const v of body.vertices) {
      if (v.pinned) continue;
      if (v.px < 0) v.px = -v.px * 0.5;
      else if (v.px > docW) v.px = docW - (v.px - docW) * 0.5;
      if (v.py < 0) v.py = -v.py * 0.5;
      else if (v.py > docH) v.py = docH - (v.py - docH) * 0.5;
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
