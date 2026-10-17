/**
 * Every change to a document is a command on an undo stack (Task §6).
 *
 * A command is a list of changes; a change replaces one thing — an item, an
 * image entry or a top-level field — and remembers what
 * was there before, down to an item's place in the list, so undo restores the
 * exact document. A drag is one command: the view previews it live and
 * commits once when the pointer is let go.
 */

import type { Doc, ImageInfo, Item } from './model';

type DocField = 'lang' | 'title' | 'description' | 'sources' | 'author' | 'start' | 'end' | 'cover' | 'anchor' | 'style' | 'music' | 'view' | 'meta';

export type Change =
  | { target: 'item'; id: string; before?: Item; after?: Item; index: number }
  | { target: 'image'; id: string; before?: ImageInfo; after?: ImageInfo }
  | { target: 'doc'; id: DocField; before: unknown; after: unknown };

export interface Command {
  /** What the undo button says: "Move Sputnik", "Delete 3 items". */
  label: string;
  changes: Change[];
}

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

/** A change that makes the item with `id` be `after` (undefined removes it); `before` is read from the doc. */
export function itemChange(doc: Doc, id: string, after: Item | undefined): Change {
  const index = doc.items.findIndex((x) => x.id === id);
  return { target: 'item', id, before: index >= 0 ? clone(doc.items[index]) : undefined, after: clone(after), index: index >= 0 ? index : doc.items.length };
}

export function imageChange(doc: Doc, hash: string, after: ImageInfo | undefined): Change {
  return { target: 'image', id: hash, before: clone(doc.images[hash]), after: clone(after) };
}

export function fieldChange<K extends DocField>(doc: Doc, field: K, after: Doc[K]): Change {
  return { target: 'doc', id: field, before: clone(doc[field]), after: clone(after) };
}

function put(doc: Doc, change: Change, value: unknown): void {
  switch (change.target) {
    case 'item': {
      const list = doc.items;
      const at = list.findIndex((x) => x.id === change.id);
      if (value === undefined) {
        // Where it was at the moment it went: undo, running backwards, puts it back exactly there.
        if (at >= 0) {
          change.index = at;
          list.splice(at, 1);
        }
      } else if (at >= 0) list[at] = clone(value) as Item;
      else list.splice(Math.min(change.index, list.length), 0, clone(value) as Item);
      return;
    }
    case 'image':
      if (value === undefined) delete doc.images[change.id];
      else if (doc.images[change.id]) doc.images[change.id] = clone(value) as ImageInfo;
      else {
        // Images are kept in hash order, so an image put back lands where it was.
        const images = { ...doc.images, [change.id]: clone(value) as ImageInfo };
        doc.images = Object.fromEntries(Object.keys(images).sort().map((hash) => [hash, images[hash]!]));
      }
      return;
    case 'doc':
      if (value === undefined) delete (doc as unknown as Record<string, unknown>)[change.id];
      else (doc as unknown as Record<string, unknown>)[change.id] = clone(value);
  }
}

/** Applies a command forwards, or backwards (in reverse order) to undo it. */
function applyCommand(doc: Doc, command: Command, forward = true): void {
  const changes = forward ? command.changes : [...command.changes].reverse();
  for (const change of changes) put(doc, change, forward ? change.after : change.before);
}

export class History {
  private done: Command[] = [];
  private undone: Command[] = [];
  /** How many commands deep the last save was; -1 when it can no longer be reached. */
  private savedAt = 0;
  private readonly listeners = new Set<(edited: boolean) => void>();

  constructor(
    readonly doc: Doc,
    readonly limit = 100,
  ) {}

  /** `edited` is false when only the saved state changed: the document itself is as it was. */
  onChange(listener: (edited: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(edited = true): void {
    for (const listener of this.listeners) listener(edited);
  }

  /** Applies and records a command; nothing happens for one with no changes. */
  run(command: Command): void {
    if (!command.changes.length) return;
    applyCommand(this.doc, command);
    this.done.push(command);
    if (this.savedAt > this.done.length - 1) this.savedAt = -1;
    this.undone = [];
    if (this.done.length > this.limit) {
      this.done.shift();
      this.savedAt = this.savedAt > 0 ? this.savedAt - 1 : -1;
    }
    this.notify();
  }

  undo(): Command | null {
    const command = this.done.pop();
    if (!command) return null;
    applyCommand(this.doc, command, false);
    this.undone.push(command);
    this.notify();
    return command;
  }

  redo(): Command | null {
    const command = this.undone.pop();
    if (!command) return null;
    applyCommand(this.doc, command);
    this.done.push(command);
    this.notify();
    return command;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** The command undo would take back. */
  get top(): Command | undefined {
    return this.done.at(-1);
  }

  /** The label of what undo would take back. */
  get undoLabel(): string | null {
    return this.top?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.undone.at(-1)?.label ?? null;
  }

  markSaved(): void {
    this.savedAt = this.done.length;
    this.notify(false);
  }

  /** Marks the document as changed though no command was run (a restored draft). */
  markDirty(): void {
    this.savedAt = -1;
    this.notify();
  }

  get dirty(): boolean {
    return this.savedAt !== this.done.length;
  }
}
