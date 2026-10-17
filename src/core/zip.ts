/**
 * The .timeline container: a plain zip, read and written by this file alone.
 *
 * Reading is lazy. Opening reads the end-of-central-directory record and the
 * directory — a few kilobytes at the end of the file — and nothing else; an
 * entry's bytes are read only when asked for, through `Source.read`, which in
 * the browser is `Blob.slice()`. A 200 MB file with five hundred photos opens
 * as fast as an empty one.
 *
 * The reader is tolerant of what other tools write: data descriptors (sizes
 * after the data — the directory has them anyway), `__MACOSX/` and `._` junk,
 * directory entries, a comment at the end. It does not do ZIP64 (4 GB is
 * enough) or encryption, and says so.
 *
 * Writing is a stream of chunks to a sink. New entries are deflated (or
 * stored, when that is smaller); entries carried over from the open file are
 * copied as their raw compressed bytes with their CRC — no re-encoding, no
 * re-hashing. Every entry has the same date, so the same content always makes
 * the same bytes.
 */

import { crc32 } from './hash';

export interface Source {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** A File or any Blob as a Source: each read is a slice. */
export const blobSource = (blob: Blob): Source => ({
  size: blob.size,
  read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
});

/** Bytes in memory as a Source. */
export const bytesSource = (bytes: Uint8Array): Source => ({
  size: bytes.length,
  read: async (offset, length) => bytes.subarray(offset, offset + length),
});

export type ZipErrorCode = 'not-zip' | 'truncated' | 'zip64' | 'encrypted' | 'method' | 'crc';

export class ZipError extends Error {
  constructor(
    readonly code: ZipErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated. */
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  /** Where the local header starts. */
  offset: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const UTF8_FLAG = 0x0800;
/** 1 January 1980, 00:00 — the first date a zip can hold, the same for every entry. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Names to ignore: what Finder and Windows leave in archives they make. */
export const isJunk = (name: string): boolean =>
  name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\._/.test(name) || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(name);

export class ZipArchive {
  readonly entries: ZipEntry[];
  private readonly byName: Map<string, ZipEntry>;

  constructor(
    readonly source: Source,
    entries: ZipEntry[],
  ) {
    this.entries = entries;
    this.byName = new Map(entries.map((entry) => [entry.name, entry]));
  }

  get(name: string): ZipEntry | undefined {
    return this.byName.get(name);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** The entry's bytes as stored: compressed if it was compressed. */
  async raw(entry: ZipEntry): Promise<Uint8Array> {
    const head = await this.source.read(entry.offset, 30);
    if (head.length < 30) throw new ZipError('truncated', `The file is cut short: ${entry.name} is missing`);
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (view.getUint32(0, true) !== SIG_LOCAL) throw new ZipError('not-zip', `Damaged file: no header for ${entry.name}`);
    const start = entry.offset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
    if (start + entry.compressedSize > this.source.size) throw new ZipError('truncated', `The file is cut short: ${entry.name} is incomplete`);
    return this.source.read(start, entry.compressedSize);
  }

  /** The entry's content, inflated and checked against its CRC. */
  async read(entry: ZipEntry): Promise<Uint8Array> {
    if (entry.flags & 1) throw new ZipError('encrypted', `${entry.name} is encrypted`);
    const raw = await this.raw(entry);
    let data: Uint8Array;
    if (entry.method === 0) data = raw;
    else if (entry.method === 8) data = await inflate(raw);
    else throw new ZipError('method', `${entry.name} is compressed with method ${entry.method}, which is not supported`);
    if (data.length !== entry.size || crc32(data) !== entry.crc) throw new ZipError('crc', `${entry.name} is damaged (checksum mismatch)`);
    return data;
  }

  async text(entry: ZipEntry): Promise<string> {
    return decoder.decode(await this.read(entry));
  }
}

/** Reads the directory of a zip; no entry's data is touched. */
export async function openZip(source: Source): Promise<ZipArchive> {
  if (source.size < 22) throw new ZipError('not-zip', 'Not a zip file: too short');
  // The end record is the last 22 bytes plus a comment of at most 65535.
  const tailLength = Math.min(source.size, 22 + 0xffff);
  const tailStart = source.size - tailLength;
  const tail = await source.read(tailStart, tailLength);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === SIG_END && i + 22 + tv.getUint16(i + 20, true) <= tail.length) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    // A zip cut short loses its end first; anything with a local header at the start is one.
    const head = await source.read(0, 4);
    const isZip = head.length === 4 && new DataView(head.buffer, head.byteOffset, 4).getUint32(0, true) === SIG_LOCAL;
    throw isZip ? new ZipError('truncated', 'The file is cut short: its directory is missing') : new ZipError('not-zip', 'Not a zip file');
  }
  const count = tv.getUint16(end + 10, true);
  const dirSize = tv.getUint32(end + 12, true);
  const dirOffset = tv.getUint32(end + 16, true);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) throw new ZipError('zip64', 'ZIP64 archives (over 4 GB) are not supported');
  if (dirOffset + dirSize > tailStart + end) throw new ZipError('truncated', 'The file is cut short or damaged: the directory points past the end');

