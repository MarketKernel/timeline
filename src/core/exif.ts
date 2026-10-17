/**
 * The one thing taken from a photo's EXIF (Task §7): the date it was taken,
 * read before the canvas re-encode strips everything else. JPEG only — APP1
 * "Exif", DateTimeOriginal, else DateTime.
 */

export interface TakenAt {
  y: number;
  m: number;
  d: number;
}

export function exifDate(bytes: Uint8Array): TakenAt | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1]!;
    const size = view.getUint16(p + 2);
    if (marker === 0xe1 && p + 10 <= bytes.length && String.fromCharCode(...bytes.subarray(p + 4, p + 8)) === 'Exif') {
      return readTiff(view, p + 10, Math.min(bytes.length, p + 2 + size));
    }
    if (marker === 0xda) return null; // image data: no EXIF before it
    p += 2 + size;
  }
  return null;
}

function readTiff(view: DataView, start: number, end: number): TakenAt | null {
  if (start + 8 > end) return null;
  const little = view.getUint16(start) === 0x4949;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  const ascii = (at: number, count: number) => {
    let s = '';
    for (let i = 0; i < count && at + i < end; i++) {
      const c = view.getUint8(at + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const tags = (ifd: number): Map<number, string | number> => {
    const out = new Map<number, string | number>();
    if (ifd + 2 > end) return out;
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const at = ifd + 2 + i * 12;
      if (at + 12 > end) break;
      const tag = u16(at);
      const type = u16(at + 2);
      const n = u32(at + 4);
      if (type === 2) out.set(tag, ascii(n <= 4 ? at + 8 : start + u32(at + 8), n));
      else if (type === 4) out.set(tag, u32(at + 8));
    }
    return out;
  };
  const first = tags(start + u32(start + 4));
  const exifIfd = first.get(0x8769);
  const sub = typeof exifIfd === 'number' ? tags(start + exifIfd) : new Map<number, string | number>();
  const text = (sub.get(0x9003) ?? sub.get(0x9004) ?? first.get(0x0132)) as string | undefined;
  const match = text ? /^(\d{4}):(\d{2}):(\d{2})/.exec(text) : null;
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}
