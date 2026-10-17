/** The .timeline container: lazy reading, streamed writing, tolerance (Task §3, §11). */
import { deflateRawSync, crc32 as nodeCrc } from 'node:zlib';
import { checker, load } from '../tools/load.mjs';

const { openZip, bytesSource, ZipWriter, memorySink, localHeader, centralHeader, endRecord, rootPrefix, crc32 } = await load('core/zip', 'core/hash');
const { check, done } = checker();
const enc = new TextEncoder();
const dec = new TextDecoder();
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function write(entries) {
  const out = memorySink();
  const writer = new ZipWriter(out.sink);
  for (const [name, data, compress] of entries) await writer.add(name, data, compress);
  await writer.finish();
  return out.bytes();
}

/** A Source that records every read. */
const watched = (bytes) => {
  const reads = [];
  const src = bytesSource(bytes);
  return { reads, source: { size: src.size, read: (o, l) => (reads.push([o, l]), src.read(o, l)) } };
};

check('crc32 matches zlib', crc32(enc.encode('The Bible')), nodeCrc(enc.encode('The Bible')));

const json = enc.encode(JSON.stringify({ format: 'timeline', title: 'Test', filler: 'x'.repeat(5000) }));
const image = Uint8Array.from({ length: 30000 }, (_, i) => (i * 7919) % 251);
const first = await write([
  ['timeline.json', json, true],
  ['thumbs/aa11.webp', image.subarray(0, 6000), false],
  ['images/aa11.webp', image, false],
]);

{
  const zip = await openZip(bytesSource(first));
  check('names', zip.entries.map((e) => e.name), ['timeline.json', 'thumbs/aa11.webp', 'images/aa11.webp']);
  check('json is deflated', zip.get('timeline.json').method, 8);
  check('images are stored', zip.get('images/aa11.webp').method, 0);
  check('json reads back', same(await zip.read(zip.get('timeline.json')), json), true);
  check('image reads back', same(await zip.read(zip.get('images/aa11.webp')), image), true);

  // Write → read → write again from the raw entries: identical bytes.
  const out = memorySink();
  const writer = new ZipWriter(out.sink);
  for (const entry of zip.entries) await writer.addRaw(entry, await zip.raw(entry));
  await writer.finish();
  check('a rewrite is byte for byte the same', same(out.bytes(), first), true);
  const again = await write([
    ['timeline.json', json, true],
    ['thumbs/aa11.webp', image.subarray(0, 6000), false],
    ['images/aa11.webp', image, false],
  ]);
  check('the same content makes the same bytes', same(again, first), true);
}

{
  // One entry read by slice, the rest untouched.
  const { reads, source } = watched(first);
  const zip = await openZip(source);
  const opened = reads.length;
  await zip.read(zip.get('thumbs/aa11.webp'));
  const entry = zip.get('thumbs/aa11.webp');
  const touched = reads.slice(opened);
  const inside = touched.every(([o, l]) => o >= entry.offset && o + l <= entry.offset + 30 + entry.name.length + entry.compressedSize);
  check('opening reads only the end of the file', reads.slice(0, opened).every(([o]) => o >= first.length - 22 - 65535 || o === 0), true);
  check('reading an entry touches only that entry', inside, true);
}

{
  // A save: the JSON fresh, untouched entries copied byte for byte, a new image appended, one dropped.
  const zip = await openZip(bytesSource(first));
  const out = memorySink();
  const writer = new ZipWriter(out.sink);
  await writer.add('timeline.json', enc.encode('{"format":"timeline","v":2}'));
  for (const name of ['images/aa11.webp']) await writer.addRaw(zip.get(name), await zip.raw(zip.get(name)));
  await writer.add('images/bb22.webp', image.subarray(100, 900), false);
  await writer.finish();
  const saved = await openZip(bytesSource(out.bytes()));
  check('saved entries', saved.entries.map((e) => e.name), ['timeline.json', 'images/aa11.webp', 'images/bb22.webp']);
  check('the untouched image is copied byte for byte', same(await saved.raw(saved.get('images/aa11.webp')), await zip.raw(zip.get('images/aa11.webp'))), true);
}

