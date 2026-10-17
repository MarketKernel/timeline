/**
 * What the page's modules share: the settings, the open session, the strip,
 * and a small event bus so modules talk without importing each other in circles.
 */

import type { History } from '../core/commands';
import type { Doc } from '../core/model';
import type { ZipArchive } from '../core/zip';
import type { ImageStore } from './images';
import type { Minimap } from './minimap';
import { loadSettings } from './settings';
import type { Strip } from './view';

export interface Session {
  doc: Doc;
  history: History;
  store: ImageStore;
  archive: ZipArchive | null;
  prefix: string;
  name: string;
  handle: FileSystemFileHandle | null;
  /** Opened from the shelf: the server's copy is read-only, Save is Save as. */
  remote: boolean;
}

export const app = {
  settings: loadSettings(),
  session: null as Session | null,
  strip: null as unknown as Strip,
  minimap: null as unknown as Minimap,
  /** Set while a file is being opened or saved: a second one waits. */
  busy: false,
  /** Edit mode: outside it nothing moves by accident. */
  editing: false,
  /** An exported page: one timeline, opened at once, to read and never to edit or save. */
  readOnly: false,
};

type Events = {
  opened: void;
  closed: void;
  saved: void;
  /** The document changed (an edit, an undo, a restored draft). */
  changed: void;
  select: string | null;
  open: string;
  settings: void;
  editing: boolean;
  language: void;
  /** The start screen is shown: the recent files and the shelf are drawn again. */
  start: void;
  /** "Count years from here" on an item. */
  anchor: string;
  /** The PWA's update state changed. */
  update: void;
};

const listeners = new Map<keyof Events, Set<(value: never) => void>>();

export function on<K extends keyof Events>(name: K, listener: (value: Events[K]) => void): () => void {
  let set = listeners.get(name);
  if (!set) listeners.set(name, (set = new Set()));
  set.add(listener as (value: never) => void);
  return () => set!.delete(listener as (value: never) => void);
}

export function emit<K extends keyof Events>(name: K, ...[value]: Events[K] extends void ? [] : [Events[K]]): void {
  for (const listener of listeners.get(name) ?? []) (listener as (value: Events[K] | undefined) => void)(value);
  // The tests wait on these.
  window.dispatchEvent(new CustomEvent(`timeline:${name}`, { detail: value }));
}
