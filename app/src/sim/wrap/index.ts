/**
 * Wrap-mode public API. Generates a per-shape contour-band UV map
 * (U sweeps around each shape's perimeter, V sweeps across the band's
 * thickness from shape edge to outer edge) and exports it as a 16-bit
 * RG PNG suitable for driving UV warp / displacement / anisotropy in
 * Substance Designer.
 *
 * Standalone from flow mode — has its own CCL + JFA cache and its own
 * sliders. The two modes do share the FlowField / FlowCache types
 * (purely structural) and the encodeContourUvPng helper.
 */

import type { MaskDocument } from '../../document.ts';
import { buildFlowCache, type FlowCache } from '../flow/build.ts';
import { encodeContourUvPng } from '../flow/encode.ts';
import { buildContourBand, type ContourBandParams, type WrapField } from './build.ts';
import { renderWrapUv } from './render.ts';

const DEFAULTS: ContourBandParams = {
  bandThicknessDoc: 24,
  minRegionPixels: 200,
  innerBand: true,
};
export const params: ContourBandParams = { ...DEFAULTS };
export const exportOptions = { flipY: false };

let docRef: MaskDocument | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let cache: FlowCache | null = null;
let field: WrapField | null = null;
let active = false;

export function wrapIsActive(): boolean { return active; }

export function enterWrap(doc: MaskDocument, simCanvas: HTMLCanvasElement): void {
  if (active) return;
  simCanvas.width = doc.width;
  simCanvas.height = doc.height;
  const c = simCanvas.getContext('2d');
  if (!c) throw new Error('Could not acquire 2d context for sim canvas');
  c.imageSmoothingEnabled = false;
  ctx = c;
  docRef = doc;
  cache = buildFlowCache(doc); // CCL + JFA; same shape as flow's cache
  active = true;
  recompute();
}

export function exitWrap(): void {
  if (!active) return;
  active = false;
  if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx = null;
  docRef = null;
  cache = null;
  field = null;
}

/** Rebuild + repaint. Called by slider edits and on entry. */
export function recompute(): void {
  if (!active || !docRef || !cache || !ctx) return;
  field = buildContourBand(docRef, cache, params);
  renderWrapUv(ctx, field);
}

export function wrapResetParams(): void {
  params.bandThicknessDoc = DEFAULTS.bandThicknessDoc;
  params.minRegionPixels = DEFAULTS.minRegionPixels;
  params.innerBand = DEFAULTS.innerBand;
  recompute();
}

export function getWrapDefaults(): Readonly<ContourBandParams> { return DEFAULTS; }

export async function exportWrap(): Promise<Blob> {
  if (!field) throw new Error('No wrap field — enter wrap mode first');
  return encodeContourUvPng(field, exportOptions);
}