  const dir = dirOffset >= tailStart ? tail.subarray(dirOffset - tailStart, dirOffset - tailStart + dirSize) : await source.read(dirOffset, dirSize);
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > dir.length || dv.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('not-zip', 'Damaged file: the directory is broken');
    const flags = dv.getUint16(p + 8, true);
    const nameLength = dv.getUint16(p + 28, true);
    const extraLength = dv.getUint16(p + 30, true);
    const commentLength = dv.getUint16(p + 32, true);
    // Without the UTF-8 flag the name is CP437; for the ASCII names here UTF-8 reads it the same.
    const name = decoder.decode(dir.subarray(p + 46, p + 46 + nameLength));
    const entry: ZipEntry = {
      name,
      method: dv.getUint16(p + 10, true),
      flags,
      crc: dv.getUint32(p + 16, true),
      compressedSize: dv.getUint32(p + 20, true),
      size: dv.getUint32(p + 24, true),
      offset: dv.getUint32(p + 42, true),
    };
    if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.offset === 0xffffffff) throw new ZipError('zip64', 'ZIP64 archives (over 4 GB) are not supported');
    if (!isJunk(name)) entries.push(entry);
    p += 46 + nameLength + extraLength + commentLength;
  }
  return new ZipArchive(source, entries);
}

/**
 * A folder that wraps everything: a .timeline unzipped in Finder and zipped
 * again comes back as `bible/timeline.json`, `bible/images/…`. Returns that
 * folder's prefix (`bible/`), or '' when the file is at the top.
 */
export function rootPrefix(names: readonly string[], file = 'timeline.json'): string {
  if (names.includes(file)) return '';
  const found = names.filter((name) => name.endsWith(`/${file}`) && name.split('/').length === 2);
  return found.length === 1 ? found[0]!.slice(0, -file.length) : '';
}

/* ------------------------------------------------------------------ *
 * Compression
 * ------------------------------------------------------------------ */

