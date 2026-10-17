/**
 * Reading a .timeline: the zip, the folder it may sit in, timeline.json, the
 * model's checks, and the pictures and music the document names but the file
 * lacks. The page (files.ts) and tools/check.mjs read through this one path,
 * so the checker reports exactly what a reader would be warned of.
 */

import { t } from './i18n';
import { missingImages, parseDoc, type Doc, type Warning } from './model';
import { openZip, rootPrefix, ZipError, type Source, type ZipArchive } from './zip';

/**
 * Why a file did not open. The message is plain English for the checker; the
 * page says it in the reader's language by the code.
 */
export type ReadErrorCode = 'not-zip' | 'truncated' | 'zip64' | 'no-json' | 'json-damaged' | 'json-invalid' | 'model';

export class ReadError extends Error {
  constructor(
    readonly code: ReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReadError';
  }
}

export interface ReadDoc {
  doc: Doc;
  warnings: Warning[];
}

/** The pictures and the music a document names but `has` (a path as the zip has it: `images/….webp`) cannot find. */
export function mediaWarnings(doc: Doc, has: (path: string) => boolean): Warning[] {
  const warnings = missingImages(doc, (hash, info) => has(`images/${hash}.${info.ext}`));
  if (doc.music && !has(`audio/${doc.music.file}.${doc.music.ext}`)) {
    warnings.push({ path: 'music', code: 'music-missing', text: t('files', 'The background music is not in the file.') });
  }
  return warnings;
}

/** A parsed timeline.json, checked by the model and against the media `has` finds. */
export function readDoc(json: unknown, has: (path: string) => boolean): ReadDoc {
  let parsed: ReadDoc;
  try {
    parsed = parseDoc(json);
  } catch (error) {
    throw new ReadError('model', (error as Error).message);
  }
  parsed.warnings.push(...mediaWarnings(parsed.doc, has));
  return parsed;
}

/** Opens a .timeline zip: its timeline.json at the top, or in a single top folder (a zip made by hand). */
export async function readArchive(source: Source): Promise<ReadDoc & { archive: ZipArchive; prefix: string }> {
  let archive: ZipArchive;
  try {
    archive = await openZip(source);
  } catch (error) {
    if (error instanceof ZipError) throw new ReadError(error.code === 'truncated' || error.code === 'zip64' ? error.code : 'not-zip', error.message);
    throw error;
  }
  const prefix = rootPrefix(archive.entries.map((entry) => entry.name));
  const entry = archive.get(`${prefix}timeline.json`);
  if (!entry) throw new ReadError('no-json', 'no timeline.json at the top (or in a single top folder)');
  let json: unknown;
  try {
    json = JSON.parse(await archive.text(entry));
  } catch (error) {
    throw new ReadError(error instanceof ZipError ? 'json-damaged' : 'json-invalid', (error as Error).message);
  }
  return { ...readDoc(json, (path) => archive.has(prefix + path)), archive, prefix };
}
