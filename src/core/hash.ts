/**
 * Checksums and names: CRC-32 for the zip, SHA-256 for naming images by their
 * content (duplicates collapse, renames never break), short random ids for
 * what the app creates.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as zip uses it; `previous` continues a running checksum. */
export function crc32(data: Uint8Array, previous = 0): number {
  let c = ~previous >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/** The name of an image: the first 16 hex digits of its SHA-256 — 64 bits, plenty for thousands. */
export async function contentHash(data: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)).slice(0, 16);
}

/** `e_7fk2`: a short random id with `prefix`, not one of `taken`. */
export function shortId(prefix: string, taken: { has(id: string): boolean }): string {
  for (let length = 4; ; length++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      let id = `${prefix}_`;
      const random = crypto.getRandomValues(new Uint8Array(length));
      for (const byte of random) id += '0123456789abcdefghijklmnopqrstuvwxyz'[byte % 36];
      if (!taken.has(id)) return id;
    }
  }
}
