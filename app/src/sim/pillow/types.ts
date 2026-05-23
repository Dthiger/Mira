/**
 * Pillow-sim data shapes. Shared between worldBuild, step, render, and bake.
 */

export interface SimVertex {
  px: number; py: number;        // current position (doc-space)
  qx: number; qy: number;        // previous position (Verlet)
  rx: number; ry: number;        // rest position (for reset + before-stroke snapshot reference)
  pinned: boolean;
  bodyIndex: number;             // back-reference to owning body
}

export interface SimEdge {
  a: number; b: number;
  restLen: number;
  k: number;
}

export interface SimTriangle {
  v0: number; v1: number; v2: number;
}

export interface SimBody {
  paletteIndex: number;
  vertices: SimVertex[];
  edges: SimEdge[];
  triangles: SimTriangle[];
  centroid: { x: number; y: number };
}

export interface SimWorld {
  bodies: SimBody[];
  globalTime: number;
}
