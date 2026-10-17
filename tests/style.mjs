/** A file's paper: five tones in either theme from one colour, readable under the ink (style.ts). */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checker, load, root } from '../tools/load.mjs';

const { paperTones, hexToOklch, oklchToHex, STOCK, STOCK_PAPER } = await load('core/style');
const { check, done } = checker();

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const near = (a, b, by = 2) => channels(a).every((v, i) => Math.abs(v - channels(b)[i]) <= by);
const lightness = (hex) => hexToOklch(hex)[0];

check('OKLCH round-trips a colour', ['#f6efe1', '#1d1814', '#5c6f86', '#ffffff', '#000000'].map((hex) => oklchToHex(hexToOklch(hex))), ['#f6efe1', '#1d1814', '#5c6f86', '#ffffff', '#000000']);
check('a colour out of sRGB loses chroma, not lightness', Math.abs(lightness(oklchToHex([0.95, 0.3, 250])) - 0.95) < 0.01, true);

const stock = paperTones(STOCK_PAPER, false);
check('the parchment gives the stock light tones', Object.values(stock).every((hex, i) => near(hex, ['#f6efe1', '#fffaf0', '#efe5d2', '#d9cdb8', '#b9aa90'][i])), true);

const blue = paperTones('#e7eef6', false);
check('a pale paper is used as it is', blue.paper, '#e7eef6');
check('the tones keep their order of lightness', [lightness(blue['paper-raised']) > lightness(blue.paper), lightness(blue['paper-sunk']) < lightness(blue.paper), lightness(blue['rule-strong']) < lightness(blue.rule)], [true, true, true]);
check('the tones keep the hue', Math.abs(hexToOklch(blue.rule)[2] - hexToOklch('#e7eef6')[2]) < 5, true);

for (const color of ['#000000', '#2050a0', '#8a4a52']) {
  check(`${color} still makes paper the ink reads on`, lightness(paperTones(color, false).paper) >= 0.915, true);
}
const dark = paperTones('#e7eef6', true);
check('in the dark theme the paper is dark, in the same hue', [lightness(dark.paper) < 0.3, Math.abs(hexToOklch(dark.paper)[2] - hexToOklch('#e7eef6')[2]) < 10], [true, true]);
check('white is grey in the dark', near(paperTones('#ffffff', true).paper, '#1c1c1c', 3), true);

// The paper is written down three times: styles.css, STOCK, and the PWA's theme colours in build.mjs.
{
  const css = await readFile(join(root, 'src/app/styles.css'), 'utf8');
  const build = await readFile(join(root, 'build.mjs'), 'utf8');
  /** The custom properties of the first rule with this selector. */
  const block = (selector) => {
    const at = css.indexOf(`${selector} {`);
    const body = css.slice(at, css.indexOf('}', at));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
  };
  const lightVars = block(':root');
  const darkVars = block(":root[data-theme='dark']");
  const fallback = block(':root:not([data-theme])');
  const tones = (vars) => Object.fromEntries(Object.keys(STOCK.light).map((tone) => [tone, vars[tone]]));
  check('styles.css has the stock light tones', tones(lightVars), STOCK.light);
  check('…and the stock dark ones', tones(darkVars), STOCK.dark);
  check('the dark theme before the script runs is the dark theme', fallback, darkVars);
  check('the PWA’s theme colours are the stock papers', [`content="${STOCK.light.paper}" media="(prefers-color-scheme: light)"`, `content="${STOCK.dark.paper}" media="(prefers-color-scheme: dark)"`, `theme_color: '${STOCK.light.paper}'`, `background_color: '${STOCK.light.paper}'`].map((text) => build.includes(text)), [true, true, true, true]);
}

done('style');
