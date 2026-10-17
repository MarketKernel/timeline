/**
 * Opening and saving .timeline files (Task §3, §6).
 *
 * Opening reads the zip's directory and timeline.json — never the images.
 * Saving writes a new zip as a stream: the JSON fresh, every image entry the
 * document still uses copied byte for byte from the open file, new images
 * appended, unused ones dropped — the background music the same — anything
 * else the zip carried kept as it was.
 * Into the same file through File System Access where the browser has it;
 * otherwise a download (and on iOS the share sheet, "Save to Files").
 */

import { t } from '../core/i18n';
import { missingImages, parseDoc, serializeDoc, usedImages, type Doc, type Warning } from '../core/model';
import { blobSource, isJunk, openZip, rootPrefix, ZipError, ZipWriter, type Sink, type ZipArchive } from '../core/zip';
import { ImageStore } from './images';

export interface Opened {
  doc: Doc;
  warnings: Warning[];
  archive: ZipArchive | null;
  prefix: string;
  name: string;
  file: File;
}

export class FileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileError';
  }
}

const encoder = new TextEncoder();

/** Reads a .timeline (or a bare timeline.json, an author's convenience). */
export async function readTimeline(file: File): Promise<Opened> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  let json: unknown;
  let archive: ZipArchive | null = null;
  let prefix = '';
  if (isZip) {
    try {
      archive = await openZip(blobSource(file));
    } catch (error) {
      if (error instanceof ZipError) {
        throw new FileError(
          error.code === 'truncated'
            ? t('files', 'The file is cut short — it may not have finished copying.')
            : error.code === 'zip64'
              ? t('files', 'The file is over 4 GB, which a timeline cannot be.')
              : t('files', 'This is not a timeline file.'),
        );
      }
      throw error;
    }
    prefix = rootPrefix(archive.entries.map((entry) => entry.name));
    const entry = archive.get(`${prefix}timeline.json`);
    if (!entry) throw new FileError(t('files', 'This zip has no timeline.json inside: it is not a timeline.'));
    try {
      json = JSON.parse(await archive.text(entry));
    } catch (error) {
      throw new FileError(error instanceof ZipError ? t('files', 'timeline.json in this file is damaged.') : t('files', 'timeline.json in this file is not valid JSON.'));
    }
  } else {
    try {
      json = JSON.parse(await file.text());
    } catch {
      throw new FileError(t('files', 'This is not a timeline file.'));
    }
  }
  let parsed;
  try {
    parsed = parseDoc(json);
  } catch (error) {
    throw new FileError((error as Error).message);
  }
  const { doc, warnings } = parsed;
  const zip = archive;
  warnings.push(...missingImages(doc, (hash, info) => !!zip?.has(`${prefix}images/${hash}.${info.ext}`)));
  if (doc.music && !zip?.has(`${prefix}audio/${doc.music.file}.${doc.music.ext}`)) {
    warnings.push({ path: 'music', code: 'music-missing', text: t('files', 'The background music is not in the file.') });
  }
  return { doc, warnings, archive, prefix, name: file.name, file };
}

/** The entries of the open file that a save carries over as they are: not timeline.json, not image files. */
function foreignEntries(archive: ZipArchive, prefix: string): string[] {
  return archive.entries
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(prefix) && !isJunk(name))
    .map((name) => name.slice(prefix.length))
    .filter((name, i, all) => name !== 'timeline.json' && !/^(thumbs|images|audio)\/[^/]+$/.test(name) && all.indexOf(name) === i);
}

export interface SaveResult {
  bytes: number;
  /** Image files left out because nothing refers to them any more. */
  dropped: number;
}

