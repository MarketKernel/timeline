/** Reading a .timeline as the page and tools/check.mjs both do: what opens, what is refused and why, what is missing. */
import { checker, load } from '../tools/load.mjs';

const { readArchive, readDoc, ReadError, ZipWriter, memorySink, bytesSource } = await load('core/archive', 'core/zip');
const { check, done } = checker();
const enc = new TextEncoder();

async function zip(entries) {
  const out = memorySink();
  const writer = new ZipWriter(out.sink);
  for (const [name, data] of entries) await writer.add(name, typeof data === 'string' ? enc.encode(data) : data);
  await writer.finish();
  return out.bytes();
}

/** The code of the ReadError a read throws, or 'opened'. */
async function refusal(bytes) {
  try {
    await readArchive(bytesSource(bytes));
    return 'opened';
  } catch (error) {
    return error instanceof ReadError ? error.code : `not a ReadError: ${error}`;
  }
}

const doc = {
  format: 'timeline',
  version: 1,
  lang: 'en',
  meta: { id: 'a', kind: 'history' },
  title: 'A',
  images: { '0123456789abcdef': { ext: 'webp', w: 4, h: 3 }, fedcba9876543210: { ext: 'webp', w: 4, h: 3 } },
  music: { file: 'aaaaaaaaaaaaaaaa', ext: 'mp3' },
  items: [{ id: 'e', kind: 'event', start: { y: 1900 }, title: 'E', image: '0123456789abcdef', gallery: ['fedcba9876543210'] }],
};

{
  const bytes = await zip([
    ['Folder/timeline.json', JSON.stringify(doc)],
    ['Folder/images/0123456789abcdef.webp', new Uint8Array(8)],
  ]);
  const read = await readArchive(bytesSource(bytes));
  check('a timeline in a single top folder opens', [read.prefix, read.doc.title], ['Folder/', 'A']);
  check('…warned of the picture and the music it lacks', read.warnings.map((w) => [w.code, w.path]), [
    ['image-missing', 'images.fedcba9876543210'],
    ['music-missing', 'music'],
  ]);
}

check('not a zip', await refusal(enc.encode('PK not really a zip at all')), 'not-zip');
const whole = await zip([['timeline.json', JSON.stringify(doc)]]);
check('a zip cut short', await refusal(whole.slice(0, whole.length - 10)), 'truncated');
check('a zip without timeline.json', await refusal(await zip([['readme.txt', 'hello']])), 'no-json');
{
  // Stored, not deflated, so a flipped byte in it is the checksum's to catch.
  const out = memorySink();
  const writer = new ZipWriter(out.sink);
  await writer.add('timeline.json', enc.encode(JSON.stringify(doc)), false);
  await writer.finish();
  const bytes = out.bytes();
  bytes[60] ^= 0xff;
  check('timeline.json damaged in the zip', await refusal(bytes), 'json-damaged');
}
check('timeline.json that is not JSON', await refusal(await zip([['timeline.json', '{ nope']])), 'json-invalid');
check('timeline.json the model refuses', await refusal(await zip([['timeline.json', '{"format":"other"}']])), 'model');

{
  const { warnings } = readDoc(doc, (path) => path.startsWith('images/'));
  check('a bare document: only what `has` cannot find is missing', warnings.map((w) => w.code), ['music-missing']);
}

done('archive');
