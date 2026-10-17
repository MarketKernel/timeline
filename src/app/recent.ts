/**
 * What the browser remembers between visits, in IndexedDB:
 *
 * - recent files: the File System Access handle (never the contents), with what the
 *   start screen shows — title, kind, extent, item count, the cover's small thumb;
 * - recovery drafts: the JSON and the images added since the last save, offered on
 *   the next open when a session ended unsaved and the file could not be written.
 *
 * Every call fails quietly: without IndexedDB (a private window) there is simply
 * nothing to remember.
 */

import type { NewImage } from './images';

export interface RecentFile {
  key: string;
  name: string;
  title: string;
  kind: string;
  /** "4174 BC – present" */
  span: string;
  items: number;
  opened: number;
  handle?: FileSystemFileHandle;
  cover?: Blob;
}

export interface Draft {
  key: string;
  name: string;
  json: string;
  images: [string, NewImage][];
  /** Background music added since the last save. */
  audio?: [string, Blob][];
  saved: number;
}

const DB = 'timeline';
const MAX_RECENT = 12;

/** One connection for the page's life: adding a recent file alone takes a dozen transactions. */
let connection: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  connection ??= connect();
  return connection;
}

function connect(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('recent')) db.createObjectStore('recent', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('misc')) db.createObjectStore('misc', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        // A newer page in another tab upgrades the database: this one lets go, and connects again when it next needs to.
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        db.onclose = () => (connection = null);
        resolve(db);
      };
      request.onerror = () => {
        connection = null;
        resolve(null);
      };
      request.onblocked = () => {
        connection = null;
        resolve(null);
      };
    } catch {
      connection = null;
      resolve(null);
    }
  });
}

async function run<T>(store: 'recent' | 'drafts' | 'misc', mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, mode);
      const request = body(tx.objectStore(store));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = tx.onabort = () => resolve(undefined);
    } catch (error) {
      // The connection has gone (the browser closed it): the next call opens another. Any other error was this call's own.
      if ((error as DOMException).name === 'InvalidStateError') connection = null;
      resolve(undefined);
    }
  });
}

export async function listRecent(): Promise<RecentFile[]> {
  const all = ((await run('recent', 'readonly', (s) => s.getAll())) ?? []) as RecentFile[];
  return all.sort((a, b) => b.opened - a.opened);
}

export async function addRecent(file: RecentFile): Promise<void> {
  await run('recent', 'readwrite', (s) => void s.put(file));
  const all = await listRecent();
  for (const old of all.slice(MAX_RECENT)) await run('recent', 'readwrite', (s) => void s.delete(old.key));
}

export async function removeRecent(key: string): Promise<void> {
  await run('recent', 'readwrite', (s) => void s.delete(key));
}

export async function saveDraft(draft: Draft): Promise<void> {
  await run('drafts', 'readwrite', (s) => void s.put(draft));
}

export async function loadDraft(key: string): Promise<Draft | undefined> {
  return (await run('drafts', 'readonly', (s) => s.get(key))) as Draft | undefined;
}

export async function dropDraft(key: string): Promise<void> {
  await run('drafts', 'readwrite', (s) => void s.delete(key));
}

/** Asks for permission to a remembered handle (needs a click on Chromium). */
export async function permitted(handle: FileSystemFileHandle, write = false): Promise<boolean> {
  const mode = { mode: write ? 'readwrite' : 'read' } as const;
  const h = handle as FileSystemFileHandle & {
    queryPermission?: (d: typeof mode) => Promise<PermissionState>;
    requestPermission?: (d: typeof mode) => Promise<PermissionState>;
  };
  try {
    if ((await h.queryPermission?.(mode)) === 'granted') return true;
    return (await h.requestPermission?.(mode)) === 'granted';
  } catch {
    return false;
  }
}

/** The library file the image picker opened last ("Image from…"), by handle. */
export async function lastLibrary(): Promise<FileSystemFileHandle | undefined> {
  const row = (await run('misc', 'readonly', (s) => s.get('library'))) as { handle?: FileSystemFileHandle } | undefined;
  return row?.handle;
}

export async function rememberLibrary(handle: FileSystemFileHandle): Promise<void> {
  await run('misc', 'readwrite', (s) => void s.put({ key: 'library', handle }));
}
