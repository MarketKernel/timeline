/**
 * Pictures out of the open file (Task §3): read when a card needs one, kept
 * as blob: URLs in a small LRU, revoked when evicted. The whole file never
 * sits in memory — a thumb is a ~6 KB slice of it.
 *
 * Images added in this session (the editor, a paste) live here as Blobs until
 * the next save writes them into the file — and so does the background music
 * (`audio/`), read whole when it is played.
 *
 * A page exported with its pictures in a folder (export.ts) has no zip: its
 * pictures and music are files beside it, shown by their relative URLs.
 */

import { exifDate, type TakenAt } from '../core/exif';
import { contentHash } from '../core/hash';
import type { AudioExt, ImageExt } from '../core/model';
import type { ZipArchive } from '../core/zip';
import type { ImageSource } from './view';

export const MIME: Record<ImageExt, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' };

export const AUDIO_MIME: Record<AudioExt, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg; codecs=opus',
  wav: 'audio/wav',
  webm: 'audio/webm',
  flac: 'audio/flac',
};

/** An image made in this session: both sizes, already encoded. */
export interface NewImage {
  ext: ImageExt;
  thumb: Blob;
  image: Blob;
}

/** An exported page's folder of pictures: where it is, and which of the zip's paths it holds. */
export interface MediaFolder {
  base: string;
  files: ReadonlySet<string>;
}

