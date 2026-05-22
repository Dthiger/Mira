/**
 * Lasso preview rendered into a screen-space SVG so the outline + handles
 * + close indicator can extend past the doc bounds (the doc-sized overlay
 * canvas would clip them). Doc-space points are projected to screen coords
 * via the current viewport transform on every redraw.
 */

import {
  lassoSvg, lassoPath, lassoPathHalo, lassoHandles, lassoCloseIndicator,
  SVG_NS,
} from '../dom.ts';
import { state, lasso } from '../state.ts';

export function redrawLassoPreview(): void {
  if (state.activeTool !== 'lasso' || !lasso.isActive()) {
    lassoSvg.style.display = 'none';
    return;
  }
  lassoSvg.style.display = '';

  // Spline path
  const samples = lasso.getPreviewSamples(16);
  let d = '';
  for (let i = 0; i < samples.length; i++) {
    const sx = samples[i].x * state.scale + state.tx;
    const sy = samples[i].y * state.scale + state.ty;
    d += (i === 0 ? 'M' : 'L') + sx.toFixed(1) + ',' + sy.toFixed(1) + ' ';
  }
  if (lasso.isCloseable()) d += 'Z';
  lassoPath.setAttribute('d', d);
  lassoPathHalo.setAttribute('d', d);

  // Control-point handles
  const ctrl = lasso.getControlPoints();
  while (lassoHandles.firstChild) lassoHandles.removeChild(lassoHandles.firstChild);
  for (const p of ctrl) {
    const r = document.createElementNS(SVG_NS, 'rect');
    const sx = p.x * state.scale + state.tx;
    const sy = p.y * state.scale + state.ty;
    r.setAttribute('x', (sx - 3).toFixed(1));
    r.setAttribute('y', (sy - 3).toFixed(1));
    r.setAttribute('width', '6');
    r.setAttribute('height', '6');
    lassoHandles.appendChild(r);
  }

  // Close indicator: blue ring sized to the doc-space close radius so it
  // visually matches the actual hit-test region at any zoom.
  const closeCenter = lasso.getCloseIndicator();
  if (closeCenter) {
    const sx = closeCenter.x * state.scale + state.tx;
    const sy = closeCenter.y * state.scale + state.ty;
    lassoCloseIndicator.setAttribute('cx', sx.toFixed(1));
    lassoCloseIndicator.setAttribute('cy', sy.toFixed(1));
    lassoCloseIndicator.setAttribute('r', (lasso.getCloseRadius() * state.scale).toFixed(1));
    lassoCloseIndicator.setAttribute('visibility', 'visible');
  } else {
    lassoCloseIndicator.setAttribute('visibility', 'hidden');
  }
}
