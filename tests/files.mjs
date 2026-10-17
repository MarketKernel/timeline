/** Opening and saving a .timeline as the page does, in Node: what opens, what is refused, what a save keeps and drops (Task §3, §6). */
import { checker, load } from '../tools/load.mjs';

const { readTimeline, timelineBlob, asWritten, fileNameFor, sizeText, FileError, ImageStore, ZipWriter, memorySink, serializeDoc } = await load('app/files', 'app/images', 'core/zip', 'core/model');
const { check, done } = checker();
const enc = new TextEncoder();

async function zipOf(entries) {
  const out = memorySink();
  const writer = new ZipWriter(out.sink);
  for (const [name, data] of entries) await writer.add(name, typeof data === 'string' ? enc.encode(data) : data);
  await writer.finish();
  return out.bytes();
}

/** The message a refused file gives the reader, or 'opened'. */
async function refusal(file) {
  try {
    await readTimeline(file);
    return 'opened';
  } catch (error) {
    return error instanceof FileError ? error.message : `not a FileError: ${error}`;
  }
}

const USED = '0123456789abcdef';
const UNUSED = 'fedcba9876543210';
const picture = Uint8Array.from({ length: 300 }, (_, i) => (i * 31) % 256);
const json = {
  format: 'timeline',
  version: 1,
  lang: 'en',
  meta: { id: 'moon', kind: 'history' },
  title: 'The Moon',
  images: { [USED]: { ext: 'webp', w: 4, h: 3, caption: 'Earthrise' }, [UNUSED]: { ext: 'webp', w: 4, h: 3 } },
  items: [{ id: 'a11', kind: 'event', start: { y: 1969, m: 7, d: 20 }, title: 'Apollo 11', image: USED }],
};
const bytes = await zipOf([
  ['timeline.json', JSON.stringify(json)],
  [`images/${USED}.webp`, picture],
  [`thumbs/${USED}.webp`, picture.slice(0, 50)],
  [`images/${UNUSED}.webp`, picture.slice(0, 10)],
  ['notes/README.txt', 'kept as it is'],
]);

const opened = await readTimeline(new File([bytes], 'moon.en.timeline'));
check('a .timeline opens', [opened.doc.title, opened.name, opened.prefix, opened.warnings], ['The Moon', 'moon.en.timeline', '', []]);

{
  // A save: the JSON fresh, the picture still used copied byte for byte, the unused one dropped, anything else kept.
  const store = new ImageStore(opened.archive, opened.prefix, (hash) => opened.doc.images[hash]?.ext);
  const { blob, result } = await timelineBlob(opened.doc, store, opened.archive, opened.prefix);
  check('a save drops the picture nothing uses', result.dropped, 1);
  const again = await readTimeline(new File([blob], 'moon.en.timeline'));
  check('…and opens again as the same document, less that picture', serializeDoc(again.doc), serializeDoc(asWritten(opened.doc).written));
  const names = again.archive.entries.map((e) => e.name).sort();
  check('…with what it kept', names, ['images/0123456789abcdef.webp', 'notes/README.txt', 'thumbs/0123456789abcdef.webp', 'timeline.json']);
  const copied = await again.archive.read(again.archive.get(`images/${USED}.webp`));
  check('…the picture byte for byte', copied.every((b, i) => b === picture[i]) && copied.length === picture.length, true);
  check('the document in memory keeps the dropped picture for undo', Object.keys(opened.doc.images).sort(), [USED, UNUSED]);
}

check('not a timeline', await refusal(new File(['hello'], 'x.timeline')), 'This is not a timeline file.');
check('a zip without timeline.json', await refusal(new File([await zipOf([['a.txt', 'a']])], 'x.zip')), 'This zip has no timeline.json inside: it is not a timeline.');
check('a zip cut short', await refusal(new File([bytes.slice(0, bytes.length - 8)], 'x.timeline')), 'The file is cut short — it may not have finished copying.');
check('timeline.json that is not JSON', await refusal(new File([await zipOf([['timeline.json', '{ nope']])], 'x.timeline')), 'timeline.json in this file is not valid JSON.');
check('a document the model refuses says why', await refusal(new File([await zipOf([['timeline.json', '{"format":"other"}']])], 'x.timeline')), 'This is not a timeline: the format is not "timeline"');

{
  const bare = await readTimeline(new File([JSON.stringify(json)], 'timeline.json'));
  check('a bare timeline.json opens, every picture it names missing', [bare.archive, bare.warnings.map((w) => w.code)], [null, ['image-missing', 'image-missing']]);
}

check('a file name from the id', [fileNameFor({ meta: { id: 'flight.en' } }), fileNameFor({ meta: { id: 'untitled' } }), fileNameFor({ meta: { id: 'a b/c' } })], ['flight.en.timeline', 'timeline.timeline', 'a-b-c.timeline']);
check('sizes', [sizeText(10), sizeText(640 * 1024), sizeText(12.5 * 1024 * 1024)], ['1 KB', '640 KB', '12.5 MB']);

done('files');
