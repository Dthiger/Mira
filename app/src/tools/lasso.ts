import type { MaskDocument } from '../document.ts';
import type { PaintRenderer } from '../renderer.ts';

export interface LassoState {
  colorIndex: number;
}

export interface Point { x: number; y: number; }

/**
 * Lasso shape tool.
 *
 * - Each click adds a control point.
 * - Click-drag adds intermediate points along the drag path (distance-throttled).
 * - The control points are interpolated by a closed Catmull-Rom spline,
 *   then sampled and rasterized with a scanline even-odd fill.
 * - Commit by clicking near the first point, double-clicking, or pressing
 *   Enter. Escape cancels. The OUTLINE is smooth; the FILL has hard pixel
 *   edges (no antialiasing).
 *
 * The tool maintains its own preview rendered on the overlay canvas;
 * commit writes pixels into the document.
 */
export class LassoTool {
  private readonly doc: MaskDocument;
  private readonly renderer: PaintRenderer;
  private readonly state: LassoState;
  /** Called whenever the lasso's points / dragging state changes so the
   *  host can re-render the preview. The lasso itself does not own any
   *  rendering — preview drawing happens in main.ts (screen-space SVG). */
  private readonly onStateChange: () => void;
  private points: Point[] = [];
  private dragging = false;
  private readonly closeRadius = 8;

  constructor(
    doc: MaskDocument,
    renderer: PaintRenderer,
    state: LassoState,
    onStateChange: () => void,
  ) {
    this.doc = doc;
    this.renderer = renderer;
    this.state = state;
    this.onStateChange = onStateChange;
  }

  isActive(): boolean { return this.points.length > 0; }

  pointerDown(x: number, y: number): void {
    if (this.points.length >= 2 && distance(this.points[0], { x, y }) <= this.closeRadius) {
      this.commit();
      return;
    }
    this.points.push({ x, y });
    this.dragging = true;
    this.onStateChange();
  }

  pointerMove(x: number, y: number): void {
    if (!this.dragging || this.points.length === 0) return;
    const last = this.points[this.points.length - 1];
    if (distance(last, { x, y }) >= 4) {
      this.points.push({ x, y });
      this.onStateChange();
    }
  }

  pointerUp(): void {
    this.dragging = false;
  }

  doubleClick(): void {
    if (this.points.length >= 3) this.commit();
  }

  cancel(): void {
    this.points = [];
    this.dragging = false;
    this.onStateChange();
  }

  // -- Preview state accessors (rendering happens in main.ts so the
  //    preview can live outside the doc-sized overlay canvas). --

  /** Doc-space samples of the spline through the current control points. */
  getPreviewSamples(stepsPerSegment = 16): readonly Point[] {
    if (this.points.length === 0) return [];
    return sampleClosedCatmullRom(this.points, stepsPerSegment);
  }

  /** Current control points in click order (doc-space). */
  getControlPoints(): readonly Point[] {
    return this.points;
  }

  /** True once a preview has at least 3 points (the polygon is closeable). */
  isCloseable(): boolean {
    return this.points.length >= 3;
  }

  /** Close-radius indicator center (first point) or null. */
  getCloseIndicator(): Point | null {
    return this.points.length >= 2 ? this.points[0] : null;
  }

  /** Doc-space close radius (hit-test) - the indicator is drawn at this size. */
  getCloseRadius(): number {
    return this.closeRadius;
  }

