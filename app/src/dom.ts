/**
 * All DOM element references the app uses, looked up once at module init.
 * Other modules import the named exports rather than running their own
 * querySelector calls.
 */

const $ = <T extends Element>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

export const stageEl = $<HTMLElement>('#stage');
export const stackEl = $<HTMLDivElement>('#canvas-stack');
export const paintCanvas = $<HTMLCanvasElement>('#paint-canvas');
export const overlayCanvas = $<HTMLCanvasElement>('#overlay-canvas');
export const refImg = $<HTMLImageElement>('#ref-img');

export const colorPicker = $<HTMLDivElement>('#color-picker');
export const colorTrigger = $<HTMLButtonElement>('#color-trigger');
export const colorMenu = $<HTMLDivElement>('#color-menu');
export const colorTriggerLabel = $<HTMLSpanElement>('#color-trigger-label');
export const colorSwatch = $<HTMLSpanElement>('#color-swatch');

export const sizeSlider = $<HTMLInputElement>('#size-slider');
export const sizeReadout = $<HTMLSpanElement>('#size-readout');
export const sizePopover = $<HTMLDivElement>('#size-popover');

export const refInput = $<HTMLInputElement>('#ref-input');
export const refOpacity = $<HTMLInputElement>('#ref-opacity');
export const refOpacityReadout = $<HTMLSpanElement>('#ref-opacity-readout');

export const exportDistBtn = $<HTMLButtonElement>('#export-dist-btn');
export const saveBtn = $<HTMLButtonElement>('#save-btn');
export const loadBtn = $<HTMLButtonElement>('#load-btn');
export const loadInput = $<HTMLInputElement>('#load-input');
export const fitBtn = $<HTMLButtonElement>('#fit-btn');
export const undoBtn = $<HTMLButtonElement>('#undo-btn');
export const redoBtn = $<HTMLButtonElement>('#redo-btn');

export const helpBtn = $<HTMLButtonElement>('#help-btn');
export const helpDialog = $<HTMLDialogElement>('#help-dialog');
export const helpClose = $<HTMLButtonElement>('#help-close');

export const zoomReadout = $<HTMLSpanElement>('#zoom-readout');

export const brushCursorSvg = $<SVGSVGElement>('#brush-cursor');
export const brushCursorOuter = $<SVGCircleElement>('#brush-cursor-outer');
export const brushCursorInner = $<SVGCircleElement>('#brush-cursor-inner');
export const cursorGlyph = $<HTMLDivElement>('#cursor-glyph');

export const lassoSvg = $<SVGSVGElement>('#lasso-preview');
export const lassoPath = $<SVGPathElement>('#lasso-path');
export const lassoPathHalo = $<SVGPathElement>('#lasso-path-halo');
export const lassoHandles = $<SVGGElement>('#lasso-handles');
export const lassoCloseIndicator = $<SVGCircleElement>('#lasso-close');

export const statusPos = $<HTMLSpanElement>('#status-pos');
export const statusId = $<HTMLSpanElement>('#status-id');
export const statusSwatch = $<HTMLSpanElement>('#status-swatch');
export const statusUsedCount = $<HTMLSpanElement>('#status-used-count');
export const statusUsedPopup = $<HTMLDivElement>('#status-used-popup');

/** Cached NodeList of tool buttons (static after the topbar is built). */
export const toolButtons: readonly HTMLButtonElement[] = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.tool-btn'),
);

export const SVG_NS = 'http://www.w3.org/2000/svg';
