# Mira app — architecture & contribution rules

This file is loaded automatically when an agent works inside `app/`. Read it
before making changes; the rules here are load-bearing — breaking them is
how subtle bugs and slow renders sneak in.

## What this app is

In-browser tool for painting **indexed ID masks** (1024×1024 by default).
Each pixel is one of 26 values: palette indices 0–24, or 255 = background.
The output is consumed by a 3D pipeline as a tissue ID map. **No
antialiasing anywhere**: every pixel must be exactly one palette color or
background. Soft edges break downstream lookups.

## Hard invariants — these never change without explicit user approval

1. **Doc dimensions must be powers of 2, ≤ 2048.** `MaskDocument` enforces
   this in its constructor.
2. **No antialiasing.** Every brush/lasso/bucket op writes integer
   palette indices. Canvas contexts set `imageSmoothingEnabled = false`.
   Lasso outline can be a smooth spline, but the filled pixels are
   hard-edged via the scanline algorithm.
3. **Pixel buffer is `Uint8Array` of palette indices.** Never store RGB
   in the doc; always go via `palette.ts` / `paletteRgb.ts` to render.
4. **Background = `BACKGROUND_INDEX` (255), never `0`.** Index 0 is a
   real palette entry. Pure black `(0,0,0)` is reserved for background;
   it never appears as a palette color (the palette uses stops
   `{25, 76, 128, 179, 230}` so the darkest palette color is `(25,25,0)`
   and stays distinguishable from background black).
5. **The 25-color palette is fixed and sorted by green channel** in
   `palette.ts`. `index` field is the stable internal identifier (used in
   the pixel buffer); `label` is the human-facing "001"–"025" sorted
   such that 001 is pure green and 025 is pure red.
6. **Reverse-lookup `PALETTE` by `entry.index`, not by array position.**
   `PALETTE[i]` returns the `i`-th sorted entry, NOT the entry with
   `entry.index === i`. Use `PALETTE_BY_INDEX.get(i)` for that.
7. **Erase tools share the brush engine.** `brush`, `erase-all`, and
   `erase-selected` all dispatch to the same `BrushTool` instance —
   only `brushState.eraseMode` differs. See `BRUSH_SHAPED_TOOLS` /
   `isBrushShaped()` in `state.ts`.

## Module layout & import direction

Strict one-way layering — circular imports must not exist.

```
dom.ts ─┐
state.ts ┘← (also imports palette/document/renderer/history/tools)
   │
   ▼
paletteRgb.ts (leaf), palette.ts (leaf), document.ts, history.ts,
renderer.ts, ccl.ts, jfa.ts, savefile.ts, distfill.ts, metadata.ts,
icons.ts, tools/*.ts
   │
   ▼
viewport.ts (imports dom, state)
   │
   ▼
ui/cursors.ts, ui/lassoPreview.ts, ui/sizePopover.ts,
ui/colorPicker.ts, ui/statusBar.ts (import dom, state; cursors before
sizePopover because sizePopover.setBrushSize calls updateBrushCursor)
   │
   ▼
redraw.ts (composes ui/* update fns)
   │
   ▼
toolManager.ts (imports state, dom, ui/cursors, ui/sizePopover, redraw)
   │
   ▼
events.ts (imports everything above to dispatch)
   │
   ▼
main.ts (bootstrap; only file that touches every concern)
```

**Tools (`tools/brush.ts`, `tools/lasso.ts`, `tools/bucket.ts`) are
leaves.** They take `MaskDocument` + `PaintRenderer` + a state object in
their constructors. They MUST NOT import from `state.ts`, `dom.ts`, or
any UI module — keep them DOM-free so they're testable in isolation and
reusable in future headless contexts (e.g. a Node CLI for batch
processing).

## State ownership

`state.ts` exports a `state` object plus singleton instances. Each field
on `state` has an owner module commented inline. Reads happen anywhere;
writes are convention-gated:

| Field            | Owner             | Why it can change                       |
|------------------|-------------------|-----------------------------------------|
| `scale`, `tx`, `ty` | `viewport.ts`   | Pan, zoom, fit-to-view                  |
| `activeTool`     | `toolManager.ts`  | Tool switch (button click or keyboard)  |
| `cursorX/Y`      | `events.ts`       | Pointermove                             |
| `dragMode`       | `events.ts`       | Pointerdown / pointerup                 |
| `ctrlHeld`       | `events.ts`       | Keydown / keyup / blur                  |
| `lassoWasActive` | `events.ts`       | Lasso state-change callback             |

If you need a new mutable shared field, add it to `state` with an owner
comment. Don't sprinkle module-scoped `let` exports — they're a pain to
trace and TDZ-prone.

## Where to put things