  private commit(): void {
    if (this.points.length < 3) {
      this.cancel();
      return;
    }
    const cleaned = cleanupControlPoints(this.points);
    if (cleaned.length < 3) {
      this.cancel();
      return;
    }
    const polygon = sampleClosedCatmullRom(cleaned, 24);
    fillPolygon(this.doc, polygon, this.state.colorIndex);
    const bounds = polygonBounds(polygon, this.doc.width, this.doc.height);
    if (bounds) {
      this.renderer.renderRect(bounds.x0, bounds.y0, bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
    }
    this.points = [];
    this.dragging = false;
    this.onStateChange();
  }
}

/**
 * Pre-process control points before fitting the spline so the resulting
 * curve doesn't pick up sharp cusps from clustered or noisy clicks:
 *   1. Drop consecutive points closer than MIN_DIST (and any tail points
 *      that crowd the start, which happens when the user drags into the
 *      closing hot-spot).
 *   2. Apply two passes of 1-2-1 smoothing around the closed loop. This
 *      shifts each point toward the local average and softens spikes
 *      without rounding off the overall silhouette.
 */
function cleanupControlPoints(points: Point[]): Point[] {
  const MIN_DIST = 6;
  const decimated: Point[] = [];
  for (const p of points) {
    if (decimated.length === 0) { decimated.push(p); continue; }
    if (distance(decimated[decimated.length - 1], p) >= MIN_DIST) decimated.push(p);
  }
  // Trim tail points that crowd the start (closed-loop view).
  while (decimated.length >= 4 && distance(decimated[decimated.length - 1], decimated[0]) < MIN_DIST) {
    decimated.pop();
  }
  if (decimated.length < 3) return decimated;
  return smoothClosed(decimated, 2);
}

function smoothClosed(points: Point[], passes: number): Point[] {
  let pts = points;
  for (let pass = 0; pass < passes; pass++) {
    const n = pts.length;
    const next: Point[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const nxt = pts[(i + 1) % n];
      next[i] = {
        x: (prev.x + 2 * cur.x + nxt.x) * 0.25,
        y: (prev.y + 2 * cur.y + nxt.y) * 0.25,
      };
    }
    pts = next;
  }
  return pts;
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Centripetal Catmull-Rom (alpha = 0.5). Parameterizes by sqrt-chord-length
 * which kills the loops and cusps the uniform variant produces when control
 * points are unevenly spaced - exactly the situation a hand-drawn lasso
 * creates near the closing click. Same per-sample cost as uniform.
 */
function sampleClosedCatmullRom(points: Point[], stepsPerSegment: number): Point[] {
  const n = points.length;
  if (n < 2) return points.slice();
  if (n === 2) return points.slice();
  const ALPHA = 0.5;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    const t0 = 0;
    const t1 = t0 + Math.max(1e-6, Math.pow(distance(p0, p1), ALPHA));
    const t2 = t1 + Math.max(1e-6, Math.pow(distance(p1, p2), ALPHA));
    const t3 = t2 + Math.max(1e-6, Math.pow(distance(p2, p3), ALPHA));

    for (let s = 0; s < stepsPerSegment; s++) {
      const t = t1 + (t2 - t1) * (s / stepsPerSegment);
      out.push(centripetalCR(p0, p1, p2, p3, t, t0, t1, t2, t3));
    }
  }
  return out;
}

function centripetalCR(
  p0: Point, p1: Point, p2: Point, p3: Point,
  t: number, t0: number, t1: number, t2: number, t3: number,
): Point {
  const lx = (a: number, b: number, ta: number, tb: number): number =>
    (a * (tb - t) + b * (t - ta)) / (tb - ta);
  const a1x = lx(p0.x, p1.x, t0, t1);
  const a1y = lx(p0.y, p1.y, t0, t1);
  const a2x = lx(p1.x, p2.x, t1, t2);
  const a2y = lx(p1.y, p2.y, t1, t2);
  const a3x = lx(p2.x, p3.x, t2, t3);
  const a3y = lx(p2.y, p3.y, t2, t3);
  const b1x = lx(a1x, a2x, t0, t2);
  const b1y = lx(a1y, a2y, t0, t2);
  const b2x = lx(a2x, a3x, t1, t3);
  const b2y = lx(a2y, a3y, t1, t3);
  const cx = lx(b1x, b2x, t1, t2);
  const cy = lx(b1y, b2y, t1, t2);
  return { x: cx, y: cy };
}

/**
 * Even-odd scanline polygon fill. Pixel (x, y) is set if the polygon
 * (treated as a closed loop) contains the pixel center (x + 0.5, y + 0.5).
 * Hard edges: every pixel is fully on or fully off.
 */
function fillPolygon(doc: MaskDocument, polygon: Point[], colorIndex: number): void {
  if (polygon.length < 3) return;
  const w = doc.width;
  const h = doc.height;
  const px = doc.pixels;

  let yMin = Infinity, yMax = -Infinity;
  for (const p of polygon) {
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  const yStart = Math.max(0, Math.floor(yMin));
  const yEnd = Math.min(h - 1, Math.ceil(yMax));

  for (let y = yStart; y <= yEnd; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j];
      const b = polygon[i];
      const ay = a.y, by = b.y;
      if ((ay > yc) !== (by > yc)) {
        const x = a.x + ((yc - ay) / (by - ay)) * (b.x - a.x);
        xs.push(x);
      }
    }
    if (xs.length < 2) continue;
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.floor(xs[k] + 0.5));
      const x1 = Math.min(w - 1, Math.ceil(xs[k + 1] - 0.5));
      const row = y * w;
      for (let x = x0; x <= x1; x++) px[row + x] = colorIndex;
    }
  }
}

function polygonBounds(polygon: Point[], w: number, h: number):
  { x0: number; y0: number; x1: number; y1: number } | null {
  if (polygon.length === 0) return null;
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const p of polygon) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  const x0 = Math.max(0, Math.floor(xMin) - 1);
  const y0 = Math.max(0, Math.floor(yMin) - 1);
  const x1 = Math.min(w, Math.ceil(xMax) + 1);
  const y1 = Math.min(h, Math.ceil(yMax) + 1);
  if (x0 >= x1 || y0 >= y1) return null;
  return { x0, y0, x1, y1 };
}
