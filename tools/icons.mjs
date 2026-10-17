/**
 * The PWA's PNG icons, rendered from assets/icon.svg by headless Chrome
 * (transparent background, the SVG drawn at each size) into assets/pwa/.
 * Run when the icon changes: `node tools/icons.mjs`. The build only copies them.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startChrome } from './chrome.mjs';
import { root } from './load.mjs';

const svg = await readFile(join(root, 'assets', 'icon.svg'), 'utf8');
const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
/** @type {[string, number, number, boolean][]} */
const sizes = [
  ['icon-192.png', 192, 0, false],
  ['icon-512.png', 512, 0, false],
  // Maskable: the icon inside the safe zone (80 %), on its own paper colour (icon.svg's #f3ead8) edge to edge.
  ['icon-maskable-512.png', 512, 0.1, true],
  ['apple-touch-icon.png', 180, 0, true],
];
const chrome = await startChrome();
try {
  const tab = await chrome.open('about:blank', 'icons');
  await chrome.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, tab);
  for (const [name, size, pad, fill] of sizes) {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false }, tab);
    await chrome.evaluate(tab, `new Promise((resolve) => {
      document.documentElement.style.margin = document.body.style.margin = '0';
      document.body.style.background = ${fill ? "'#f3ead8'" : "'transparent'"};
      document.body.innerHTML = '<img src="${uri}" style="display:block;width:${size * (1 - 2 * pad)}px;height:${size * (1 - 2 * pad)}px;margin:${size * pad}px">';
      document.querySelector('img').decode().then(resolve);
    })`);
    const { data } = await chrome.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } }, tab);
    await writeFile(join(root, 'assets', 'pwa', name), Buffer.from(data, 'base64'));
    console.log(`assets/pwa/${name}`);
  }
} finally {
  await chrome.close();
}