/** Writes the document as a .timeline into `sink`. `doc.meta.modified` is set by the caller. */
export async function writeTimeline(doc: Doc, store: ImageStore, archive: ZipArchive | null, prefix: string, sink: Sink): Promise<SaveResult> {
  const writer = new ZipWriter(sink);
  const used = [...usedImages(doc)].filter((hash) => doc.images[hash]).sort();
  // The file lists only the pictures it holds; the document in memory keeps the rest for undo.
  const written = { ...doc, images: Object.fromEntries(used.map((hash) => [hash, doc.images[hash]!])) };
  await writer.add('timeline.json', encoder.encode(serializeDoc(written)));
  for (const hash of used) {
    const ext = doc.images[hash]!.ext;
    const fresh = store.added.get(hash);
    for (const [name, blob] of [
      [`thumbs/${hash}.webp`, fresh?.thumb],
      [`images/${hash}.${ext}`, fresh?.image],
    ] as const) {
      const old = archive?.get(prefix + name);
      if (old && archive) {
        // Byte for byte: no re-encoding, no re-hashing.
        await writer.addRaw({ ...old, name }, await archive.raw(old));
      } else if (blob) {
        await writer.add(name, new Uint8Array(await blob.arrayBuffer()), false);
      }
    }
  }
  // The music, stored as it is: it is compressed already.
  if (doc.music) {
    const name = `audio/${doc.music.file}.${doc.music.ext}`;
    const old = archive?.get(prefix + name);
    const fresh = store.addedAudio.get(doc.music.file);
    if (old && archive) await writer.addRaw({ ...old, name }, await archive.raw(old));
    else if (fresh) await writer.add(name, new Uint8Array(await fresh.arrayBuffer()), false);
  }
  let dropped = 0;
  if (archive) {
    for (const name of foreignEntries(archive, prefix)) {
      const entry = archive.get(prefix + name)!;
      await writer.addRaw({ ...entry, name }, await archive.raw(entry));
    }
    const kept = new Set(used);
    dropped = archive.entries.filter((e) => {
      const match = /^images\/([0-9a-f]+)\.\w+$/.exec(e.name.slice(prefix.length));
      return e.name.startsWith(prefix) && match && !kept.has(match[1]!);
    }).length;
  }
  const bytes = await writer.finish();
  return { bytes, dropped };
}

/** Writes into a Blob in memory: downloads and the recovery path. */
export async function timelineBlob(doc: Doc, store: ImageStore, archive: ZipArchive | null, prefix: string): Promise<{ blob: Blob; result: SaveResult }> {
  const parts: BlobPart[] = [];
  const result = await writeTimeline(doc, store, archive, prefix, (chunk) => void parts.push(chunk as Uint8Array<ArrayBuffer>));
  return { blob: new Blob(parts, { type: 'application/zip' }), result };
}

/** Writes through a File System Access handle: a swap file the browser commits on close. */
export async function saveToHandle(handle: FileSystemFileHandle, doc: Doc, store: ImageStore, archive: ZipArchive | null, prefix: string): Promise<SaveResult> {
  const writable = await handle.createWritable();
  try {
    // Chunks are gathered into ~1 MB writes: one small write per zip header would be slow.
    let batch: Uint8Array[] = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      await writable.write(new Blob(batch as Uint8Array<ArrayBuffer>[]));
      batch = [];
      size = 0;
    };
    const result = await writeTimeline(doc, store, archive, prefix, async (chunk) => {
      batch.push(chunk);
      size += chunk.length;
      if (size > 1 << 20) await flush();
    });
    await flush();
    await writable.close();
    return result;
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

/** A safe file name from a title: "The Bible" → "the-bible.en.timeline". */
export function fileNameFor(doc: Doc): string {
  const base = doc.meta.id && doc.meta.id !== 'untitled' ? doc.meta.id : 'timeline';
  return `${base.replace(/[^A-Za-z0-9._-]+/g, '-')}.timeline`;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** iOS has no downloads folder: "Share → Save to Files". True if the share sheet took it. */
export async function shareFile(blob: Blob, name: string): Promise<boolean> {
  const file = new File([blob], name, { type: 'application/zip' });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file] });
    return true;
  } catch {
    return false;
  }
}

export const canSaveInPlace = (): boolean => typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export const PICKER_TYPES = [{ description: 'Timeline', accept: { 'application/zip': ['.timeline'] as `.${string}`[] } }];
