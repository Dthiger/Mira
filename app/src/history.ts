import type { MaskDocument } from './document.ts';

/**
 * Snapshot-based undo/redo. Each entry is a full copy of the pixel buffer.
 * For 1024² docs that's ~1 MB per snapshot — fine for ~50 steps of history.
 *
 * Snapshots are pushed when a stroke begins (capturing pre-stroke state),
 * so undo restores the state from before the stroke.
 */
export class History {
  private readonly doc: MaskDocument;
  private readonly limit: number;
  private undoStack: Uint8Array[] = [];
  private redoStack: Uint8Array[] = [];
  private onChange: () => void = () => {};

  constructor(doc: MaskDocument, limit = 50) {
    this.doc = doc;
    this.limit = limit;
  }

  setOnChange(cb: () => void): void { this.onChange = cb; }

  /** Push the current document state onto the undo stack. */
  commit(): void {
    this.undoStack.push(this.doc.snapshot());
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.doc.snapshot());
    this.doc.restore(prev);
    this.onChange();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.doc.snapshot());
    this.doc.restore(next);
    this.onChange();
    return true;
  }
}
