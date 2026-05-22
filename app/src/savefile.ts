/**
 * Mira state save / load.
 *
 * The state file is a plain PNG that visually shows the painted mask
 * (palette colors on a black background) - so it previews correctly in
 * any image viewer. On load Mira reverse-maps each pixel's RGB to its
 * palette index and repopulates the document buffer.
 *
 * Limitations:
 *   - Dimensions must match the active document on load (throws otherwise).
 *   - Pixels whose RGB is not in the palette nor pure black become background
 *     and are counted in the returned `unknownPixelCount` for reporting.
 */

import { BACKGROUND_INDEX } from './palette.ts';
import { RGB_BY_INDEX, INDEX_BY_RGB } from './paletteRgb.ts';
import type { MaskDocument } from './document.ts';

export async function encodeSaveFile(doc: MaskDocument): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not acquire 2d context for save encode');
  ctx.imageSmoothingEnabled = false;

  const img = ctx.createImageData(doc.width, doc.height);
  const buf = img.data;
  for (let i = 0; i < doc.pixels.length; i++) {
    const rgb = RGB_BY_INDEX.get(doc.pixels[i]) ?? [0, 0, 0];
    const o = i * 4;
    buf[o] = rgb[0];
    buf[o + 1] = rgb[1];
    buf[o + 2] = rgb[2];
    buf[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('canvas.toBlob returned null'));
      else resolve(blob);
    }, 'image/png');
  });
}

export interface LoadResult {
  unknownPixelCount: number;
}

export async function loadSaveFile(blob: Blob, doc: MaskDocument): Promise<LoadResult> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width !== doc.width || bitmap.height !== doc.height) {
      throw new Error(
        `Save file dimensions (${bitmap.width}×${bitmap.height}) don't match the ` +
        `current document (${doc.width}×${doc.height}).`,
      );
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not acquire 2d context for save decode');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const data = img.data;

    const px = doc.pixels;
    let unknown = 0;
    for (let i = 0; i < px.length; i++) {
      const o = i * 4;
      const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
      const idx = INDEX_BY_RGB.get(key);
      if (idx === undefined) {
        unknown++;
        px[i] = BACKGROUND_INDEX;
      } else {
        px[i] = idx;
      }
    }
    return { unknownPixelCount: unknown };
  } finally {
    bitmap.close?.();
  }
}
