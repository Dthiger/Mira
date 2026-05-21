export interface PaletteEntry {
  index: number;
  r: number;
  g: number;
  b: number;
  /** Zero-padded numeric label, e.g. "001". */
  label: string;
  /** Human-readable tissue name. "unnamed" until real names land. */
  name: string;
}

export const BACKGROUND_INDEX = 255;

/**
 * Erase-mode state shared by all drawing tools:
 *   'off'      - paint with the active color (default)
 *   'all'      - any touched pixel becomes background
 *   'selected' - only pixels whose value already equals the active palette
 *                index become background; other pixels are untouched
 */
export type EraseMode = 'off' | 'all' | 'selected';

const STOPS = [25, 76, 128, 179, 230] as const;

function buildPalette(): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  for (let row = 0; row < 5; row++) {
    const g = STOPS[4 - row];
    for (let col = 0; col < 5; col++) {
      const r = STOPS[4 - col];
      entries.push({
        index: row * 5 + col,
        r,
        g,
        b: 0,
        label: '', // Assigned below in sorted order.
        name: 'unnamed',
      });
    }
  }
  // Sort by green channel (desc), tiebreak by red channel (asc) so the list
  // runs pure-green -> yellow within each green band, with bands going from
  // brightest at the top to darkest at the bottom. Result: 001 = (25,230,0)
  // pure green, 025 = (230,25,0) pure red. `index` is preserved so existing
  // documents still resolve to the right color.
  entries.sort((a, b) => (b.g - a.g) || (a.r - b.r));
  for (let i = 0; i < entries.length; i++) {
    entries[i].label = String(i + 1).padStart(3, '0');
  }
  return entries;
}

export const PALETTE: readonly PaletteEntry[] = Object.freeze(buildPalette());

/**
 * O(1) lookup of palette entries by their stable internal `index` field.
 * Required because PALETTE is sorted by label (so `PALETTE[i]` does NOT
 * return the entry whose `entry.index === i`).
 */
export const PALETTE_BY_INDEX: ReadonlyMap<number, PaletteEntry> = (() => {
  const m = new Map<number, PaletteEntry>();
  for (const entry of PALETTE) m.set(entry.index, entry);
  return m;
})();

export function paletteHex(entry: PaletteEntry): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(entry.r)}${h(entry.g)}${h(entry.b)}`;
}