/** Only a blob: URL is the store's to let go; a file's URL is just a string. */
function revoke(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

interface Cached {
  url: string;
  refs: number;
  used: number;
}

/** How many unreferenced URLs stay decoded before the oldest are let go: thumbs, and large images. */
const SPARE = 120;
const SPARE_LARGE = 16;
/** Large images the details panel and the gallery keep at hand, the last ones looked at. */
const PANEL = 8;

export class ImageStore implements ImageSource {
  readonly added = new Map<string, NewImage>();
  /** Music added in this session, by hash. */
  readonly addedAudio = new Map<string, Blob>();
  /** By key: "t" + hash for a thumb, "l" + hash for a large image. */
  private readonly thumbs = new Map<string, Cached>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly panel: string[] = [];
  private clock = 0;

  constructor(
    private archive: ZipArchive | null,
    private prefix = '',
    private extOf: (hash: string) => ImageExt | undefined = () => 'webp',
    private readonly folder: MediaFolder | null = null,
  ) {}

  /** The URL of a file in the exported page's folder (`images/….webp`), when it is there. */
  linked(path: string): string | null {
    return this.folder?.files.has(path) ? this.folder.base + path : null;
  }

  /** After a save the file is a new one: entries are read from it from now on. */
  rebase(archive: ZipArchive | null, prefix = ''): void {
    this.archive = archive;
    this.prefix = prefix;
  }

  setExtLookup(extOf: (hash: string) => ImageExt | undefined): void {
    this.extOf = extOf;
  }

  /** Whether the file (or this session) has both sizes of the image. */
  has(hash: string, ext: ImageExt): boolean {
    if (this.added.has(hash)) return true;
    if (this.linked(`images/${hash}.${ext}`)) return true;
    return !!this.archive?.has(`${this.prefix}images/${hash}.${ext}`);
  }

  private async blob(path: string, type: string): Promise<Blob | null> {
    const entry = this.archive?.get(this.prefix + path);
    if (!entry || !this.archive) return null;
    try {
      return new Blob([(await this.archive.read(entry)) as Uint8Array<ArrayBuffer>], { type });
    } catch {
      return null;
    }
  }

  /**
   * A blob: URL of the image's thumb, or of the large image (a card drawn
   * larger than a thumb is sharp). Every call holds a reference until release().
   */
  async thumb(hash: string, large = false): Promise<string | null> {
    const key = (large ? 'l' : 't') + hash;
    const cached = this.thumbs.get(key);
    if (cached) {
      cached.refs++;
      cached.used = ++this.clock;
      return cached.url;
    }
    let loading = this.pending.get(key);
    if (!loading) {
      loading = (async () => {
        const fresh = this.added.get(hash);
        const ext = this.extOf(hash) ?? 'webp';
        if (this.folder) {
          const image = this.linked(`images/${hash}.${ext}`);
          return large ? image : (this.linked(`thumbs/${hash}.webp`) ?? image);
        }
        // A thumb is always WebP; a file without one falls back to the large image.
        const blob = large
          ? (fresh?.image ?? (await this.blob(`images/${hash}.${ext}`, MIME[ext])))
          : (fresh?.thumb ?? (await this.blob(`thumbs/${hash}.webp`, MIME.webp)) ?? (await this.blob(`images/${hash}.${ext}`, MIME[ext])));
        return blob ? URL.createObjectURL(blob) : null;
      })();
      this.pending.set(key, loading);
    }
    const url = await loading;
    this.pending.delete(key);
    if (!url) return null;
    const existing = this.thumbs.get(key);
    if (existing) {
      if (existing.url !== url) revoke(url);
      existing.refs++;
      existing.used = ++this.clock;
      return existing.url;
    }
    this.thumbs.set(key, { url, refs: 1, used: ++this.clock });
    return url;
  }

  release(hash: string, large = false): void {
    const cached = this.thumbs.get((large ? 'l' : 't') + hash);
    if (!cached) return;
    cached.refs = Math.max(0, cached.refs - 1);
    this.evict();
  }

  private evict(): void {
    for (const [kind, spare] of [['t', SPARE], ['l', SPARE_LARGE]] as const) {
      const idle = [...this.thumbs].filter(([key, c]) => c.refs === 0 && key[0] === kind);
      if (idle.length <= spare) continue;
      idle.sort(([, a], [, b]) => a.used - b.used);
      for (const [key, c] of idle.slice(0, idle.length - spare)) {
        revoke(c.url);
        this.thumbs.delete(key);
      }
    }
  }

  /** The large image for the details panel and the gallery: the last few stay at hand. */
  async image(hash: string): Promise<string | null> {
    const url = await this.thumb(hash, true);
    if (!url) return null;
    const at = this.panel.indexOf(hash);
    // Already held for the panel: one reference is enough.
    if (at >= 0) {
      this.panel.splice(at, 1);
      this.release(hash, true);
    }
    this.panel.push(hash);
    while (this.panel.length > PANEL) this.release(this.panel.shift()!, true);
    return url;
  }

  /** The raw bytes of both sizes, for copying into another file (the library picker). */
  async bytes(hash: string): Promise<{ thumb: Blob | null; image: Blob | null }> {
    const fresh = this.added.get(hash);
    if (fresh) return { thumb: fresh.thumb, image: fresh.image };
    const ext = this.extOf(hash) ?? 'webp';
    return { thumb: await this.blob(`thumbs/${hash}.webp`, MIME.webp), image: await this.blob(`images/${hash}.${ext}`, MIME[ext]) };
  }

  /** The background music's bytes: new in this session, or out of the file. */
  async audio(hash: string, ext: AudioExt): Promise<Blob | null> {
    return this.addedAudio.get(hash) ?? (await this.blob(`audio/${hash}.${ext}`, AUDIO_MIME[ext]));
  }

  /** How many decoded pictures are held: the tests watch it stay bounded. */
  get held(): number {
    return this.thumbs.size;
  }

  dispose(): void {
    for (const c of this.thumbs.values()) revoke(c.url);
    this.thumbs.clear();
    this.panel.length = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Encoding the reader's own pictures (Task §7)
 * ------------------------------------------------------------------ */


export const THUMB_SIZE = 192;
export const IMAGE_SIZE = 1280;

export interface Encoded extends NewImage {
  hash: string;
  w: number;
  h: number;
  /** When a JPEG says it was taken — read before the canvas strips the metadata. */
  taken: TakenAt | null;
}

async function toWebp(source: CanvasImageSource, w: number, h: number, longest: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  const scale = Math.min(1, longest / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, cw, ch);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob) throw new Error('This browser cannot encode WebP');
  return { blob, w: cw, h: ch };
}

/** Loads a picture of any kind the browser decodes; an SVG through an <img>, the rest as a bitmap. */
async function decode(blob: Blob): Promise<{ source: CanvasImageSource; w: number; h: number; close(): void }> {
  if (blob.type === 'image/svg+xml') {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 1280;
    const h = img.naturalHeight || 960;
    return { source: img, w, h, close: () => URL.revokeObjectURL(url) };
  }
  const bitmap = await createImageBitmap(blob);
  return { source: bitmap, w: bitmap.width, h: bitmap.height, close: () => bitmap.close() };
}

/**
 * Both sizes of a picture: ≤ 1280 px WebP for the panel, 192 px for cards.
 * Re-encoding through a canvas also drops EXIF, GPS and everything else; the
 * original is not kept. An SVG stays an SVG (it is shown only through <img>,
 * where its scripts never run), with a WebP thumb.
 */
export async function encodeImage(blob: Blob): Promise<Encoded> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const taken = blob.type === 'image/jpeg' || /\.jpe?g$/i.test((blob as File).name ?? '') ? exifDate(bytes) : null;
  const picture = await decode(blob);
  try {
    const thumb = await toWebp(picture.source, picture.w, picture.h, THUMB_SIZE, 0.8);
    if (blob.type === 'image/svg+xml') {
      return { hash: await contentHash(bytes), ext: 'svg', w: picture.w, h: picture.h, thumb: thumb.blob, image: blob, taken };
    }
    const large = await toWebp(picture.source, picture.w, picture.h, IMAGE_SIZE, 0.82);
    const hash = await contentHash(new Uint8Array(await large.blob.arrayBuffer()));
    return { hash, ext: 'webp', w: large.w, h: large.h, thumb: thumb.blob, image: large.blob, taken };
  } finally {
    picture.close();
  }
}
