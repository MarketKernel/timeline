/** The date a photo was taken, from a JPEG's EXIF (Task §7). */
import { checker, load } from '../tools/load.mjs';

const { exifDate } = await load('core/exif');
const { check, done } = checker();

/** A minimal JPEG: SOI, APP1 with a TIFF header, IFD0 → Exif IFD → DateTimeOriginal. */
function jpeg(date, little = true) {
  const tiff = [];
  const u16 = (n) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n) => (little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const text = [...date].map((c) => c.charCodeAt(0)).concat(0);
  // header (8) · IFD0 at 8: 1 entry (ExifIFD pointer) · next 0 · Exif IFD at 26: 1 entry (DateTimeOriginal) · next 0 · string at 44
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(text.length), ...u32(44), ...u32(0));
  tiff.push(...text);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const size = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 255, ...app1, 0xff, 0xda, 0, 2]);
}

check('little-endian', exifDate(jpeg('2019:07:14 10:22:01')), { y: 2019, m: 7, d: 14 });
check('big-endian', exifDate(jpeg('1999:12:31 23:59:59', false)), { y: 1999, m: 12, d: 31 });
check('no exif', exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), null);
check('not a jpeg', exifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
check('a blank date', exifDate(jpeg('0000:00:00 00:00:00')), null);

done('exif');
