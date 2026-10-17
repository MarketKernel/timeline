/** timeline.json: validation with exact warnings, forward compatibility, deterministic output (Task §3, §11). */
import { checker, load } from '../tools/load.mjs';

const { parseDoc, serializeDoc, colorOf, rankOf, extentOf, usedImages, missingImages, ModelError, parseMarkdown, plainText, dayOf } = await load('core/model', 'core/markdown', 'core/dates');
const { check, done } = checker();

const good = {
  format: 'timeline',
  version: 1,
  lang: 'ru',
  meta: { id: 'bible', kind: 'history', created: '2026-10-13', generator: 'timeline 0.1.0' },
  title: 'Библия',
  images: { '3f9a00c2aa00c2aa': { ext: 'webp', w: 1280, h: 853, caption: 'Ной', credit: { author: 'A', license: 'PD', url: 'https://commons.wikimedia.org/x' } } },
  items: [
    { id: 'david', kind: 'period', start: { y: -1009 }, end: { y: -969 }, title: 'Царствование Давида', color: '#B07D3C' },
    { id: 'flood', kind: 'event', start: { y: -2517, approx: true, spread: 100 }, title: 'Потоп', refs: 'Быт 6–9', importance: 1, image: '3f9a00c2aa00c2aa' },
    { id: 'church', kind: 'era', start: { y: 30 }, end: { now: true }, title: 'Век Церкви', color: '#7b5e8a' },
  ],
  view: { center: { y: -2000 }, scale: { px: 1, unit: 'year', count: 1 } },
};

{
  const { doc, warnings } = parseDoc(structuredClone(good));
  check('a good file has no warnings', warnings, []);
  check('colours are lower-cased', [doc.items[0].color, doc.items[2].color], ['#b07d3c', '#7b5e8a']);
  check('one language, plain strings', [doc.lang, doc.title, doc.items[2].title], ['ru', 'Библия', 'Век Церкви']);
  check('open end', doc.items[2].end, { now: true });
  const text = serializeDoc(doc);
  check('items are written in date order', JSON.parse(text).items.map((i) => i.id), ['flood', 'david', 'church']);
  check('serializing is stable', serializeDoc(parseDoc(JSON.parse(text)).doc), text);
  check('short objects stay on one line', text.includes('"start": { "y": -2517, "approx": true, "spread": 100 }'), true);
  check('keys in a fixed order', Object.keys(JSON.parse(text)), ['format', 'version', 'lang', 'meta', 'title', 'images', 'items', 'view']);
  const [lo, hi] = extentOf(doc, new Date(Date.UTC(2026, 9, 13)));
  check('the extent starts at the first date, not its spread', [lo, hi >= dayOf(2026, 10, 13)], [dayOf(-2517, 1, 1), true]);
  check('used images', [...usedImages(doc)], ['3f9a00c2aa00c2aa']);
  check('missing image files', missingImages(doc, () => false).map((w) => w.path), ['images.3f9a00c2aa00c2aa']);
}

{
  // The file's look: checked field by field, written after the anchor, unknown parts kept.
  const styled = { ...structuredClone(good), style: { font: 'sans', color: '#ABC', texture: 'grid', paper: '#E7EEF6', ink: 'sepia' } };
  const { doc, warnings } = parseDoc(styled);
  check('a style has no warnings', warnings, []);
  check('style colours are normalised', [doc.style.paper, doc.style.color], ['#e7eef6', '#aabbcc']);
  const out = JSON.parse(serializeDoc(doc));
  check('style keys in a fixed order, unknown ones after', Object.keys(out.style), ['paper', 'texture', 'color', 'font', 'ink']);
  check('style sits between anchor and images', Object.keys(out).slice(-4), ['style', 'images', 'items', 'view']);
  check('an item without a colour takes the file’s', [colorOf(doc.items.find((i) => i.id === 'flood'), doc), colorOf(doc.items.find((i) => i.id === 'flood'))], ['#aabbcc', '#8c8176']);
  check('an item’s own colour wins', colorOf(doc.items.find((i) => i.id === 'david'), doc), '#b07d3c');
  const bad = parseDoc({ ...structuredClone(good), style: { paper: 'blue', texture: 'velvet', font: 'comic' } });
  check('bad style fields are dropped one by one', bad.warnings.map((w) => w.path), ['style.paper', 'style.texture', 'style.font']);
  check('an empty style is not written', 'style' in JSON.parse(serializeDoc(bad.doc)), false);
  check('a style that is not an object is dropped', parseDoc({ ...structuredClone(good), style: 'dark' }).warnings.map((w) => w.path), ['style']);
}