| You want to… | Put it in |
|---|---|
| Change pan/zoom/fit math | `viewport.ts` |
| Add a tool that paints pixels | new file in `tools/`, constructor takes (doc, renderer, state) |
| Show something at the cursor | `ui/cursors.ts` (extend `updateCursorGlyph` / add new SVG) |
| Show something tied to the doc state | `ui/statusBar.ts` (add new readout) or its own `ui/*.ts` module |
| Render a screen-space overlay | new `ui/*.ts`; mirror `lassoPreview.ts` pattern (SVG, doc→screen via `state.scale`+`state.tx`+`state.ty`) |
| Add a keyboard shortcut | `events.ts` keydown handler. Use the `k = evt.key.length === 1 ? toLowerCase() : evt.key` pattern. |
| Add a toolbar button | `index.html` + handler in `main.ts` (non-tool buttons) or `toolManager.ts` (tool selectors) |
| Add a new file format | new module mirroring `savefile.ts` / `distfill.ts`. RGB lookups go through `paletteRgb.ts`. |
| Read all palette indices used in the doc | `refreshUsedIdsStatus` in `ui/statusBar.ts` — but only call it from **discrete doc-changing events**, never from `pointermove`. |

## Performance rules

The hot loops are: brush stamp, scanline polygon fill, bucket flood, JFA
passes, renderer's per-pixel ImageData write. **Don't add allocations or
Map lookups in those loops** — pre-compute outside, then index a typed
array inside. The renderer's `RGBA_TABLE` (`paletteRgb.PAINT_RGBA`) is
the canonical pattern: 256×4 `Uint8Array` indexed by `palette_index * 4`.

Things that have already been optimized — don't regress them:

- **`stageRect` is cached in `viewport.ts`**, refreshed on resize/scroll
  only. **Do not call `stageEl.getBoundingClientRect()` from pointer
  event handlers** — use `getStageRect()` or `eventToDoc()`.
- **`refreshUsedIdsStatus` walks 1M pixels**; cost ~5 ms. **Never call it
  from `pointermove`.** Discrete events only: stroke end, lasso commit/
  cancel, bucket apply, undo, redo, initial load.
- **`toolButtons` and `colorOptions` are cached NodeLists.** Iterate
  them; don't `document.querySelectorAll('.tool-btn')` per call.
- **Lasso preview redraws on every pointermove** (cheap SVG attribute
  updates) but the spline math is O(N points × samples-per-segment).
  Keep `stepsPerSegment` ≤ 16 for the preview, 24 for the commit
  rasterization.
- **`setBrushSize` calls only `updateBrushCursor`**, not the full
  `redrawOverlay`. The size circle is the only thing that depends on
  size; lasso preview and status bar are unaffected.

## TypeScript conventions

- `erasableSyntaxOnly: true` is on in `tsconfig.json`. **No
  parameter-property shorthand** in constructors — declare fields and
  assign explicitly.
- `noUnusedLocals` is on. Don't import what you don't use.
- Use the `$` helper in `dom.ts` for new element refs — it throws on
  missing IDs so we don't get cryptic null-deref errors at runtime.
- Prefer `readonly` arrays and `ReadonlyMap` for shared lookup tables.

## CSS conventions

- Use the existing CSS custom properties (`--accent`, `--teal`,
  `--topbar-bg`, etc.) — don't hard-code colors.
- Topbar wraps at narrow widths (`flex-wrap: wrap`); test layouts at
  720 px width before declaring done.
- When toggling visibility via `element.hidden = true`, ensure the CSS
  rule isn't overriding with an explicit `display: flex/block/grid`.
  If it is, add an `.element[hidden] { display: none; }` rule
  (see the `.size-popover[hidden]` precedent — that bug burned us
  before).

## Verifying changes

Before claiming a change is done:

1. `npx tsc --noEmit` from `app/` must pass.
2. For UI changes: take a headless screenshot at `720×900` AND `1920×900`
   and inspect both. The pattern is in the `Mira/` parent directory's
   commit history (search for `msedge --headless --screenshot`).
3. If you touched anything inside the hot loops listed above, paint a
   large brush stroke and verify it stays at ~60 fps in DevTools
   Performance.

## Things parked / out of scope

These were discussed and explicitly **not** built — don't add them
without asking:

- File System Access API for in-place save (we use download/upload for
  now)
- Micro-cleanup tool ("kill regions < N pixels") — CCL in `ccl.ts` would
  be the foundation if/when this lands
- ID-label overlay on each shape
- Batch processing pipeline / Node CLI
- Flowmap export

## Hard "don'ts"

- **Don't** add antialiasing anywhere. No `imageSmoothingEnabled = true`,
  no soft brushes, no alpha-blending into the doc buffer.
- **Don't** introduce a new mutable global outside `state.ts`.
- **Don't** put DOM lookups (`document.querySelector(…)`) inside event
  handlers or render loops. Put them in `dom.ts` and import.
- **Don't** use `getBoundingClientRect()` in `pointermove` — use the
  cached rect.
- **Don't** make `tools/*.ts` import anything from `state.ts`, `dom.ts`,
  or `ui/*`. Tools are pure data transforms.
- **Don't** treat `PALETTE` as if it were indexed by the internal
  `index` field — it's sorted by `label`. Use `PALETTE_BY_INDEX`.
- **Don't** rebuild the entire dropdown / popup DOM when only an
  attribute changed — toggle classes / attributes instead.
- **Don't** commit `.autosave/` or `*_backup.sbs` files (already
  gitignored, just don't force-add them).
