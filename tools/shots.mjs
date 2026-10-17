/**
 * Screenshots of a chronology at the zooms that matter, for the eye:
 *
 *   node tools/shots.mjs FILE.timeline [DIR] [--dark] [--ru] [--phone]
 *
 * --ru switches the interface to Russian.
 *
 * Views: fit all, a century per 100 px around the kings, a decade around the
 * exile, a week around AD 30 — or pass --at "YEAR:PX_PER_DAY" any number of times.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sleep, startChrome } from './chrome.mjs';
import { root } from './load.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const named = args.find((a) => a.endsWith('.timeline'));
if (!named) throw new Error('usage: node tools/shots.mjs FILE.timeline [DIR] [--dark] [--ru] [--phone] [--at YEAR:PX_PER_DAY]');
const file = resolve(named);
const dir = args.find((a) => !a.startsWith('--') && !a.endsWith('.timeline') && !/^-?\d+:/.test(a)) ?? join(root, 'shots');
const ats = args.flatMap((a, i) => (a === '--at' ? [args[i + 1]] : []));
if (!existsSync(file)) throw new Error(`${file} does not exist`);

const YEAR = 365.2425;
const views = ats.length
  ? ats.map((spec) => {
      const [year, px] = spec.split(':').map(Number);
      return { name: `at-${year}-${px}`, year, px };
    })
  : [
      { name: 'fit', year: null, px: null },
      { name: 'century', year: -800, px: 100 / (100 * YEAR) },
      { name: 'decade', year: -590, px: 100 / (10 * YEAR) },
      { name: 'week-ad30', year: 30.25, px: 100 / 7 },
    ];

const chrome = await startChrome();
try {
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
  const tab = await chrome.attach(targetId, 'shots');
  await chrome.send('Page.enable', {}, tab);
  await chrome.viewport(tab, flag('phone') ? { width: 390, height: 844, mobile: true, scale: 2 } : { width: 1440, height: 900 });
  if (flag('dark')) await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, tab);
  if (flag('ru')) await chrome.send('Emulation.setLocaleOverride', { locale: 'ru-RU' }, tab).catch(() => undefined);
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('timeline.settings', JSON.stringify({ language: ${flag('ru') ? "'ru'" : "'en'"} })); } catch {}` }, tab);
  await chrome.send('Page.navigate', { url: pathToFileURL(join(root, 'build', 'timeline.html')).href }, tab);
  await chrome.until(tab, "document.documentElement.dataset.ready === 'true'");
  const { root: doc } = await chrome.send('DOM.getDocument', {}, tab);
  const { nodeId } = await chrome.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#file-input' }, tab);
  await chrome.send('DOM.setFileInputFiles', { nodeId, files: [file] }, tab);
  await chrome.until(tab, "!!window.timeline?.session && document.querySelectorAll('.era, .card, .bar').length > 0", 15000);
  await mkdir(dir, { recursive: true });
  const suffix = `${flag('phone') ? '-phone' : ''}${flag('dark') ? '-dark' : ''}${flag('ru') ? '-ru' : ''}`;
  for (const view of views) {
    if (view.year === null) await chrome.evaluate(tab, 'timeline.strip.fit(false)');
    else await chrome.evaluate(tab, `timeline.strip.setView({ center: ${(view.year - 1) * YEAR}, pxPerDay: ${view.px}, width: timeline.strip.view.width })`);
    await sleep(700);
    const shot = await chrome.screenshot(tab);
    await writeFile(join(dir, `${view.name}${suffix}.png`), shot);
    console.log(join(dir, `${view.name}${suffix}.png`));
  }
  if (chrome.errors.length) console.error(chrome.errors.join('\n'));
} finally {
  await chrome.close();
}