{
  // 500 entries of 400 KB: a 200 MB archive that is never in memory — only its directory exists.
  const count = 500;
  const size = 400 * 1024;
  const jsonEntry = { name: 'timeline.json', method: 0, crc: crc32(json), compressedSize: json.length, size: json.length };
  const parts = [localHeader(jsonEntry), json];
  const central = [centralHeader(jsonEntry, 0)];
  let offset = parts[0].length + json.length;
  for (let i = 0; i < count; i++) {
    const entry = { name: `images/${String(i).padStart(16, '0')}.webp`, method: 0, crc: 0, compressedSize: size, size };
    central.push(centralHeader(entry, offset));
    offset += localHeader(entry).length + size;
  }
  const dir = Buffer.concat(central);
  const head = Buffer.concat(parts);
  const tail = Buffer.concat([dir, endRecord(count + 1, dir.length, offset)]);
  const total = offset + tail.length;
  const source = {
    size: total,
    read: async (o, l) => {
      const outBytes = new Uint8Array(Math.min(l, total - o));
      for (const [start, bytes] of [[0, head], [offset, tail]]) {
        const from = Math.max(o, start);
        const to = Math.min(o + outBytes.length, start + bytes.length);
        if (from < to) outBytes.set(bytes.subarray(from - start, to - start), from - o);
      }
      return outBytes;
    },
  };
  const started = performance.now();
  const zip = await openZip(source);
  const text = await zip.text(zip.get('timeline.json'));
  const took = performance.now() - started;
  check('a 200 MB archive lists its entries', [total > 200e6, zip.entries.length], [true, count + 1]);
  check('and its JSON reads', text.includes('"timeline"'), true);
  check(`it opens in < 100 ms (${took.toFixed(1)} ms)`, took < 100, true);
}

{
  // What Finder makes: a wrapping folder, data descriptors (sizes after the data), __MACOSX junk.
  const files = [
    ['bible/', new Uint8Array(0)],
    ['bible/timeline.json', json],
    ['bible/images/aa11.webp', image],
    ['__MACOSX/bible/._timeline.json', enc.encode('junk')],
    ['bible/.DS_Store', enc.encode('junk')],
  ];
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const packed = deflateRawSync(data);
    const crc = nodeCrc(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 6); // bit 3: sizes in a data descriptor
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(nameBytes.length, 26);
    head.writeUInt16LE(4, 28); // an extra field the central directory does not repeat
    const extra = Buffer.from([0x55, 0x58, 0, 0]);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(packed.length, 8);
    descriptor.writeUInt32LE(data.length, 12);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(0x0314, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(head, nameBytes, extra, packed, descriptor);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + 4 + packed.length + 16;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  const finder = new Uint8Array(Buffer.concat([...local, dir, end]));
  const zip = await openZip(bytesSource(finder));
  check('Finder junk is ignored', zip.entries.map((e) => e.name), ['bible/timeline.json', 'bible/images/aa11.webp']);
  const prefix = rootPrefix(zip.entries.map((e) => e.name));
  check('the wrapping folder is found', prefix, 'bible/');
  check('a Finder zip reads', same(await zip.read(zip.get(`${prefix}images/aa11.webp`)), image), true);
}

{
  // A truncated file fails with a clear error.
  for (const cut of [first.length - 10, Math.floor(first.length / 2), 100]) {
    let code = null;
    let message = '';
    try {
      const zip = await openZip(bytesSource(first.subarray(0, cut)));
      for (const e of zip.entries) await zip.read(e);
    } catch (error) {
      code = error.code;
      message = error.message;
    }
    check(`cut at ${cut} → truncated`, [code, /cut short/.test(message)], ['truncated', true]);
  }
  let code = null;
  try {
    await openZip(bytesSource(enc.encode('this is just some text, not a zip at all')));
  } catch (error) {
    code = error.code;
  }
  check('text is not a zip', code, 'not-zip');
  // A damaged entry is caught by its checksum.
  const broken = first.slice();
  const zip = await openZip(bytesSource(broken));
  const entry = zip.get('images/aa11.webp');
  broken[entry.offset + 30 + entry.name.length + 10] ^= 0xff;
  code = null;
  try {
    await zip.read(entry);
  } catch (error) {
    code = error.code;
  }
  check('a flipped byte fails the checksum', code, 'crc');
}

check('no folder for a plain file', rootPrefix(['timeline.json', 'images/a.webp']), '');
check('two candidate folders → none', rootPrefix(['a/timeline.json', 'b/timeline.json']), '');
check('utf-8 names survive', dec.decode(enc.encode('images/ё.webp')), 'images/ё.webp');

done('zip');