{
  // An event's card: round, on a fill of its own; neither is a period's.
  const { doc, warnings } = parseDoc({ ...structuredClone(good), items: [
    { id: 'e', kind: 'event', start: { y: 1 }, title: 'E', shape: 'round', background: '#2F3D4C' },
    { id: 'p', kind: 'period', start: { y: 1 }, end: { y: 9 }, title: 'P', shape: 'round', background: '#2f3d4c' },
    { id: 'r', kind: 'event', start: { y: 2 }, title: 'R', shape: 'card' },
  ] });
  const [e, p, r] = ['e', 'p', 'r'].map((id) => doc.items.find((i) => i.id === id));
  check('a round event on a fill', [e.shape, e.background], ['round', '#2f3d4c']);
  check('…not a period', [p.shape, p.background, warnings.map((w) => w.path)], [undefined, undefined, ['items[1].background', 'items[1].shape']]);
  check('a rectangle is left out of the file', 'shape' in r, false);
  check('…written after the colour and the size', Object.keys(JSON.parse(serializeDoc(doc)).items.find((i) => i.id === 'e')), ['id', 'kind', 'start', 'title', 'background', 'shape']);
}

{
  // An older file's importance is its events' size now: a key event a large card, a minor one a small card.
  const { doc, warnings } = parseDoc({ ...structuredClone(good), items: [
    { id: 'key', kind: 'event', start: { y: 1 }, title: 'K', importance: 1 },
    { id: 'minor', kind: 'event', start: { y: 2 }, title: 'M', importance: 3 },
    { id: 'normal', kind: 'event', start: { y: 3 }, title: 'N', importance: 2 },
    { id: 'sized', kind: 'event', start: { y: 4 }, title: 'S', importance: 1, size: 'huge' },
    { id: 'bar', kind: 'period', start: { y: 1 }, end: { y: 9 }, title: 'B', importance: 1 },
  ] });
  const size = (id) => doc.items.find((i) => i.id === id).size;
  check('importance becomes the size, silently', [warnings, size('key'), size('minor'), size('normal'), size('sized'), size('bar')], [[], 'large', 'small', undefined, 'huge', undefined]);
  check('…and is not written again', JSON.stringify(JSON.parse(serializeDoc(doc)).items).includes('importance'), false);
  check('the rank follows the size', doc.items.filter((i) => i.kind === 'event').map(rankOf), [1, 3, 2, 1]);
}

{
  // Background music: a file in the zip, named by its hash; the JSON says what it is.
  const { doc, warnings } = parseDoc({ ...structuredClone(good), music: { file: 'a1b2c3d4e5f60718', ext: 'mp3', title: 'Air', credit: { author: 'J. S. Bach' }, loop: 'yes' } });
  check('music is read', [warnings, doc.music.file, doc.music.ext, doc.music.title, doc.music.credit.author], [[], 'a1b2c3d4e5f60718', 'mp3', 'Air', 'J. S. Bach']);
  const out = JSON.parse(serializeDoc(doc));
  check('…written after the style, unknown fields kept', [Object.keys(out).indexOf('music') === Object.keys(out).indexOf('images') - 1, Object.keys(out.music)], [true, ['file', 'ext', 'title', 'credit', 'loop']]);
  check('music that is not a known file is dropped', parseDoc({ ...structuredClone(good), music: { file: 'not a hash', ext: 'midi' } }).warnings.map((w) => w.path), ['music']);
}

{
  // Unknown fields, everywhere, survive load → save.
  const future = structuredClone(good);
  future.version = 3;
  future.layers = [{ id: 'egypt' }];
  future.meta.signature = 'abc';
  future.items[0].sources = ['Thiele'];
  future.items[1].arcs = [{ to: 'david' }];
  future.images['3f9a00c2aa00c2aa'].focus = { x: 0.3, y: 0.4 };
  future.view.layout = 'vertical';
  const { doc, warnings } = parseDoc(future);
  check('a newer file warns once', warnings.map((w) => w.code), ['newer-version']);
  const out = JSON.parse(serializeDoc(doc));
  check('unknown top-level field kept', out.layers, [{ id: 'egypt' }]);
  check('unknown meta field kept', out.meta.signature, 'abc');
  check('unknown item fields kept', [out.items.find((i) => i.id === 'david').sources, out.items.find((i) => i.id === 'flood').arcs], [['Thiele'], [{ to: 'david' }]]);
  check('unknown image and view fields kept', [out.images['3f9a00c2aa00c2aa'].focus, out.view.layout], [{ x: 0.3, y: 0.4 }, 'vertical']);
  check('the version is kept', out.version, 3);
}

