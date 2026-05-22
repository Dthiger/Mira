/**
 * Material Symbols SVG path data, inlined so the UI works offline and ships
 * no external requests. All icons share a 0 0 24 24 viewBox and currentColor.
 */
export type IconName =
  | 'brush'
  | 'lasso'
  | 'bucket'
  | 'eraser'
  | 'eraser-selected'
  | 'fit'
  | 'download'
  | 'save'
  | 'open'
  | 'distance'
  | 'image'
  | 'undo'
  | 'redo'
  | 'help';

const PATHS: Record<IconName, string> = {
  // Special-cased in icon() to overlay + and - badges; empty here.
  brush: '',
  // Material "format_color_fill" - tipped bucket with a paint drop and underline
  bucket:
    'M16.56 8.94 7.62 0 6.21 1.41l2.38 2.38L3.44 8.94c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10 10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.33-2-3.5-2-3.5zM2 20h20v3H2v-3z',
  // Material "ink_eraser" - tilted eraser body with a baseline underline
  eraser:
    'M15.14 3c-.51 0-1.02.2-1.41.59L2.59 14.73c-.78.78-.78 2.05 0 2.83L5.03 20H12l8.41-8.41c.78-.79.78-2.05 0-2.84L16.55 3.59c-.39-.39-.9-.59-1.41-.59zM10.05 18 4.07 12.05l5.65-5.66 5.95 5.96L10.05 18zM21 19v2H7v-2h14z',
  // Special-cased in icon() with the eraser path + a target badge.
  'eraser-selected': '',
  // Custom dashed lasso loop with a short tail
  lasso: '',
  fit:
    'M3 5v4h2V5h4V3H5c-1.1 0-2 .9-2 2zm2 10H3v4c0 1.1.9 2 2 2h4v-2H5v-4zm14 4h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zm0-16h-4v2h4v4h2V5c0-1.1-.9-2-2-2z',
  download:
    'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  // Material "save" - classic floppy disk
  save:
    'M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z',
  // Material "folder_open" - folder with raised lid for the Load action
  open:
    'M20 18H4V8h16v10zM20 6h-8l-2-2H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2z',
  // Three concentric circles - distance field / spread metaphor
  distance: '',
  image:
    'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
  undo:
    'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  redo:
    'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z',
  // Material "help_outline" - circled question mark
  help:
    'M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z',
};

export function icon(name: IconName, size = 18): string {
  if (name === 'brush') {
    // Brush + a "+" badge top-left and a "-" badge bottom-right, signalling
    // the brush can both add (paint) and subtract (erase via Ctrl).
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="M7 14c-1.66 0-3 1.34-3 3 0 1.31-1.16 2-2 2 .92 1.22 2.49 2 4 2 2.21 0 4-1.79 4-4 0-1.66-1.34-3-3-3zm13.71-9.37l-1.34-1.34c-.39-.39-1.02-.39-1.41 0L9 12.25 11.75 15l8.96-8.96c.39-.39.39-1.02 0-1.41z"/><path d="M0 3h6M3 0v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18 21h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }
  if (name === 'lasso') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="10" rx="8" ry="6" stroke-dasharray="2 2"/><path d="M14 15.5 L 12 21"/></svg>`;
  }
  if (name === 'distance') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="9.5" opacity="0.55"/></svg>`;
  }
  if (name === 'eraser-selected') {
    // Eraser body + a small target ring badge so the "this color only"
    // variant is distinguishable from the generic eraser at a glance.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${PATHS.eraser}"/><circle cx="19.5" cy="4.5" r="3" fill="var(--topbar-bg, #ffffff)" stroke="currentColor" stroke-width="1.5"/><circle cx="19.5" cy="4.5" r="1.1" fill="currentColor" stroke="none"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
}