async function through(data: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const inflate = (data: Uint8Array): Promise<Uint8Array> => through(data, new DecompressionStream('deflate-raw'));
export const deflate = (data: Uint8Array): Promise<Uint8Array> => through(data, new CompressionStream('deflate-raw'));

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export type Sink = (chunk: Uint8Array) => void | Promise<void>;

/** What a header needs to know about an entry. */
export interface EntryHeader {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
}

/** A local file header for `entry`, sizes known up front (no data descriptor). */
export function localHeader(entry: EntryHeader): Uint8Array {
  const name = encoder.encode(entry.name);
  const out = new Uint8Array(30 + name.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, SIG_LOCAL, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, UTF8_FLAG, true);
  v.setUint16(8, entry.method, true);
  v.setUint16(10, DOS_TIME, true);
  v.setUint16(12, DOS_DATE, true);
  v.setUint32(14, entry.crc, true);
  v.setUint32(18, entry.compressedSize, true);
  v.setUint32(22, entry.size, true);
  v.setUint16(26, name.length, true);
  out.set(name, 30);
  return out;
}

export function centralHeader(entry: EntryHeader, offset: number): Uint8Array {
  const name = encoder.encode(entry.name);
  const out = new Uint8Array(46 + name.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, SIG_CENTRAL, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, 20, true);
  v.setUint16(8, UTF8_FLAG, true);
  v.setUint16(10, entry.method, true);
  v.setUint16(12, DOS_TIME, true);
  v.setUint16(14, DOS_DATE, true);
  v.setUint32(16, entry.crc, true);
  v.setUint32(20, entry.compressedSize, true);
  v.setUint32(24, entry.size, true);
  v.setUint16(28, name.length, true);
  v.setUint32(42, offset, true);
  out.set(name, 46);
  return out;
}

export function endRecord(count: number, dirSize: number, dirOffset: number): Uint8Array {
  const out = new Uint8Array(22);
  const v = new DataView(out.buffer);
  v.setUint32(0, SIG_END, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, dirSize, true);
  v.setUint32(16, dirOffset, true);
  return out;
}

const LIMIT = 0xffffffff;

export class ZipWriter {
  private offset = 0;
  private readonly central: Uint8Array[] = [];
  private readonly names = new Set<string>();

  constructor(private readonly sink: Sink) {}

  get count(): number {
    return this.central.length;
  }

  /** A new entry: deflated when `compress` and when that is smaller, else stored. */
  async add(name: string, data: Uint8Array, compress = true): Promise<void> {
    const crc = crc32(data);
    let method = 0;
    let body = data;
    if (compress && data.length > 0) {
      const packed = await deflate(data);
      if (packed.length < data.length) {
        method = 8;
        body = packed;
      }
    }
    await this.addRaw({ name, method, crc, compressedSize: body.length, size: data.length }, body);
  }

  /** An entry as its raw stored bytes — how untouched entries are carried over from the open file. */
  async addRaw(entry: EntryHeader, raw: Uint8Array): Promise<void> {
    if (this.names.has(entry.name)) throw new Error(`Two entries named ${entry.name}`);
    if (raw.length !== entry.compressedSize) throw new Error(`${entry.name}: ${raw.length} bytes given, ${entry.compressedSize} declared`);
    const header = localHeader(entry);
    if (this.offset + header.length + raw.length > LIMIT) throw new ZipError('zip64', 'The file would be over 4 GB, which a .timeline cannot be');
    this.names.add(entry.name);
    this.central.push(centralHeader(entry, this.offset));
    await this.sink(header);
    await this.sink(raw);
    this.offset += header.length + raw.length;
  }

  /** Writes the directory and the end record; returns the total size. */
  async finish(): Promise<number> {
    if (this.central.length >= 0xffff) throw new ZipError('zip64', 'Too many entries for a zip without ZIP64');
    const dirOffset = this.offset;
    let dirSize = 0;
    for (const header of this.central) {
      await this.sink(header);
      dirSize += header.length;
    }
    await this.sink(endRecord(this.central.length, dirSize, dirOffset));
    return dirOffset + dirSize + 22;
  }
}

/** Collects a writer's chunks in memory: tests, downloads, the packer. */
export function memorySink(): { sink: Sink; bytes(): Uint8Array } {
  const chunks: Uint8Array[] = [];
  return {
    sink: (chunk) => void chunks.push(chunk),
    bytes() {
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let p = 0;
      for (const chunk of chunks) {
        out.set(chunk, p);
        p += chunk.length;
      }
      return out;
    },
  };
}