{
  // A broken file: every problem is a warning, in order, and the rest opens.
  const broken = {
    format: 'timeline',
    version: 1,
    lang: 'Russian',
    meta: { id: 'broken file!', kind: 'diary' },
    // Texts in several languages at once are not this format's: one file, one language.
    title: { en: 'Broken', ru: 'Сломан' },
    images: { XYZ: { ext: 'webp' }, '00aa00aa00aa00aa': { ext: 'gif', w: 1, h: 1 }, '11bb11bb11bb11bb': { ext: 'png', w: 10, h: 10, credit: { url: 'javascript:alert(1)' } } },
    items: [
      'a string',
      { kind: 'event', start: { y: 1 }, title: 'no id' },
      { id: 'x', kind: 'battle', start: { y: 1 }, title: 'X' },
      { id: 'y', kind: 'event', start: { y: 2000, m: 2, d: 30 }, title: 'Y' },
      { id: 'z', kind: 'period', start: { y: 10 }, title: 'Z' },
      { id: 'ok', kind: 'period', start: { y: 20 }, end: { y: 10 }, title: 'OK', color: 'red', image: 'ffff0000ffff0000', importance: 5, links: ['https://a.org', 'javascript:x'], lane: -1 },
      { id: 'ok', kind: 'event', start: { y: 1 }, title: 'dup' },
      { id: 'e', kind: 'event', start: { y: 1 }, end: { y: 2 } },
    ],
    cover: 'nothere0nothere0',
    anchor: { label: 'AM' },
    view: { scale: { px: 0, unit: 'year' } },
  };
  const { doc, warnings } = parseDoc(broken);
  check('exact warnings', warnings.map((w) => `${w.code} ${w.path}`), [
    'field-dropped meta.id',
    'field-dropped meta.kind',
    'field-dropped lang',
    'field-dropped title',
    'field-dropped images.00aa00aa00aa00aa',
    'field-dropped images.11bb11bb11bb11bb.credit.url',
    'field-dropped images.XYZ',
    'item-skipped items[0]',
    'item-skipped items[1]',
    'item-skipped items[2]',
    'item-skipped items[3]',
    'item-skipped items[4]',
    'fixed items[5].end',
    'field-dropped items[5].links',
    'field-dropped items[5].color',
    'image-missing items[5].image',
    'field-dropped items[5].lane',
    'duplicate-id items[6]',
    'field-dropped items[7].title',
    'field-dropped items[7].end',
    'image-missing cover',
    'field-dropped anchor',
    'field-dropped view.scale',
  ]);
  check('a warning says what happened', warnings.find((w) => w.path === 'items[4]').text, 'items[4] skipped: a period needs an end date');
  check('what survived', doc.items.map((i) => i.id), ['ok', 'e']);
  check('swapped dates', [doc.items[0].start, doc.items[0].end], [{ y: 10 }, { y: 20 }]);
  check('safe links only', doc.items[0].links, ['https://a.org']);
  check('meta, language and title fall back', [doc.meta.id, doc.meta.kind, doc.lang, doc.title], ['untitled', 'history', 'en', 'Untitled']);
}

{
  // A file of the first months: its categories' colours move onto the items, its tracks go, with one warning.
  const old = {
    format: 'timeline',
    version: 1,
    meta: { id: 'old', kind: 'history' },
    title: 'Old',
    categories: [{ id: 'kings', title: 'Kings', color: '#ABC', glyph: 'crown' }, { id: 'plain', title: 'Plain' }],
    tracks: [{ id: 'judah', title: 'Judah' }],
    items: [
      { id: 'david', kind: 'period', start: { y: -1009 }, end: { y: -969 }, title: 'David', category: 'kings', track: 'judah' },
      { id: 'own', kind: 'event', start: { y: -1000 }, title: 'Own', category: 'kings', color: '#123456' },
      { id: 'grey', kind: 'event', start: { y: -990 }, title: 'Grey', category: 'plain' },
    ],
  };
  const { doc, warnings } = parseDoc(old);
  check('an old file warns once', warnings.map((w) => `${w.code} ${w.path}`), ['fixed categories']);
  check('…its items take their category’s colour, unless they have their own', doc.items.map((i) => i.color), ['#aabbcc', '#123456', undefined]);
  const out = JSON.parse(serializeDoc(doc));
  check('…and categories and tracks are not written back', [out.categories, out.tracks, out.items.some((i) => 'category' in i || 'track' in i)], [undefined, undefined, false]);
}

{
  // A file that does not say its language is English, quietly; a regional tag is kept.
  const json = structuredClone(good);
  delete json.lang;
  const { doc, warnings } = parseDoc(json);
  check('no lang: English, no warning', [doc.lang, warnings], ['en', []]);
  json.lang = 'pt-BR';
  check('a regional language', parseDoc(json).doc.lang, 'pt-BR');
}

