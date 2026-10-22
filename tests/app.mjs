/**
 * The built page in a real, headless Chrome, opened from file:// as a user
 * would open it. `--shots DIR` saves what the eye should check.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHROME, sleep, startChrome } from '../tools/chrome.mjs';
import { checker, load, root } from '../tools/load.mjs';
import { bigTimeline, sampleTimeline } from '../tools/sample.mjs';

const { check, done } = checker();
const core = await load('core/zip', 'core/model');
const shotsAt = process.argv.indexOf('--shots');
const shotsDir = shotsAt > 0 ? process.argv[shotsAt + 1] ?? 'shots' : null;
const page = join(root, 'build', 'timeline.html');

if (!CHROME) {
  console.log('app: no Chrome found (set CHROME=/path/to/chrome) — skipped');
  process.exit(0);
}
if (!existsSync(page)) {
  console.error('app: build/timeline.html is missing — run `npm run build` first');
  process.exit(1);
}

const work = await mkdtemp(join(tmpdir(), 'timeline-app-'));
const samplePath = join(work, 'flight.timeline');
await writeFile(samplePath, await sampleTimeline());
const bigPath = join(work, 'big.timeline');
await writeFile(bigPath, await bigTimeline(1000, 500));

const { version, homepage } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

/** The same page over http, where OPFS works: it stands in for the system's file dialogs. */
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(root, 'build', path === '/' ? 'timeline.html' : path);
  if (!file.startsWith(join(root, 'build')) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') || file.endsWith('.webmanifest') ? 'application/json' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(await readFile(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;

/** File dialogs answered from OPFS: window.__pick names the file the next one returns. */
const PICKERS = `(() => {
  const root = () => navigator.storage.getDirectory();
  window.__pick = 'saved.timeline';
  window.showSaveFilePicker = async () => (await root()).getFileHandle(window.__pick, { create: true });
  window.showOpenFilePicker = async () => [await (await root()).getFileHandle(window.__pick)];
})();`;

const openTab = (url) => chrome.open(url, url, { script: PICKERS });

/** Reads a file from the page's OPFS as bytes. */
async function opfsBytes(session, name) {
  const b64 = await chrome.evaluate(session, `(async () => {
    const file = await (await (await navigator.storage.getDirectory()).getFileHandle(${JSON.stringify(name)})).getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

const chrome = await startChrome();
const shot = async (session, name) => {
  if (!shotsDir) return;
  await mkdir(shotsDir, { recursive: true });
  await writeFile(join(shotsDir, `${name}.png`), await chrome.screenshot(session));
};
const ev = (session, expression) => chrome.evaluate(session, expression);

/** Puts a file into the hidden <input type=file>, as the Open button's fallback does. */
const openViaInput = (session, path, selector = '#file-input') => chrome.setFiles(session, selector, [path]);

/** Half a second of a quiet tone as a WAV: background music for the tests. */
function toneWav() {
  const rate = 8000;
  const samples = rate / 2;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / rate) * 2000), 44 + i * 2);
  return bytes;
}

try {
  // From the disk, as a user opens it.
  const disk = await chrome.open(pathToFileURL(page).href, 'file');
  check('the script runs from file://', await chrome.until(disk, "document.documentElement.dataset.ready === 'true'"), true);
  check('the version is shown', (await ev(disk, "document.getElementById('version').textContent")).startsWith(version), true);
  check('…and beside it where the project lives, a link that opens in a new tab', await ev(disk, "(() => { const a = document.querySelector('.start-version .home-link'); return [a?.href, a?.target, a?.rel]; })()"), [homepage, '_blank', 'noopener noreferrer']);
  check('nothing was fetched', await ev(disk, "performance.getEntriesByType('resource').length"), 0);
  await openViaInput(disk, samplePath);
  check('a file opens from file://', await chrome.until(disk, "document.querySelectorAll('.card').length > 0"), true);
  check('no errors from file://', chrome.errors, []);

  const tab = await openTab(`${origin}/timeline.html`);
  /** Waits for the strip to come to rest — an animation, inertia, the rebuild after it — instead of a fixed pause. */
  const settled = async () => {
    if (!(await chrome.until(tab, 'timeline.strip.idle'))) check('the strip comes to rest', false, true);
  };
  await chrome.viewport(tab, { width: 1280, height: 800 });
  check('the script ran', await chrome.until(tab, "document.documentElement.dataset.ready === 'true'"), true);
  await shot(tab, '01-start');

  // Open the sample.
  await openViaInput(tab, samplePath);
  check('the file opens', await chrome.until(tab, "!document.getElementById('app').hidden && document.querySelectorAll('.card').length > 0"), true);
  check('the title is shown', await ev(tab, "document.getElementById('doc-title').textContent"), 'A short history of flight');
  await settled();
  const cards = await ev(tab, "[...document.querySelectorAll('.card')].map(c => c.dataset.id)");
  check('fit all shows the large and huge cards, every one of them, and nothing else', await ev(tab, "(() => { const big = timeline.session.doc.items.filter(i => i.kind === 'event' && (i.size === 'large' || i.size === 'huge')).map(i => i.id).sort(); return JSON.stringify([...document.querySelectorAll('.card')].map(c => c.dataset.id).sort()) === JSON.stringify(big) && big.length >= 4; })()"), true);
  check('eras are drawn', await ev(tab, "document.querySelectorAll('.era').length"), 6);
  check('bars are drawn in rows', await ev(tab, "document.querySelectorAll('.bar').length >= 8 && new Set([...document.querySelectorAll('.bar')].map(b => b.style.top)).size > 1"), true);
  check('each item is drawn in its own colour', await ev(tab, "[document.querySelector('.era[data-id=era-space]').style.getPropertyValue('--cat'), document.querySelector('.bar[data-id=aviation-age]').style.getPropertyValue('--cat')]"), ['#4f5486', '#5c6f86']);
  check('the ruler has labels', await ev(tab, "document.querySelectorAll('.tick-label').length > 3"), true);
  check('the anchor ruler is shown', await ev(tab, "!document.querySelector('.ruler--anchor').hidden"), true);
  check('a thumb is read from the file', await chrome.until(tab, "[...document.querySelectorAll('.card-image')].some(i => i.src.startsWith('blob:') && i.complete && i.naturalWidth > 0)"), true);
  check('where cards lie over each other, the later event is on top', await ev(tab, `(() => {
    const cards = [...document.querySelectorAll('.card')].map(c => ({ box: c.getBoundingClientRect(), z: Number(getComputedStyle(c).zIndex), day: timeline.session.doc.items.find(i => i.id === c.dataset.id).start.y }));
    for (const a of cards) for (const b of cards) {
      const over = a.box.left < b.box.right && b.box.left < a.box.right && a.box.top < b.box.bottom && b.box.top < a.box.bottom;
      if (a !== b && over && a.day > b.day && a.z <= b.z) return false;
    }
    return true;
  })()`), true);
  await shot(tab, '02-fit-all');

  // Zoom in around 1969 with Ctrl+wheel; then pan by dragging.
  const box = await ev(tab, "(() => { const r = document.getElementById('strip').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()");
  for (let i = 0; i < 6; i++) {
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box[0] + box[2] * 0.75, y: box[1] + 100, deltaX: 0, deltaY: -120, modifiers: 2 }, tab);
    await sleep(40);
  }
  await settled();
  const more = await ev(tab, "document.querySelectorAll('.card').length");
  check('zooming in shows more cards', more > cards.length, true);
  await shot(tab, '03-zoomed');
  const before = await ev(tab, "document.querySelector('.ruler-layer').style.transform + document.querySelector('.ruler .tick-label')?.textContent");
  await chrome.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box[0] + 600, y: box[1] + 60, button: 'left', clickCount: 1 }, tab);
  for (let i = 1; i <= 10; i++) {
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box[0] + 600 + i * 30, y: box[1] + 60, button: 'left', buttons: 1 }, tab);
    await sleep(16);
  }
  await chrome.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box[0] + 900, y: box[1] + 60, button: 'left', clickCount: 1 }, tab);
  const after = await ev(tab, "document.querySelector('.ruler-layer').style.transform + document.querySelector('.ruler .tick-label')?.textContent");
  await settled();
  check('dragging pans', before !== after, true);

  // Labels of long bars and eras stay at the left edge with every frame of a pan, not only after it.
  await ev(tab, `timeline.strip.goTo(${1960 * 365.2425}, 0.06, false)`);
  await settled();
  const drift = await ev(tab, `(() => {
    const s = timeline.strip;
    const labels = ['.bar[data-id="aviation-age"] .bar-label', '.era[data-id="era-golden"] .era-label'].map((q) => document.querySelector(q));
    const before = labels.map((l) => l.getBoundingClientRect().left);
    let most = 0;
    for (let i = 1; i <= 5; i++) {
      s.setView({ ...s.view, center: s.view.center - 30 / s.view.pxPerDay }, false);
      labels.forEach((l, j) => (most = Math.max(most, Math.abs(l.getBoundingClientRect().left - before[j]))));
    }
    return most;
  })()`);
  check(`labels of long bars and eras stand still while panning (moved ${drift.toFixed(2)} px)`, drift < 0.6, true);

  // The strip starts at the first date: a small margin before it, and no ruler there.
  await ev(tab, `timeline.strip.goTo(${1780 * 365.2425}, 0.3, false)`);
  await settled();
  const edge = await ev(tab, `(() => {
    const s = timeline.strip;
    s.setView({ ...s.view, center: s.view.center - 5000 / s.view.pxPerDay });
    return [Math.round(s.xOf(s.extentDays[0])), getComputedStyle(s.root).getPropertyValue('--start-x').trim()];
  })()`);
  check('panning stops with the first date 40 px from the left edge; the rulers begin there', edge, [40, '40px']);

  // Keyboard: 0 fits, T goes to today, + zooms.
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 }, tab);
  await settled();
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '0', code: 'Digit0', text: '0', windowsVirtualKeyCode: 48 }, tab);
  await settled();
  check('0 fits all again', await ev(tab, "document.querySelectorAll('.era').length"), 6);
  // The scale picker offers the presets and nothing else — only those the file can be shown at.
  await chrome.click(tab, '#scale');
  check('the scale menu for two centuries of flight: a pixel a minute … a pixel a year, ten years (25 px) and coarser not offered', await chrome.until(tab, "[...document.querySelectorAll('.menu--scale .menu-item')].map(b => b.textContent.trim()).join('|') === '1 px = 1 minute|1 px = 1 hour|1 px = 1 day|1 px = 3 days|1 px = 1 week|1 px = 1 month|1 px = 1 season|1 px = 1 year' && !document.querySelector('.menu--scale input')"), true);
  await ev(tab, "[...document.querySelectorAll('.menu--scale .menu-item')].find(b => b.textContent.trim() === '1 px = 1 year').click()");
  check('…a pick zooms to it, and the button says so', await chrome.until(tab, "document.getElementById('scale').textContent === '1 px = 1 year'"), true);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '0', code: 'Digit0', text: '0', windowsVirtualKeyCode: 48 }, tab);
  await settled();

  // Reading: a click opens the details; search finds; Tab walks in time order; Esc steps back.
  await chrome.click(tab, '.card[data-id="moon"]');
  check('a click opens the details', await chrome.until(tab, "!document.getElementById('details').hidden && document.getElementById('details-title').textContent === 'Men on the Moon'"), true);
  check('the large image loads', await chrome.until(tab, "document.querySelector('.details-image')?.src.startsWith('blob:')"), true);
  check('the date line', await ev(tab, "document.querySelector('.details-date').textContent"), '20\u00a0Jul\u00a01969');
  check('markdown in the text', await ev(tab, "document.querySelector('.details-text em')?.textContent"), 'one small step');
  check('the card is selected', await ev(tab, "document.querySelector('.card[data-id=moon]').classList.contains('selected')"), true);
  await shot(tab, '05-details');
  await chrome.click(tab, '.details-step--next');
  check('next goes on in time', await chrome.until(tab, "document.getElementById('details-title').textContent === 'Boeing 747 first flight' || document.getElementById('details-title').textContent !== 'Men on the Moon'"), true);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, tab);
  check('Esc closes the details', await chrome.until(tab, "document.getElementById('details').hidden"), true);

  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', text: '/', windowsVirtualKeyCode: 191 }, tab);
  check('/ opens search', await chrome.until(tab, "document.activeElement?.id === 'search-input'"), true);
  await chrome.send('Input.insertText', { text: 'gagarin' }, tab);
  check('search finds', await chrome.until(tab, "document.querySelectorAll('.search-result').length === 2"), true);
  check('others fade', await chrome.until(tab, "document.querySelectorAll('.faded').length > 5"), true);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }, tab);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, tab);
  check('Enter opens the hit', await chrome.until(tab, "!document.getElementById('details').hidden && /Gagarin/.test(document.getElementById('details-title').textContent)"), true);
  await shot(tab, '06-search');
  await chrome.click(tab, '#search-close');
  check('closing search clears the fade', await chrome.until(tab, "document.querySelectorAll('.faded').length === 0"), true);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, tab);

  await ev(tab, "document.activeElement?.blur()");
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, tab);
  const first = await ev(tab, "document.activeElement?.dataset.id ?? null");
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, tab);
  const second = await ev(tab, "document.activeElement?.dataset.id ?? null");
  check('Tab focuses items in time order', !!first && !!second && first !== second, true);

  // Settings: Russian.
  await chrome.click(tab, '#more');
  await ev(tab, "[...document.querySelectorAll('.menu-item')].find(b => b.textContent.includes('Settings')).click()");
  check('settings open', await chrome.until(tab, "!!document.querySelector('dialog[open] #setting-language')"), true);
  await ev(tab, "(() => { const s = document.getElementById('setting-language'); s.value = 'ru'; s.dispatchEvent(new Event('change')); })()");
  check('the interface switches; the file’s texts stay in the file’s language', await chrome.until(tab, "document.documentElement.lang === 'ru' && document.getElementById('doc-title').textContent === 'A short history of flight' && document.getElementById('doc-title').lang === 'en' && document.querySelector('.cards-layer').lang === 'en'"), true);
  await ev(tab, "document.querySelector('dialog[open] .button--primary').click()");
  await sleep(300);
  await shot(tab, '07-russian');
  await chrome.click(tab, '#more');
  await ev(tab, "[...document.querySelectorAll('.menu-item')].find(b => b.textContent.includes('Настройки')).click()");
  await chrome.until(tab, "!!document.querySelector('dialog[open] #setting-language')");
  await ev(tab, "(() => { const s = document.getElementById('setting-language'); s.value = 'en'; s.dispatchEvent(new Event('change')); document.querySelector('dialog[open] .button--primary').click(); })()");
  check('back to English', await chrome.until(tab, "document.documentElement.lang === 'en'"), true);

  // About: last in the menu before Close — the version and where the project lives.
  await chrome.click(tab, '#more');
  check('About is the last item before Close', await ev(tab, "[...document.querySelectorAll('.menu-item')].slice(-2).map(b => b.textContent)"), ['About Timeline', 'Close']);
  await ev(tab, "[...document.querySelectorAll('.menu-item')].find(b => b.textContent === 'About Timeline').click()");
  check('…it shows the version and links to the project', await chrome.until(tab, `(() => { const d = document.querySelector('dialog[open] .about'); return !!d && d.textContent.includes(${JSON.stringify(version)}) && d.querySelector('.home-link')?.href === ${JSON.stringify(homepage)}; })()`), true);
  await shot(tab, '22-about');
  await ev(tab, "document.querySelector('dialog[open] .button--primary').click()");
  await chrome.until(tab, "!document.querySelector('dialog[open]')");

  // About this timeline: the ⓘ after the title — the sample says when it was made, not who made it.
  await chrome.click(tab, '#doc-info');
  check('ⓘ shows the author, contact, website and date created, each "Not specified" when the file lacks it', await chrome.until(tab, "!!document.querySelector('dialog[open] .doc-info')") && (await ev(tab, "[...document.querySelectorAll('dialog[open] .doc-info dd')].map(d => d.textContent)")), ['Not specified', 'Not specified', 'Not specified', '13\u00a0Oct\u00a02026']);
  await ev(tab, "document.querySelector('dialog[open] .button--primary').click()");
  await chrome.until(tab, "!document.querySelector('dialog[open]')");

  // Editing: move a card (its date stays), undo it, add an event with N, save, reopen.
  const key = (k, code, vk, text) => chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }, tab);
  await ev(tab, "document.activeElement?.blur()");
  await key('e', 'KeyE', 69, 'e');
  check('E turns edit mode on', await chrome.until(tab, "document.getElementById('edit-toggle').getAttribute('aria-pressed') === 'true'"), true);
  await chrome.until(tab, "!!document.querySelector('.card[data-id=wright]')");
  const card = await ev(tab, "(() => { const r = document.querySelector('.card[data-id=wright]').getBoundingClientRect(); return [r.left + 40, r.bottom - 12, r.left]; })()");
  const dateBefore = await ev(tab, "document.querySelector('.card[data-id=wright] .card-date').textContent");
  const startBefore = await ev(tab, "JSON.stringify(timeline.session.doc.items.find(i => i.id === 'wright').start)");
  await chrome.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card[0], y: card[1], button: 'left', clickCount: 1 }, tab);
  for (let i = 1; i <= 8; i++) {
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card[0] + i * 15, y: card[1], button: 'left', buttons: 1 }, tab);
    await sleep(20);
  }
  check('dragging shows the date the card keeps', (await ev(tab, "document.querySelector('.drag-tip')?.textContent ?? ''")).startsWith(dateBefore), true);
  await chrome.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: card[0] + 120, y: card[1], button: 'left', clickCount: 1 }, tab);
  check('a dragged card moves, its date does not', await chrome.until(tab, `(() => { const i = timeline.session.doc.items.find(i => i.id === 'wright'); return i.shift === 120 && JSON.stringify(i.start) === ${JSON.stringify(startBefore)}; })()`), true);
  check('…it stands where it was put, its line leaning to its dot', await chrome.until(tab, `(() => { const c = document.querySelector('.card[data-id=wright]'); return Math.abs(c.getBoundingClientRect().left - ${card[2] + 120}) < 2 && c.querySelector('.card-date').textContent === ${JSON.stringify(dateBefore)}; })()`), true);
  check('…the pointer leans', await ev(tab, "[...document.querySelectorAll('.pointer')].some(p => p.style.transform.startsWith('rotate('))"), true);
  await shot(tab, '23-moved-card');
  check('the title shows unsaved changes', await ev(tab, "!document.getElementById('dirty').hidden"), true);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 }, tab);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 }, tab);
  check('undo puts it back', await chrome.until(tab, `timeline.session.doc.items.find(i => i.id === 'wright').shift === undefined && Math.abs(document.querySelector('.card[data-id=wright]').getBoundingClientRect().left - ${card[2]}) < 2 && document.getElementById('dirty').hidden`), true);

  await ev(tab, "document.activeElement?.blur()");
  await key('n', 'KeyN', 78, 'n');
  check('N opens the editor', await chrome.until(tab, "!!document.querySelector('dialog[open] #edit-title')"), true);
  check('…a new item has no colour of its own', await ev(tab, "document.querySelector('dialog[open] .color-swatch--none').getAttribute('aria-pressed')"), 'true');
  check('…an event’s own window: no kind to switch, no importance, a size, a shape, a card background, pictures', await ev(tab, "(() => { const d = document.querySelector('dialog[open]'); return [d.querySelector('.dialog-title').textContent, !d.querySelector('input[name=kind]'), !d.querySelector('input[name=importance]'), !!d.querySelector('input[name=size][value=huge]'), !!d.querySelector('input[name=shape][value=round]'), d.querySelectorAll('.color-row').length, !!d.querySelector('.gallery-editor')]; })()"), ['New event', true, true, true, true, 2, true]);
  await ev(tab, "(() => { const r = document.querySelector('dialog[open] input[name=size][value=small]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()");
  check('…each size says what it means on the strip', await ev(tab, "document.getElementById('edit-size-hint').textContent.startsWith('Small: a footnote')"), true);
  await ev(tab, `(() => {
    const d = document.querySelector('dialog[open]');
    const title = d.querySelector('#edit-title'); title.value = 'A test event'; title.dispatchEvent(new Event('input'));
    const year = d.querySelector('.date-year'); year.value = '1950';
    d.querySelector('.date-era').value = 'ad';
    const month = d.querySelector('.date-month'); month.value = ''; month.dispatchEvent(new Event('change'));
    d.querySelector('input[name=size][value=large]').checked = true;
    d.querySelector('.color-swatch[data-color="#7b5e8a"]').click();
    d.querySelector('input[name=shape][value=round]').checked = true;
    d.querySelectorAll('.color-row')[1].querySelector('.color-swatch[data-color="#2f3d4c"]').click();
  })()`);
  await shot(tab, '08-editor');
  await ev(tab, "document.querySelector('dialog[open] .button--primary').click()");
  check('the new event is on the strip', await chrome.until(tab, "[...document.querySelectorAll('.card, .dot')].some(el => el.textContent.includes('A test event') || el.title?.includes('A test event'))"), true);
  check('…in the colour picked', await ev(tab, "(() => { const item = timeline.session.doc.items.find(i => i.title === 'A test event'); return [item.color, document.querySelector(`.dot[data-id=${item.id}]`)?.style.getPropertyValue('--cat')]; })()"), ['#7b5e8a', '#7b5e8a']);
  check('…round, on a deep fill with light ink, centred over its dot', await chrome.until(tab, `(() => {
    const item = timeline.session.doc.items.find(i => i.title === 'A test event');
    const card = document.querySelector('.card[data-id=' + item.id + ']'), dot = document.querySelector('.dot[data-id=' + item.id + ']');
    if (!card || item.shape !== 'round' || item.background !== '#2f3d4c' || !card.classList.contains('card--round') || !card.classList.contains('card--filled')) return false;
    const c = card.getBoundingClientRect(), d = dot.getBoundingClientRect();
    return Math.abs(c.left + c.width / 2 - (d.left + d.width / 2)) < 2 && getComputedStyle(card.querySelector('.card-title')).color === 'rgb(246, 239, 225)';
  })()`), true);
  await shot(tab, '09-edited');

  // Adding on the strip: pick a kind in the edit bar, then click (an event) or drag from start to end.
  const mouse = async (type, x, y, extra = {}) => chrome.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...(type === 'mouseMoved' ? { buttons: 1 } : {}), ...extra }, tab);
  const dragFrom = async (x, y, dx, dy, steps = 10) => {
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, tab);
    await mouse('mousePressed', x, y);
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', x + (dx * i) / steps, y + (dy * i) / steps);
      await sleep(16);
    }
    await mouse('mouseReleased', x + dx, y + dy);
  };
  await ev(tab, `timeline.strip.goTo(${1960 * 365.2425}, 0.06, false)`);
  await settled();
  check('the edit bar is shown in edit mode', await ev(tab, "!document.getElementById('edit-bar').hidden && !!document.querySelector('.add-button[data-kind=period]')"), true);
  await chrome.click(tab, '#add-event');
  check('a kind is picked', await ev(tab, "document.body.classList.contains('placing') && document.getElementById('add-event').getAttribute('aria-pressed') === 'true'"), true);
  const strip = await ev(tab, "(() => { const r = document.querySelector('.cards-area').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()");
  const clickDay = await ev(tab, `timeline.strip.dayAt(${strip[2] * 0.3})`);
  await dragFrom(strip[0] + strip[2] * 0.3, strip[1] + 60, 0, 0, 1);
  check('a click on the strip opens a new event there', await chrome.until(tab, "document.querySelector('dialog[open] .dialog-title')?.textContent === 'New event'"), true);
  check('…at the date clicked', Math.abs((await ev(tab, "Number(document.querySelector('dialog[open] .date-year').value)")) - (clickDay / 365.2425 + 1)) < 1.5, true);
  check('…with the title in focus', await ev(tab, "document.activeElement?.id === 'edit-title'"), true);
  await ev(tab, "document.querySelector('dialog[open]').close()");
  await chrome.until(tab, "!document.querySelector('dialog[open]')");

  // A period drawn over the bars, in a colour of the system picker's.
  await chrome.click(tab, '#add-period');
  const band = await ev(tab, "(() => { const b = document.querySelector('.bar[data-id=apollo]').getBoundingClientRect(); return [b.left, b.top + b.height / 2]; })()");
  await dragFrom(band[0] - 260, band[1], 180, 0);
  check('drawing a period opens it with both dates', await chrome.until(tab, "document.querySelector('dialog[open] .dialog-title')?.textContent === 'New period' && !document.querySelector('dialog[open] .editor-end').hidden"), true);
  check('…a period’s own window: no pictures, no shape, no size', await ev(tab, "(() => { const d = document.querySelector('dialog[open]'); return [!d.querySelector('.gallery-editor'), !d.querySelector('input[name=shape]'), !d.querySelector('input[name=size]'), !d.querySelector('input[name=kind]')]; })()"), [true, true, true, true]);
  await ev(tab, `{
    const t = document.querySelector('dialog[open] #edit-title'); t.value = 'Gemini'; t.dispatchEvent(new Event('input'));
    const c = document.querySelector('dialog[open] .color-custom'); c.value = '#123abc'; c.dispatchEvent(new Event('input'));
  }`);
  check('another colour leaves the palette unpicked', await ev(tab, "[document.querySelector('dialog[open] .color-custom').classList.contains('is-picked'), document.querySelectorAll('dialog[open] .color-swatch[aria-pressed=true]').length]"), [true, 0]);
  await ev(tab, "document.querySelector('dialog[open] .button--primary').click()");
  const gemini = await chrome.until(tab, "timeline.session.doc.items.find(i => i.title === 'Gemini')");
  const geminiItem = await ev(tab, "timeline.session.doc.items.find(i => i.title === 'Gemini')");
  check('the drawn period is saved in its colour, ending after it starts', [!!gemini, geminiItem?.kind, geminiItem?.color, geminiItem && (geminiItem.end.y * 12 + (geminiItem.end.m ?? 0)) > (geminiItem.start.y * 12 + (geminiItem.start.m ?? 0))], [true, 'period', '#123abc', true]);
  check('…and is a bar on the strip', await chrome.until(tab, "[...document.querySelectorAll('.bar')].some(b => b.textContent === 'Gemini')"), true);

  // Eras are a list of their own: no drawing them on the strip, no overlaps.
  check('eras are not added on the strip', await ev(tab, "!document.getElementById('add-era') && !!document.getElementById('edit-eras')"), true);
  await ev(tab, "document.querySelector('.era[data-id=era-golden]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
  check('an era opens the list of eras, at its row', await chrome.until(tab, "document.querySelector('dialog[open] .era-row--focus')?.dataset.id === 'era-golden' && document.activeElement?.classList.contains('era-name')"), true);
  check('…in time order, each from where it begins, the last to the present day', await ev(tab, "[[...document.querySelectorAll('dialog[open] .era-row .era-date')].map(i => i.value).join(), document.getElementById('eras-end-mode').value]"), ['1783,1903,1919,1939,1946,1957', 'now']);
  await ev(tab, "(() => { const d = document.querySelectorAll('dialog[open] .era-date')[3]; d.value = '1940'; d.dispatchEvent(new Event('input')); })()");
  check('a beginning moved ends the era above the year before', await ev(tab, "document.querySelectorAll('dialog[open] .era-meta')[2].textContent.startsWith('1919–1939')"), true);
  await ev(tab, "(() => { const d = document.querySelectorAll('dialog[open] .era-date')[3]; d.value = '1900'; d.dispatchEvent(new Event('input')); })()");
  check('a beginning before the era above is refused', await ev(tab, "document.querySelectorAll('dialog[open] .era-meta')[3].classList.contains('era-meta--wrong')"), true);
  await ev(tab, "document.querySelectorAll('dialog[open] .era-date')[0].focus(); document.querySelector('dialog[open] .button--primary').click()");
  check('saving out of order stays open and takes you to the first wrong era', await chrome.until(tab, `(() => {
    const rows = [...document.querySelectorAll('dialog[open] .era-row')];
    const wrong = rows.filter((r) => r.classList.contains('era-row--wrong'));
    return wrong.length === 1 && wrong[0] === rows[3] && document.activeElement === rows[3].querySelector('.era-date') && /“War”/.test(document.querySelector('dialog[open] .form-error').textContent)
      && !document.querySelector('dialog[open] .era-row--focus') && rows[2].querySelector('.era-meta').textContent === '';
  })()`), true);
  await shot(tab, '19-eras-wrong');
  await ev(tab, "(() => { const d = document.querySelectorAll('dialog[open] .era-date')[3]; d.value = '1940'; d.dispatchEvent(new Event('input')); })()");
  // Split the jet age: a new era in its second half.
  await ev(tab, "document.querySelectorAll('dialog[open] .era-row')[4].querySelectorAll('.era-action')[1].click()");
  check('splitting adds a new era in the second half', await ev(tab, "[...document.querySelectorAll('dialog[open] .era-row')].map(r => r.querySelector('.era-name').value + '@' + r.querySelector('.era-date').value)[5]"), 'New era@1951');
  await shot(tab, '18-eras');
  await ev(tab, "document.querySelector('dialog[open] .button--primary').click()");
  check('saved: the eras meet, one command', await chrome.until(tab, `(() => {
    const eras = timeline.session.doc.items.filter(i => i.kind === 'era').sort((a, b) => a.start.y - b.start.y);
    return JSON.stringify(eras.map(e => [e.start.y, e.end.now ? 'now' : e.end.y])) === JSON.stringify([[1783, 1902], [1903, 1918], [1919, 1939], [1940, 1945], [1946, 1950], [1951, 1956], [1957, 'now']]) && timeline.session.history.undoLabel === 'Change the eras';
  })()`), true);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 }, tab);
  check('…and undo puts them back', await chrome.until(tab, "timeline.session.doc.items.filter(i => i.kind === 'era').length === 6 && timeline.session.doc.items.find(i => i.id === 'era-war').start.y === 1939"), true);
  await chrome.click(tab, '#add-period');
  await key('Escape', 'Escape', 27);
  check('Esc puts the kind down', await ev(tab, "!document.body.classList.contains('placing') && document.getElementById('add-period').getAttribute('aria-pressed') === 'false'"), true);

  // Up and down: a bar moves to another row, a card too.
  const apollo = await ev(tab, "(() => { const b = document.querySelector('.bar[data-id=apollo]').getBoundingClientRect(); const p = document.querySelector('.bar[data-id=korolev]').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, p.top + p.height / 2, p.top - document.querySelector('.bars-inner').getBoundingClientRect().top]; })()");
  await dragFrom(apollo[0], apollo[1], 0, apollo[2] - apollo[1], 8);
  const moved = await chrome.until(tab, "Number.isInteger(timeline.session.doc.items.find(i => i.id === 'apollo').lane)");
  const apolloItem = await ev(tab, "timeline.session.doc.items.find(i => i.id === 'apollo')");
  check('a bar dragged up keeps the row it is dropped in', [!!moved, apolloItem.start], [true, { y: 1961 }]);
  check('…drawn there, the others making room', await chrome.until(tab, `Math.abs(document.querySelector('.bar[data-id=apollo]').getBoundingClientRect().top - document.querySelector('.bars-inner').getBoundingClientRect().top - ${apollo[3]}) < 4`), true);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 }, tab);
  check('…and undo takes it back', await chrome.until(tab, "timeline.session.doc.items.find(i => i.id === 'apollo').lane === undefined"), true);
  // Sideways — in its middle or by an end — a bar keeps its dates: they are set in its window.
  const apolloBefore = await ev(tab, "JSON.stringify(timeline.session.doc.items.find(i => i.id === 'apollo'))");
  const undoBefore = await ev(tab, "document.getElementById('undo').title");
  const bar = await ev(tab, "(() => { const b = document.querySelector('.bar[data-id=apollo]').getBoundingClientRect(); return [b.left + b.width / 2, b.right - 2, b.top + b.height / 2]; })()");
  const barCentre = await ev(tab, 'timeline.strip.view.center');
  await dragFrom(bar[0], bar[2], 120, 0, 8);
  await dragFrom(bar[1], bar[2], 80, 0, 8);
  await settled();
  check('a bar dragged sideways, or by its end, keeps its dates, and nothing is done', await ev(tab, `[JSON.stringify(timeline.session.doc.items.find(i => i.id === 'apollo')) === ${JSON.stringify(apolloBefore)}, document.getElementById('undo').title === ${JSON.stringify(undoBefore)}]`), [true, true]);
  check('…the drag was the bar’s: the strip did not pan', await ev(tab, 'timeline.strip.view.center'), barCentre);
  const sputnik = await ev(tab, "(() => { const r = document.querySelector('.card[data-id=sputnik]').getBoundingClientRect(); return [r.left + 30, r.bottom - 10, timeline.strip.placed.get('sputnik').row]; })()");
  await dragFrom(sputnik[0], sputnik[1], 3, -24 * 3, 8);
  check('a card dragged up takes the row it is dropped in', await chrome.until(tab, `timeline.session.doc.items.find(i => i.id === 'sputnik').lane === ${sputnik[2] + 3} && timeline.strip.placed.get('sputnik').row > ${sputnik[2]}`), true);
  check('…its date untouched', await ev(tab, "JSON.stringify(timeline.session.doc.items.find(i => i.id === 'sputnik').start)"), '{"y":1957,"m":10,"d":4}');

  // A gallery: a mosaic on a large card, thumbs and arrows in the details, full screen.
  await ev(tab, `timeline.strip.goTo(${1969.6 * 365.2425}, 0.2, false)`);
  await settled();
  check('a large card shows its gallery as a mosaic', await chrome.until(tab, "document.querySelectorAll('.card[data-id=moon] .card-mosaic img').length === 3"), true);
  check('…and the large image, not the thumb', await chrome.until(tab, "[...document.querySelectorAll('.card[data-id=moon] .card-image')].every(i => i.src.startsWith('blob:'))"), true);
  await chrome.click(tab, '.card[data-id=moon]');
  check('the details show the gallery', await chrome.until(tab, "document.querySelectorAll('#details .gallery-thumb').length === 3 && document.querySelector('.gallery-counter').textContent === '1 / 3'"), true);
  await chrome.click(tab, '.gallery-arrow--next');
  check('…the arrow steps to the next picture, with its caption and credit', await chrome.until(tab, "document.querySelector('.gallery-counter').textContent === '2 / 3' && document.querySelector('#details .details-caption')?.textContent === 'Earthrise' && /William Anders/.test(document.querySelector('#details .details-credit')?.textContent)"), true);
  await chrome.click(tab, '.gallery-zoom');
  check('full screen opens on the same picture', await chrome.until(tab, "!!document.querySelector('dialog.lightbox[open]') && document.querySelector('.lightbox-counter').textContent === '2 / 3'"), true);
  check('…the large image loads', await chrome.until(tab, "document.querySelector('.lightbox-image').src.startsWith('blob:') && document.querySelector('.lightbox-image').naturalWidth > 0"), true);
  await key('ArrowRight', 'ArrowRight', 39);
  check('→ steps in full screen, not on the strip', await chrome.until(tab, "document.querySelector('.lightbox-counter').textContent === '3 / 3'"), true);
  await shot(tab, '13-lightbox');
  await key('Escape', 'Escape', 27);
  check('Esc closes full screen, and the panel follows', await chrome.until(tab, "!document.querySelector('dialog.lightbox') && document.querySelector('.gallery-counter').textContent === '3 / 3'"), true);
  await shot(tab, '14-gallery-details');
  await key('Escape', 'Escape', 27);

  // Photos dropped on a card join its gallery.
  await ev(tab, `(async () => {
    const files = [];
    for (const [i, colour] of ['#2a6', '#a26'].entries()) {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300;
      const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, 400, 300);
      files.push(new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'photo' + i + '.png', { type: 'image/png' }));
    }
    const data = new DataTransfer(); for (const f of files) data.items.add(f);
    document.querySelector('.card[data-id=sputnik]').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  })()`);
  check('photos dropped on a card join its gallery', await chrome.until(tab, "(() => { const s = timeline.session.doc.items.find(i => i.id === 'sputnik'); return !!s.image && s.gallery?.length === 1; })()"), true);
  check('…the card shows them', await chrome.until(tab, "!!document.querySelector('.card[data-id=sputnik] .card-mosaic--2') || document.querySelector('.card[data-id=sputnik] .card-count')?.textContent === '2'"), true);

  // The editor's gallery: pictures in order, the first on the card; reordering puts another one there.
  await ev(tab, "document.querySelector('.card[data-id=moon]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
  check('the editor lists the pictures', await chrome.until(tab, "document.querySelectorAll('dialog[open] .gallery-tile:not(.gallery-tile--add)').length === 3"), true);
  check('…with the size on the strip', await ev(tab, "document.querySelector('dialog[open] input[name=size]:checked').value"), 'large');
  await ev(tab, "document.querySelectorAll('dialog[open] .gallery-tile')[2].click()");
  await ev(tab, "[...document.querySelectorAll('dialog[open] .picture-actions .text-button')].find(b => b.textContent === 'Put on the card').click()");
  await ev(tab, "document.querySelector('dialog[open] input[name=size][value=huge]').click()");
  await shot(tab, '15-editor-gallery');
  await ev(tab, "document.querySelector('dialog[open] .button--primary').click()");
  check('a picture put on the card leads the gallery', await chrome.until(tab, "(() => { const m = timeline.session.doc.items.find(i => i.id === 'moon'); return m.image === 'c3c3c3c3c3c3c3c3' && m.gallery.join() === 'b2b2b2b2b2b2b2b2,d4d4d4d4d4d4d4d4' && m.size === 'huge'; })()"), true);

  // The corner of a card makes it larger.
  await ev(tab, `timeline.strip.goTo(${1960 * 365.2425}, 0.06, false)`);
  await settled();
  await ev(tab, "timeline.strip.selected = 'gagarin-flight'; timeline.strip.refresh()");
  await settled();
  const corner = await ev(tab, "(() => { const r = document.querySelector('.card[data-id=\"gagarin-flight\"] .card-resize').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
  await dragFrom(corner[0], corner[1], 90, -10, 6);
  check('dragging a large card’s corner makes it huge', await chrome.until(tab, "timeline.session.doc.items.find(i => i.id === 'gagarin-flight').size === 'huge'"), true);
  check('…and it is drawn huge, however crowded — over its neighbours if it must', await chrome.until(tab, "document.querySelector('.card[data-id=\"gagarin-flight\"]')?.classList.contains('card--huge')"), true);
  await shot(tab, '12-edit-bar');
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 }, tab);
  check('…undo makes it large again', await chrome.until(tab, "timeline.session.doc.items.find(i => i.id === 'gagarin-flight').size === 'large'"), true);

  // Without an end of its own the strip stops at its last item just the same: room for the cards there, no years of empty ruler.
  check('without an end the strip stops at its last item', await ev(tab, "(() => { const keep = timeline.strip.view; timeline.strip.setView({ ...keep, center: 1e8 }, false); const v = timeline.strip.view; const ok = !timeline.session.doc.end && Math.abs(v.center + v.width / 2 / v.pxPerDay - (timeline.strip.extentDays[1] + timeline.strip.margins(v.pxPerDay)[1] / v.pxPerDay)) < 1 / v.pxPerDay; timeline.strip.setView(keep); return ok; })()"), true);

  // The timeline's own settings: another paper, squares, sans titles, an end at today — previewed live, kept in the file, undone and redone.
  check('the pencil on the edit bar opens the timeline settings, not the menu', await ev(tab, "!document.getElementById('timeline-settings').closest('[hidden]')"), true);
  await chrome.click(tab, '#timeline-settings');
  check('Timeline settings open from the edit bar', await chrome.until(tab, "document.querySelector('dialog[open] #timeline-title')?.value === timeline.session.doc.title"), true);
  await ev(tab, "document.querySelector('dialog[open] .color-swatch[data-color=\"#e7eef6\"]').click(); document.querySelector('dialog[open] input[name=timeline-texture][value=grid]').click(); document.querySelector('dialog[open] input[name=timeline-font][value=sans]').click(); const e = document.querySelector('dialog[open] #timeline-end'); e.value = 'now'; e.dispatchEvent(new Event('change'))");
  check('…the paper and its squares are previewed at once', await ev(tab, "[document.documentElement.style.getPropertyValue('--paper'), document.documentElement.dataset.texture]"), ['#e7eef6', 'grid']);
  // Background music: any audio file, named for what it is.
  const musicPath = join(work, 'air.wav');
  await writeFile(musicPath, toneWav());
  await openViaInput(tab, musicPath, '#timeline-music-input');
  check('…music chosen, named after its file', await chrome.until(tab, "document.querySelector('dialog[open] #timeline-music-title')?.value === 'air' && /WAV/.test(document.querySelector('dialog[open] .music-name').textContent)"), true);
  await ev(tab, "(() => { const t = document.querySelector('dialog[open] #timeline-music-title'); t.value = 'A quiet tone'; })()");
  // The author: optional, a website only as a web address (the browser itself turns away what is not an address at all).
  await ev(tab, "(() => { const d = document.querySelector('dialog[open]'); d.querySelector('#timeline-author-name').value = 'Anna Petrova'; d.querySelector('#timeline-author-url').value = 'ftp://anna.example.org'; d.querySelector('#timeline-author-contact').value = 'anna@example.org'; })()");
  await ev(tab, "document.querySelector('dialog[open] .button--primary').click()");
  check('…a website that is not a web address is refused, and the form stays', await ev(tab, "[!!document.querySelector('dialog[open] #timeline-title'), document.querySelector('dialog[open] .form-error').textContent]"), [true, 'The website must start with https:// or http://']);
  await ev(tab, "document.querySelector('dialog[open] #timeline-author-url').value = 'https://anna.example.org'");
  await shot(tab, '16-timeline-settings');
  await ev(tab, "document.querySelector('dialog[open] .button--primary').click()");
  check('…the author is kept in the file', await chrome.until(tab, "JSON.stringify(timeline.session.doc.author) === JSON.stringify({ name: 'Anna Petrova', url: 'https://anna.example.org', contact: 'anna@example.org' })"), true);
  check('…the music is the file’s, and plays', await chrome.until(tab, "timeline.session.doc.music?.ext === 'wav' && timeline.session.doc.music.title === 'A quiet tone' && !document.getElementById('music-toggle').hidden"), true);
  // A browser may wait for the reader's hand before sound: a click on the title is one.
  await chrome.click(tab, '#doc-title');
  check('…playing, at the latest after the first click', await chrome.until(tab, "document.getElementById('music-toggle').dataset.state === 'playing'", 5000), true);
  await chrome.click(tab, '#music-toggle');
  check('…the speaker turns it off, and the setting with it', await chrome.until(tab, "document.getElementById('music-toggle').getAttribute('aria-pressed') === 'false' && timeline.settings.music === false && document.getElementById('music-toggle').dataset.state === 'off'"), true);
  await chrome.click(tab, '#music-toggle');
  check('…and on again', await chrome.until(tab, "timeline.settings.music === true && document.getElementById('music-toggle').dataset.state === 'playing'", 5000), true);
  check('…and kept in the file', await chrome.until(tab, "JSON.stringify([timeline.session.doc.style, timeline.session.doc.end]) === JSON.stringify([{ paper: '#e7eef6', texture: 'grid', font: 'sans' }, { now: true }])"), true);
  check('…squares, sans titles', await ev(tab, "[getComputedStyle(document.body).backgroundImage.startsWith('linear-gradient'), getComputedStyle(document.querySelector('.card-title') ?? document.body).fontFamily.includes('system-ui')]"), [true, true]);
  const viewBefore = await ev(tab, 'timeline.strip.view');
  await ev(tab, "timeline.strip.setView({ ...timeline.strip.view, center: 1e8 })");
  check('…with an end the strip stops there, as at the start', await ev(tab, "(() => { const v = timeline.strip.view; return Math.abs(v.center + v.width / 2 / v.pxPerDay - (timeline.strip.extentDays[1] + timeline.strip.margins(v.pxPerDay)[1] / v.pxPerDay)) < 1 / v.pxPerDay; })()"), true);
  await settled();
  check('…leaving room for the last event’s card: it is whole on the screen', await chrome.until(tab, `(() => {
    const strip = document.getElementById('strip').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.card')];
    return cards.length > 0 && cards.every((c) => c.getBoundingClientRect().right <= strip.right + 0.5);
  })()`), true);
  await ev(tab, `timeline.strip.setView(${JSON.stringify(viewBefore)})`);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 }, tab);
  check('…undo puts the parchment back', await chrome.until(tab, "!timeline.session.doc.style && !document.documentElement.style.getPropertyValue('--paper')"), true);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 10 }, tab);
  check('…redo brings the blue paper again', await chrome.until(tab, "timeline.session.doc.style?.paper === '#e7eef6'"), true);
  await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, tab);
  check('…in the dark theme the paper is dark blue', await chrome.until(tab, "(() => { const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number); return r < 40 && b > r; })()"), true);
  await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, tab);
  await chrome.until(tab, "document.documentElement.dataset.theme === 'light'");

  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 }, tab);
  check('Ctrl+S saves', await chrome.until(tab, "document.getElementById('dirty').hidden && [...document.querySelectorAll('.toast')].some(t => t.textContent.startsWith('Saved'))"), true);
  const saved = await opfsBytes(tab, 'saved.timeline');
  const zip = await core.openZip(core.bytesSource(saved));
  const savedDoc = core.parseDoc(JSON.parse(await zip.text(zip.get('timeline.json'))));
  check('the saved file has the new event', savedDoc.doc.items.some((i) => i.title === 'A test event' && i.start.y === 1950 && i.size === 'large' && i.shape === 'round' && i.background === '#2f3d4c'), true);
  const savedMoon = savedDoc.doc.items.find((i) => i.id === 'moon');
  const savedSputnik = savedDoc.doc.items.find((i) => i.id === 'sputnik');
  check('…the gallery and the size', [savedMoon.image, savedMoon.gallery, savedMoon.size], ['c3c3c3c3c3c3c3c3', ['b2b2b2b2b2b2b2b2', 'd4d4d4d4d4d4d4d4'], 'huge']);
  check('…the dropped photos, both sizes', [savedSputnik.gallery.length, zip.has(`images/${savedSputnik.gallery[0]}.webp`), zip.has(`thumbs/${savedSputnik.gallery[0]}.webp`)], [1, true, true]);
  check('…the row fixed by hand', savedSputnik.lane > 0, true);
  check('…the timeline’s look and end', [savedDoc.doc.style, savedDoc.doc.end], [{ paper: '#e7eef6', texture: 'grid', font: 'sans' }, { now: true }]);
  check('…its music, in the zip as it was chosen', [savedDoc.doc.music?.title, zip.has(`audio/${savedDoc.doc.music?.file}.wav`), Buffer.compare(Buffer.from(await zip.read(zip.get(`audio/${savedDoc.doc.music?.file}.wav`))), toneWav())], ['A quiet tone', true, 0]);
  check('the saved file validates', savedDoc.warnings, []);
  const original = await core.openZip(core.bytesSource(await readFile(samplePath)));
  const same = async (name) => Buffer.compare(Buffer.from(await zip.raw(zip.get(name))), Buffer.from(await original.raw(original.get(name)))) === 0;
  check('images are copied byte for byte', [await same('images/a1a1a1a1a1a1a1a1.svg'), await same('images/b2b2b2b2b2b2b2b2.svg')], [true, true]);
  check('meta.modified and the generator are stamped', [savedDoc.doc.meta.generator.startsWith('timeline '), /^\d{4}-\d{2}-\d{2}$/.test(savedDoc.doc.meta.modified)], [true, true]);

  // Regressions from review: Enter in an editor field saves (never deletes); a file that fails to open
  // leaves the open one alone; a deleted item's picture leaves the file cleanly and undo brings it back.
  await ev(tab, "document.activeElement?.blur(); timeline.strip.selected = 'moon'");
  await ev(tab, "document.querySelector('.card[data-id=moon], .dot[data-id=moon]')?.focus()");
  await key('e', 'KeyE', 69, 'e');
  check('E opens the editor on the focused item', await chrome.until(tab, "document.querySelector('dialog[open] #edit-title')?.value === 'Men on the Moon'"), true);
  await ev(tab, "const t = document.querySelector('dialog[open] #edit-title'); t.value = 'Men on the Moon!'; t.dispatchEvent(new Event('input')); t.focus()");
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, tab);
  check('Enter in a field saves, it does not delete', await chrome.until(tab, "!document.querySelector('dialog[open]') && timeline.session.doc.items.find(i => i.id === 'moon')?.title === 'Men on the Moon!'"), true);
  const notTimeline = join(work, 'notes.txt');
  await writeFile(notTimeline, 'just some text');
  await openViaInput(tab, notTimeline);
  check('a file that is not a timeline does not close the open one', await chrome.until(tab, "[...document.querySelectorAll('.toast')].some(t => /not a timeline/.test(t.textContent))"), true);
  check('…the timeline is still open', await ev(tab, "!!timeline.session && !document.getElementById('app').hidden"), true);
  // The Wright brothers' picture is theirs alone (the Moon's is also the cover, and stays).
  await ev(tab, "timeline.strip.selected = 'wright'; document.querySelector('[data-id=wright]')?.focus()");
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 }, tab);
  check('Delete removes the item', await chrome.until(tab, "!timeline.session.doc.items.some(i => i.id === 'wright')"), true);
  await ev(tab, "window.__pick = 'saved.timeline'");
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 }, tab);
  await chrome.until(tab, "document.getElementById('dirty').hidden");
  const pruned = await core.openZip(core.bytesSource(await opfsBytes(tab, 'saved.timeline')));
  const prunedDoc = core.parseDoc(JSON.parse(await pruned.text(pruned.get('timeline.json'))));
  check('the picture of a deleted item leaves the file without a trace', [prunedDoc.warnings, !!prunedDoc.doc.images.a1a1a1a1a1a1a1a1, pruned.has('images/a1a1a1a1a1a1a1a1.svg'), pruned.has('images/b2b2b2b2b2b2b2b2.svg')], [[], false, false, true]);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 }, tab);
  await ev(tab, "timeline.strip.goTo(" + String(1903 * 365.2425) + ", 0.3, false)");
  check('undo after the save brings the item back with its picture', await chrome.until(tab, "timeline.session.doc.items.some(i => i.id === 'wright') && [...document.querySelectorAll('.card[data-id=wright] img')].some(i => i.src.startsWith('blob:') && i.naturalWidth > 0)"), true);
  check('the edits left no recovery draft behind', await ev(tab, `new Promise((resolve) => { const r = indexedDB.open('timeline'); r.onsuccess = () => { const q = r.result.transaction('drafts').objectStore('drafts').count(); q.onsuccess = () => resolve(q.result); }; })`), 0);
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 }, tab);
  await chrome.until(tab, "document.getElementById('dirty').hidden");

  // Reopen what was saved: the event is there.
  await chrome.click(tab, '#home');
  check('closing goes to the start', await chrome.until(tab, "!document.getElementById('start').hidden"), true);
  await chrome.click(tab, '#open-file');
  check('reopening finds the event', await chrome.until(tab, "document.getElementById('doc-title').textContent === 'A short history of flight' && !document.getElementById('app').hidden"), true);
  await key('e', 'KeyE', 69, 'e');
  await key('0', 'Digit0', 48, '0');
  await settled();
  check('the saved event is in the reopened file', await ev(tab, "[...document.querySelectorAll('.card, .dot')].some(el => el.textContent.includes('A test event') || el.title?.includes('A test event'))"), true);
  check('…with its colour', await ev(tab, "timeline.session.doc.items.find(i => i.title === 'A test event')?.color"), '#7b5e8a');
  await key('e', 'KeyE', 69, 'e');

  // New → the settings form on an empty file (dates, scale, a pasted cover) → an event with a pasted picture → save.
  await chrome.click(tab, '#home');
  await chrome.until(tab, "!document.getElementById('start').hidden");
  await chrome.click(tab, '#new-timeline');
  await chrome.until(tab, "!!document.querySelector('dialog[open] #timeline-title')");
  check('a new file is in the interface’s language unless picked otherwise', await ev(tab, "document.getElementById('timeline-lang').value"), 'en');
  const pasteImage = (selector, name, color) => `(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const g = c.getContext('2d'); g.fillStyle = '${color}'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#345'; g.beginPath(); g.arc(320, 240, 150, 0, 7); g.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const data = new DataTransfer(); data.items.add(new File([blob], '${name}', { type: 'image/png' }));
    document.querySelector('${selector}').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  })()`;
  // Written in Russian from an English interface: the file's language is its own.
  await ev(tab, `(() => {
    const d = document.querySelector('dialog[open]');
    d.querySelector('#timeline-title').value = 'Anna: жизнь';
    d.querySelector('#timeline-lang').value = 'ru';
    const s = d.querySelector('#timeline-start'); s.value = 'date'; s.dispatchEvent(new Event('change'));
    const f = d.querySelector('.date-field'); f.querySelector('.date-year').value = '1990'; f.querySelector('.date-month').value = '5'; f.querySelector('.date-month').dispatchEvent(new Event('change')); f.querySelector('.date-day').value = '17';
    const e = d.querySelector('#timeline-end'); e.value = 'now'; e.dispatchEvent(new Event('change'));
    d.querySelector('#timeline-scale').value = JSON.stringify({ px: 1, unit: 'day', count: 1 });
    const a = d.querySelector('#timeline-anchor'); a.checked = true; a.dispatchEvent(new Event('change'));
    d.querySelector('#timeline-anchor-label').value = 'Возраст';
  })()`);
  await ev(tab, pasteImage('dialog[open] .timeline-settings', 'cover.png', '#9ab'));
  check('a pasted picture is the cover', await chrome.until(tab, "document.querySelector('dialog[open] .cover-tile-image')?.src.startsWith('blob:')"), true);
  await shot(tab, '17-new-timeline');
  await ev(tab, "document.querySelector('dialog[open] .button--primary').click()");
  check('the new timeline opens, in the language picked, in edit mode', await chrome.until(tab, "document.getElementById('doc-title').textContent === 'Anna: жизнь' && timeline.session.doc.lang === 'ru' && timeline.editing"), true);
  check('…from the date to today, with its cover', await ev(tab, "(() => { const d = timeline.session.doc; return [d.start, d.end, !!d.images[d.cover], d.meta.id]; })()"), [{ y: 1990, m: 5, d: 17 }, { now: true }, true, 'anna-zhizn']);
  check('…counting the age from the day it begins on the second ruler', await chrome.until(tab, "!document.querySelector('.ruler--anchor').hidden && document.querySelector('.ruler--anchor .ruler-name').textContent.startsWith('Возраст')"), true);
  check('…which the file keeps as its anchor', await ev(tab, 'timeline.session.doc.anchor'), { label: 'Возраст', at: { y: 1990, m: 5, d: 17 } });
  // The paper after today is the strip's own margin: wide enough for the today label, in whatever font the system has.
  check('…at today, at the scale it opens at', await chrome.until(tab, "Math.abs(timeline.strip.view.pxPerDay - 1) < 0.001 && Math.abs(timeline.strip.view.center + timeline.strip.view.width / 2 - timeline.strip.extentDays[1] - timeline.strip.margins(1)[1]) < 1"), true);
  await shot(tab, '10-my-life');
  await key('n', 'KeyN', 78, 'n');
  check('the editor writes in the file’s language', await chrome.until(tab, "document.querySelector('dialog[open] #edit-title')?.lang === 'ru' && !document.querySelector('dialog[open] .lang-tab')"), true);
  await ev(tab, "(() => { const t = document.querySelector('dialog[open] #edit-title'); t.value = 'First day at school'; t.dispatchEvent(new Event('input')); })()");
  await ev(tab, pasteImage('dialog[open] .editor', 'school.png', '#c97'));
  check('a pasted picture shows in the editor', await chrome.until(tab, "document.querySelector('dialog[open] img.editor-image')?.src.startsWith('blob:') && !document.querySelector('dialog[open] img.editor-image').hidden"), true);
  await ev(tab, "document.querySelector('dialog[open] .button--primary').click()");
  check('the event with its picture is on the strip', await chrome.until(tab, "[...document.querySelectorAll('.card')].some(c => c.textContent.includes('First day at school') && c.querySelector('img')?.src.startsWith('blob:'))"), true);
  await ev(tab, "window.__pick = 'life.timeline'");
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 }, tab);
  check('the new file saves', await chrome.until(tab, "document.getElementById('dirty').hidden"), true);
  const life = await core.openZip(core.bytesSource(await opfsBytes(tab, 'life.timeline')));
  const lifeDoc = core.parseDoc(JSON.parse(await life.text(life.get('timeline.json'))));
  const school = lifeDoc.doc.items.find((i) => i.title === 'First day at school');
  check('the saved life has the picture, both sizes, as WebP', [!!school?.image, life.has(`images/${school?.image}.webp`), life.has(`thumbs/${school?.image}.webp`), lifeDoc.doc.images[school?.image]?.w], [true, true, true, 640]);
  check('…and validates, in one language', [lifeDoc.warnings, lifeDoc.doc.lang], [[], 'ru']);
  check('…with its cover in the zip', [life.has(`images/${lifeDoc.doc.cover}.webp`), life.has(`thumbs/${lifeDoc.doc.cover}.webp`)], [true, true]);
  await key('e', 'KeyE', 69, 'e');

  // Export as a web page (export.ts): the sample with music, both ways, each opened from the disk as a reader would.
  const musical = join(work, 'flight-music.timeline');
  await writeFile(musical, await sampleTimeline({ music: { file: 'e5e5e5e5e5e5e5e5', ext: 'wav', title: 'A quiet tone' } }, { 'audio/e5e5e5e5e5e5e5e5.wav': toneWav() }));
  const exporter = await openTab(`${origin}/timeline.html`);
  await chrome.viewport(exporter, { width: 1280, height: 800 });
  await chrome.until(exporter, "document.documentElement.dataset.ready === 'true'");
  await openViaInput(exporter, musical);
  await chrome.until(exporter, "document.querySelectorAll('.card').length > 0");
  const exportAs = async (name, where) => {
    // The reader opened last is in front: a tab behind it would not finish closing its dialog.
    await chrome.send('Page.bringToFront', {}, exporter);
    await ev(exporter, `window.__pick = ${JSON.stringify(name)}`);
    await chrome.click(exporter, '#more');
    await ev(exporter, "[...document.querySelectorAll('.menu-item')].find(b => b.textContent.startsWith('Export as a web page')).click()");
    check(`export (${where}): the dialog asks where the pictures go`, await chrome.until(exporter, "document.querySelectorAll('dialog[open] input[name=export-where]').length === 2"), true);
    if (where === 'folder') await shot(exporter, '20-export');
    await ev(exporter, `document.querySelector('dialog[open] input[value=${where}]').click(); document.querySelector('dialog[open] .button--primary').click()`);
    check(`export (${where}): done`, await chrome.until(exporter, `[...document.querySelectorAll('.toast-text')].some(t => t.textContent.startsWith('Exported ${name}'))`), true);
    return opfsBytes(exporter, name);
  };
  /** Opens an exported page from file:// and checks it shows the sample, read-only, pictures and music included. */
  const readExport = async (path, label) => {
    const reader = await chrome.open(pathToFileURL(path).href, label);
    await chrome.viewport(reader, { width: 1280, height: 800 });
    check(`${label}: opens at once on its timeline`, await chrome.until(reader, "document.getElementById('start').hidden && document.getElementById('doc-title').textContent === 'A short history of flight' && document.querySelectorAll('.card').length > 0"), true);
    check(`${label}: its pictures show`, await chrome.until(reader, "(() => { const imgs = [...document.querySelectorAll('.card img')]; return imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0); })()"), true);
    check(`${label}: nothing to edit, close or save`, await ev(reader, "[timeline.readOnly, document.getElementById('edit-toggle').hidden, document.getElementById('home').hidden]"), [true, true, true]);
    await ev(reader, 'document.activeElement?.blur()');
    await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, text: 'e' }, reader);
    await sleep(150);
    check(`${label}: E does not turn edit mode on`, await ev(reader, "[timeline.editing, document.getElementById('edit-bar').hidden]"), [false, true]);
    await chrome.click(reader, '#more');
    check(`${label}: the menu has printing, settings and About only`, await ev(reader, "[...document.querySelectorAll('.menu-item')].map(b => b.textContent)"), ['Print or save as PDF', 'Settings', 'About Timeline']);
    await ev(reader, "document.querySelector('.menu-item').closest('.menu') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    await chrome.click(reader, '#doc-info');
    check(`${label}: ⓘ tells who made it and when`, await chrome.until(reader, "document.querySelector('dialog[open] .doc-info')?.textContent.includes('2026')"), true);
    await ev(reader, "document.querySelector('dialog[open] .button--primary').click()");
    await chrome.until(reader, "!document.querySelector('dialog[open]')");
    await chrome.click(reader, '.card');
    check(`${label}: a card opens its details, with no Edit`, await chrome.until(reader, "!document.getElementById('details').hidden && ![...document.querySelectorAll('#details button')].some(b => b.textContent === 'Edit')"), true);
    check(`${label}: the music plays`, await chrome.until(reader, "document.getElementById('music-toggle').dataset.state === 'playing'", 5000), true);
    check(`${label}: the policy fetches nothing`, /connect-src 'none'/.test(await ev(reader, "document.querySelector('meta[http-equiv=Content-Security-Policy]').content")), true);
    return reader;
  };

  const single = Buffer.from(await exportAs('flight.html', 'inside')).toString('utf8');
  check('inside: one page, the .timeline in it, nothing of the PWA', [single.includes('id="timeline-zip"'), /<link rel="manifest"|<meta name="service-worker"/.test(single)], [true, false]);
  const singlePath = join(work, 'export', 'flight.html');
  await mkdir(dirname(singlePath), { recursive: true });
  await writeFile(singlePath, single);
  const singleReader = await readExport(singlePath, 'inside');
  check('inside: pictures come out of the page', await ev(singleReader, "[...document.querySelectorAll('.card img')].every(i => i.src.startsWith('blob:'))"), true);

  const zipped = await core.openZip(core.bytesSource(await exportAs('flight-music.zip', 'folder')));
  const names = zipped.entries.map((e) => e.name).sort();
  check('folder: the page and its media in one folder', [names.includes('flight-music/index.html'), names.includes('flight-music/media/images/a1a1a1a1a1a1a1a1.svg'), names.includes('flight-music/media/audio/e5e5e5e5e5e5e5e5.wav'), names.every((n) => n.startsWith('flight-music/'))], [true, true, true, true]);
  const site = join(work, 'site');
  for (const entry of zipped.entries) {
    await mkdir(dirname(join(site, entry.name)), { recursive: true });
    await writeFile(join(site, entry.name), await zipped.read(entry));
  }
  const folderHtml = await readFile(join(site, 'flight-music', 'index.html'), 'utf8');
  check('folder: the page holds no picture', [folderHtml.includes('id="timeline-zip"'), folderHtml.length < single.length], [false, true]);
  const folderReader = await readExport(join(site, 'flight-music', 'index.html'), 'folder');
  check('folder: pictures come from the folder', await ev(folderReader, "[...document.querySelectorAll('.card img')].every(i => i.src.startsWith('file:') && i.src.includes('/media/images/'))"), true);
  await shot(folderReader, '21-exported');
  check('no errors in the exported pages', chrome.errors, []);
  await chrome.send('Page.bringToFront', {}, tab);

  // Budgets (Task §11): a file with 500 pictures opens in < 300 ms; a rebuild with 1000 items on screen is quick.
  await chrome.click(tab, '#home');
  await chrome.until(tab, "!document.getElementById('start').hidden");
  await ev(tab, "window.__t0 = 0; document.getElementById('file-input').addEventListener('change', () => (window.__t0 = performance.now()), { once: true }); window.addEventListener('timeline:opened', () => (window.__opened = performance.now() - window.__t0), { once: true })");
  await openViaInput(tab, bigPath);
  check('the big file opens', await chrome.until(tab, "window.__opened > 0", 15000), true);
  const openMs = await ev(tab, 'window.__opened');
  check(`a file with 500 pictures opens in < 300 ms (${openMs.toFixed(0)} ms)`, openMs < 300, true);
  check('opening read no picture beyond what the screen shows', await ev(tab, "timeline.session.store.held <= document.querySelectorAll('.card .card-image').length"), true);
  const perf = await ev(tab, `(() => {
    const s = timeline.strip;
    s.fit(false);
    s.showMinor = true;
    s.build();
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) { s.view = { ...s.view, center: s.view.center + (i % 2 ? 300 : -300) }; s.build(); }
    const build = (performance.now() - t0) / 10;
    const t1 = performance.now();
    for (let i = 0; i < 120; i++) s.setView({ ...s.view, center: s.view.center + 20 }, false);
    const pan = (performance.now() - t1) / 120;
    return { build, pan, items: document.querySelectorAll('.card, .dot').length };
  })()`);
  console.log(`  budget: rebuild ${perf.build.toFixed(1)} ms with ${perf.items} cards and dots; a pan step ${perf.pan.toFixed(2)} ms`);
  check('a rebuild with ~1000 items takes < 50 ms', perf.build < 50, true);
  check('a pan step takes < 4 ms (one transform)', perf.pan < 4, true);

  // A phone, dark, by touch.
  await chrome.viewport(tab, { width: 390, height: 844, mobile: true, scale: 2 });
  await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, tab);
  check('dark paper follows the system', await chrome.until(tab, "getComputedStyle(document.body).backgroundColor === 'rgb(29, 24, 20)'"), true);
  await ev(tab, 'timeline.strip.fit(false)');
  await settled();
  const centreBefore = await ev(tab, 'timeline.strip.view.center');
  const touch = (type, points) => chrome.send('Input.dispatchTouchEvent', { type, touchPoints: points }, tab);
  await touch('touchStart', [{ x: 300, y: 300 }]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [{ x: 300 - i * 25, y: 300 }]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await settled();
  check('a finger pans', (await ev(tab, 'timeline.strip.view.center')) !== centreBefore, true);
  const pxBefore = await ev(tab, 'timeline.strip.view.pxPerDay');
  await touch('touchStart', [{ x: 150, y: 300, id: 1 }, { x: 240, y: 300, id: 2 }]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [{ x: 150 - i * 10, y: 300, id: 1 }, { x: 240 + i * 10, y: 300, id: 2 }]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await settled();
  check('a pinch zooms in', (await ev(tab, 'timeline.strip.view.pxPerDay')) > pxBefore, true);
  await shot(tab, '04-phone-dark');
  await chrome.viewport(tab, { width: 1280, height: 800 });
  await chrome.send('Emulation.setEmulatedMedia', { features: [] }, tab);

  check('no errors in the page', chrome.errors, []);
} finally {
  await chrome.close();
  server.close();
  await rm(work, { recursive: true, force: true });
}
done('app');
