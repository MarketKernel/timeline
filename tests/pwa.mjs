/**
 * The PWA (build/pages/) in headless Chrome: the worker takes the page, the
 * manifest parses and the app is installable, the shelf opens a chronology and
 * keeps one offline, the page and the kept file work with the server down, a new
 * deploy waits for the Update button, and a file "double-clicked" through
 * launchQueue opens. The test's own server can drop off the network and can
 * serve a different sw.js, as a new deploy would. The build puts no library
 * beside the PWA, so the test serves its own as library/, made from the
 * fixtures (tools/sample.mjs). `--shots DIR` saves the shelf.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME, sleep, startChrome } from '../tools/chrome.mjs';
import { checker, root } from '../tools/load.mjs';
import { sampleLibrary } from '../tools/sample.mjs';

const { check, done } = checker();
const shotsAt = process.argv.indexOf('--shots');
const shotsDir = shotsAt > 0 ? process.argv[shotsAt + 1] ?? 'shots' : null;
const pages = join(root, 'build', 'pages');
if (!CHROME) {
  console.log('pwa: no Chrome found — skipped');
  process.exit(0);
}
if (!existsSync(join(pages, 'index.html'))) {
  console.error('pwa: build/pages is missing — run `npm run build` first');
  process.exit(1);
}
const library = await mkdtemp(join(tmpdir(), 'timeline-shelf-'));
await sampleLibrary(library);

let offline = false;
let deploy = 0;
const sockets = new Set();
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript', json: 'application/json', webmanifest: 'application/manifest+json', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', timeline: 'application/zip' };
const server = createServer(async (req, res) => {
  if (offline) {
    req.socket.destroy();
    return;
  }
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/app/, ''));
  const [dir, rest] = path.startsWith('/library/') ? [library, path.slice('/library'.length)] : [pages, path];
  const file = join(dir, rest === '/' || rest === '' ? 'index.html' : rest);
  if (!file.startsWith(dir) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  let body = await readFile(file);
  // A new deploy: the same page, another worker (another version and cache name).
  if (file.endsWith('sw.js') && deploy) body = Buffer.from(body.toString().replace(/const CACHE = '([^']+)'/, `const CACHE = '$1-deploy${deploy}'`).replace(/const VERSION = '([^']+)'/, `const VERSION = '9.9.${deploy}'`));
  res.writeHead(200, { 'content-type': TYPES[file.split('.').pop()] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
const url = `${origin}/app/`;

const LAUNCH = `Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer(consumer) { window.__launch = consumer; } } });`;

const chrome = await startChrome();
const ev = (session, expression) => chrome.evaluate(session, expression);
try {
  const tab = await chrome.open(url, 'pwa', { script: LAUNCH });
  check('the page loads', await chrome.until(tab, "document.documentElement.dataset.ready === 'true'"), true);
  check('the worker installs', await chrome.until(tab, "navigator.serviceWorker.getRegistration().then(r => !!r?.active)", 15000), true);
  await chrome.send('Page.reload', {}, tab);
  check('the worker controls the page', await chrome.until(tab, "!!navigator.serviceWorker.controller && document.documentElement.dataset.ready === 'true'"), true);
  let manifest;
  for (let attempt = 0; attempt < 5 && !manifest; attempt++) {
    manifest = await chrome.send('Page.getAppManifest', {}, tab).catch(() => null);
    if (!manifest) await sleep(300);
  }
  check('the manifest parses', [manifest.errors?.length ?? 0, JSON.parse(manifest.data).file_handlers?.[0]?.accept?.['application/x-timeline']], [0, ['.timeline']]);
  const installable = await chrome.send('Page.getInstallabilityErrors', {}, tab).catch(() => ({ installabilityErrors: [] }));
  check('Chrome finds it installable', installable.installabilityErrors.map((e) => e.errorId), []);

  // The shelf.
  check('the shelf lists the library', await chrome.until(tab, "document.querySelectorAll('#shelf-list .cover').length === 2 && !document.getElementById('shelf').hidden"), true);
  check('a chronology is shown once, in the interface’s language, with the others named', await ev(tab, "[...document.querySelectorAll('#shelf-list .cover')].map(c => [c.dataset.file, [...c.querySelectorAll('.cover-languages button')].map(b => b.dataset.file + ' ' + b.textContent)])"), [['flight.en.timeline', ['flight.ru.timeline Русский']], ['big.en.timeline', []]]);
  check('each cover links its file for download', await ev(tab, "[...document.querySelectorAll('#shelf-list .cover-download')].map(a => [a.getAttribute('href').endsWith('/library/' + a.closest('.cover').dataset.file), a.download])"), [[true, 'flight.en.timeline'], [true, 'big.en.timeline']]);
  check('covers load from the site', await chrome.until(tab, "[...document.querySelectorAll('#shelf-list img')].every(i => i.complete && i.naturalWidth > 0)"), true);
  if (shotsDir) {
    await mkdir(shotsDir, { recursive: true });
    await writeFile(join(shotsDir, 'pwa-shelf.png'), await chrome.screenshot(tab));
  }
  // Keep the sample offline.
  await ev(tab, "document.querySelector('[data-file=\"flight.en.timeline\"] input[type=checkbox]').click()");
  check('keep offline stores the file', await chrome.until(tab, "caches.open('timeline-library').then(c => c.keys()).then(k => k.some(r => r.url.endsWith('flight.en.timeline')))"), true);
  await ev(tab, "document.querySelector('[data-file=\"flight.en.timeline\"] .cover-open').click()");
  check('a tap opens the chronology', await chrome.until(tab, "document.getElementById('doc-title').textContent === 'A short history of flight' && document.querySelectorAll('.era').length > 3", 15000), true);
  check('a shelf file is the server’s: Save means Save as', await ev(tab, 'timeline.session.remote'), true);
  await ev(tab, "document.getElementById('home').click()");
  await chrome.until(tab, "!document.getElementById('start').hidden");

  // The server goes away: the page, the shelf and the kept file still work.
  offline = true;
  for (const socket of sockets) socket.destroy();
  await chrome.send('Page.reload', {}, tab);
  check('offline: the page loads', await chrome.until(tab, "document.documentElement.dataset.ready === 'true'", 15000), true);
  check('offline: the shelf is there', await chrome.until(tab, "document.querySelectorAll('#shelf-list .cover').length === 2"), true);
  await ev(tab, "document.querySelector('[data-file=\"flight.en.timeline\"] .cover-open').click()");
  check('offline: the kept chronology opens', await chrome.until(tab, "document.getElementById('doc-title').textContent === 'A short history of flight'", 15000), true);
  await ev(tab, "document.getElementById('home').click()");
  offline = false;

  // A file from the system, through launchQueue.
  await ev(tab, `(async () => {
    const response = await fetch('library/big.en.timeline');
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle('launched.timeline', { create: true });
    const w = await handle.createWritable(); await w.write(await response.blob()); await w.close();
    await window.__launch({ files: [handle] });
  })()`);
  check('a launched file opens', await chrome.until(tab, "document.getElementById('doc-title').textContent === 'A thousand events'"), true);
  await ev(tab, "document.getElementById('home').click()");

  // A new deploy waits for the Update button.
  deploy = 1;
  await ev(tab, "localStorage.setItem('timeline.version', '0.0.1-old')");
  await ev(tab, "document.getElementById('start-settings').click()");
  await chrome.until(tab, "!!document.getElementById('update-button')");
  await ev(tab, "document.getElementById('update-button').click()");
  check('the new version is found and waits', await chrome.until(tab, "document.querySelector('.update-status')?.textContent.includes('9.9.1')", 15000), true);
  check('the old worker still serves', await ev(tab, "navigator.serviceWorker.getRegistration().then(r => !!r.waiting)"), true);
  check('the start screen says so too', await ev(tab, "!document.getElementById('update-note').hidden"), true);
  await ev(tab, "document.getElementById('update-button').click()");
  check('Update reloads into the new worker', await chrome.until(tab, "document.documentElement.dataset.ready === 'true' && [...document.querySelectorAll('.toast')].some(t => t.textContent.startsWith('Updated to'))", 15000), true);
  await sleep(300);
  const keys = await ev(tab, 'caches.keys()');
  check('the old cache is gone, the library kept', [keys.filter((k) => k.startsWith('timeline-') && k !== 'timeline-library').every((k) => k.endsWith('-deploy1')), keys.includes('timeline-library')], [true, true]);

  check('no errors in the page', chrome.errors.filter((e) => !/net::ERR|Failed to fetch|Failed to load resource/.test(e)), []);
} finally {
  await chrome.close();
  server.close();
  await rm(library, { recursive: true, force: true });
}
done('pwa');