{
  // Galleries and card sizes.
  const json = structuredClone(good);
  json.images['4b4b4b4b4b4b4b4b'] = { ext: 'webp', w: 800, h: 600 };
  json.images['5c5c5c5c5c5c5c5c'] = { ext: 'png', w: 800, h: 600 };
  json.items[1].gallery = ['4b4b4b4b4b4b4b4b', '3f9a00c2aa00c2aa', 'dead0000dead0000', '4b4b4b4b4b4b4b4b', '5c5c5c5c5c5c5c5c'];
  json.items[1].size = 'huge';
  json.items[0].size = 'large';
  json.items.push({ id: 'lost', kind: 'event', start: { y: 1 }, title: 'Lost', image: 'dead1111dead1111', gallery: ['5c5c5c5c5c5c5c5c'], size: 'normal' });
  const { doc, warnings } = parseDoc(json);
  check('gallery warnings', warnings.map((w) => `${w.code} ${w.path}`), ['field-dropped items[0].size', 'image-missing items[1].gallery[2]', 'image-missing items[3].image']);
  const flood = doc.items.find((i) => i.id === 'flood');
  check('a gallery drops repeats and the card picture', flood.gallery, ['4b4b4b4b4b4b4b4b', '5c5c5c5c5c5c5c5c']);
  check('a size on an event is kept', flood.size, 'huge');
  const lost = doc.items.find((i) => i.id === 'lost');
  check('a gallery without its first picture moves the next one onto the card', [lost.image, lost.gallery, lost.size], ['5c5c5c5c5c5c5c5c', undefined, undefined]);
  check('gallery pictures are used', [...usedImages(doc)].sort(), ['3f9a00c2aa00c2aa', '4b4b4b4b4b4b4b4b', '5c5c5c5c5c5c5c5c']);
  const text = serializeDoc(doc);
  check('…written after the picture, before the lane', Object.keys(JSON.parse(text).items.find((i) => i.id === 'flood')), ['id', 'kind', 'start', 'title', 'refs', 'image', 'gallery', 'size']);
  check('…and round-trip', serializeDoc(parseDoc(JSON.parse(text)).doc), text);
}

for (const [name, json, expected] of [
  ['not an object', [], 'no object'],
  ['another format', { format: 'kml' }, 'not "timeline"'],
]) {
  let message = '';
  try {
    parseDoc(json);
  } catch (error) {
    message = error instanceof ModelError ? error.message : `wrong error: ${error}`;
  }
  check(`refused: ${name}`, message.includes(expected), true);
}

{
  // Markdown-lite.
  const md = parseMarkdown('In the *beginning*, **God**.\nSee [Genesis](https://bible.example/gen) or https://x.org/a.\n\n[bad](javascript:alert) _end_');
  check('two paragraphs', md.length, 2);
  check('inline kinds', md[0].map((n) => n.kind), ['text', 'em', 'text', 'strong', 'text', 'br', 'text', 'link', 'text', 'link', 'text']);
  check('an unsafe link stays text', md[1][0], { kind: 'text', text: '[bad](javascript:alert)' });
  check('plain text', plainText('A *b* [c](https://d.org)\n\ne'), 'A b c e');
}

{
  // "New timeline": an ASCII id from any title.
  const { newDocId } = await load('core/templates');
  check('a new file’s id is an ASCII slug of its title', [newDocId('The History of the USA'), newDocId('Анна: жизнь'), newDocId('???')], ['the-history-of-the-usa', 'anna-zhizn', 'timeline']);
}

{
  // The chronology's own beginning and end: they set the extent, widened to every item.
  const now = new Date(Date.UTC(2026, 9, 13));
  const base = { format: 'timeline', version: 1, meta: { id: 'x', kind: 'history' }, title: 'X', items: [{ id: 'a', kind: 'event', start: { y: 1950 }, title: 'A' }] };
  const { doc, warnings } = parseDoc({ ...base, start: { y: 1900 }, end: { now: true } });
  check('start and end are read', [warnings, doc.start, doc.end], [[], { y: 1900 }, { now: true }]);
  check('…and written after the sources', Object.keys(JSON.parse(serializeDoc(doc))).slice(5, 7), ['start', 'end']);
  check('the extent runs from the start to today', extentOf(doc, now), [dayOf(1900, 1, 1), dayOf(2026, 10, 14)]);
  const inside = parseDoc({ ...base, start: { y: 1960 }, end: { y: 1955 } });
  check('an end before the start is dropped', inside.warnings.map((w) => w.path), ['end']);
  check('an item outside the start is never cut off', extentOf(inside.doc, now)[0], dayOf(1950, 1, 1));
  const empty = parseDoc({ ...base, items: [], start: { y: 1990, m: 5, d: 17 }, end: { now: true } }).doc;
  check('an empty file with dates spans them', extentOf(empty, now), [dayOf(1990, 5, 17), dayOf(2026, 10, 14)]);
  check('bad dates are dropped', parseDoc({ ...base, start: 'soon', end: { y: 'x' } }).warnings.map((w) => w.path), ['start', 'end']);
}

done('model');
