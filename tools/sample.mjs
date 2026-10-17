/**
 * tests/fixtures/sample.json packed into a .timeline for the browser tests,
 * with small SVG pictures standing in for photographs (no thumbs: the app
 * falls back to the large image, which is a case worth testing too).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load, root } from './load.mjs';

const { ZipWriter, memorySink, parseDoc, serializeDoc } = await load('core/zip', 'core/model');

const picture = (hue, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 853"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 72%)"/><stop offset="1" stop-color="hsl(${hue} 35% 38%)"/></linearGradient></defs><rect width="1280" height="853" fill="url(#g)"/><circle cx="960" cy="220" r="120" fill="hsl(${hue + 30} 70% 85%)" opacity=".8"/><path d="M0 700 Q 320 560 640 690 T 1280 650 V 853 H 0 Z" fill="hsl(${hue} 30% 25%)"/><text x="80" y="160" font-family="Georgia" font-size="96" fill="#fff" opacity=".85">${label}</text></svg>`;

/** `entries` adds files of its own to the zip: `{ 'audio/….wav': bytes }` for the music an override names. */
export async function sampleTimeline(overrides = {}, entries = {}) {
  const json = JSON.parse(await readFile(join(root, 'tests', 'fixtures', 'sample.json'), 'utf8'));
  Object.assign(json, overrides);
  const { doc, warnings } = parseDoc(json);
  if (warnings.length) throw new Error(`sample.json: ${warnings.map((w) => w.text).join('; ')}`);
  const out = memorySink();
  const writer = new ZipWriter(out.sink);
  await writer.add('timeline.json', new TextEncoder().encode(serializeDoc(doc)));
  const hues = { a1a1a1a1a1a1a1a1: [30, 'Kitty Hawk'], b2b2b2b2b2b2b2b2: [220, 'Apollo'], c3c3c3c3c3c3c3c3: [12, 'Paris'], d4d4d4d4d4d4d4d4: [150, 'Earthrise'] };
  for (const [hash, [hue, label]] of Object.entries(hues)) await writer.add(`images/${hash}.svg`, new TextEncoder().encode(picture(hue, label)));
  for (const [name, bytes] of Object.entries(entries)) await writer.add(name, bytes, false);
  await writer.finish();
  return out.bytes();
}

/**
 * A shelf for the PWA test, written into `dir` as a packed library would be:
 * the sample in English and in Russian (one chronology, two files), a second
 * chronology in English only, a cover, and index.json.
 */
export async function sampleLibrary(dir) {
  const { meta, items, images } = JSON.parse(await readFile(join(root, 'tests', 'fixtures', 'sample.json'), 'utf8'));
  // The counts index.json gives are the files' own: tools/check.mjs holds the library to them.
  const pictures = Object.keys(images).length;
  const big = { events: 60, images: 6 };
  const files = [
    { group: 'flight', lang: 'en', title: 'A short history of flight', span: '1783 – now', bytes: await sampleTimeline(), items: items.length, images: pictures, cover: 'covers/flight-sample.svg' },
    { group: 'flight', lang: 'ru', title: 'Краткая история полёта', span: '1783 – сейчас', bytes: await sampleTimeline({ lang: 'ru', title: 'Краткая история полёта', meta: { ...meta, id: 'flight-sample-ru' } }), items: items.length, images: pictures, cover: 'covers/flight-sample.svg' },
    { group: 'big', lang: 'en', title: 'A thousand events', span: '1000 BC – AD 2000', bytes: await bigTimeline(big.events, big.images), items: big.events, images: big.images, cover: null },
  ];
  await mkdir(join(dir, 'covers'), { recursive: true });
  await writeFile(join(dir, 'covers', 'flight-sample.svg'), picture(220, 'Apollo').replace('<svg ', '<svg width="1280" height="853" '));
  const entries = [];
  for (const { bytes, ...entry } of files) {
    const file = `${entry.group}.${entry.lang}.timeline`;
    await writeFile(join(dir, file), bytes);
    entries.push({ id: `${entry.group}-${entry.lang}`, file, description: '', kind: 'history', size: bytes.length, ...entry });
  }
  await writeFile(join(dir, 'index.json'), JSON.stringify({ format: 'timeline-library', version: 1, files: entries }));
}

/**
 * A big synthetic file for the budgets (Task §11): `events` events over three
 * thousand years and `images` pictures — tiny ones, since only the opening is
 * measured and opening never reads them.
 */
export async function bigTimeline(events = 1000, images = 500) {
  const enc = new TextEncoder();
  const hashes = Array.from({ length: images }, (_, i) => i.toString(16).padStart(16, '0'));
  let seed = 3;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const json = {
    format: 'timeline',
    version: 1,
    lang: 'en',
    meta: { id: 'big', kind: 'history' },
    title: 'A thousand events',
    images: Object.fromEntries(hashes.map((h) => [h, { ext: 'svg', w: 300, h: 200 }])),
    items: Array.from({ length: events }, (_, i) => ({
      id: `e${i}`,
      kind: 'event',
      start: { y: Math.round(-1000 + random() * 3000) },
      title: `Event number ${i}`,
      ...[{ size: 'large' }, {}, { size: 'small' }][Math.floor(random() * 3)],
      color: random() < 0.5 ? '#5c6f86' : '#a5603f',
      ...(i < images ? { image: hashes[i] } : {}),
    })),
  };
  const { doc } = parseDoc(json);
  const out = memorySink();
  const writer = new ZipWriter(out.sink);
  await writer.add('timeline.json', enc.encode(serializeDoc(doc)));
  for (const h of hashes) await writer.add(`images/${h}.svg`, enc.encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#${h.slice(-6)}"/></svg>`), false);
  await writer.finish();
  return out.bytes();
}
