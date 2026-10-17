/**
 * The paper a file asks for (`style.paper`), turned into the page's paper
 * tones in either theme.
 *
 * The author picks one colour; the page needs five (the paper, raised and
 * sunk paper, a rule and a strong rule), and needs them in the dark theme too.
 * Each tone keeps its distance from the paper that the stock parchment has —
 * in lightness and in chroma — measured in OKLCH, where those distances look
 * the same in every hue. So a pale blue paper gets pale blue cards and blue-grey
 * rules, and in the dark theme a deep blue-black paper at the stock dark
 * paper's lightness. The ink never changes, so the lightness of the paper is
 * held to a range the ink reads on: a dark colour picked for the light theme
 * still makes light paper, in its hue.
 */

type Lch = [l: number, c: number, h: number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): Lch {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}

/** Linear sRGB of an OKLCH colour; channels outside 0…1 mean it is out of gamut. */
function linearRgb([L, C, H]: Lch): [number, number, number] {
  const A = C * Math.cos((H * Math.PI) / 180);
  const B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** An OKLCH colour as "#rrggbb"; one outside sRGB loses chroma, never lightness or hue, until it fits. */
export function oklchToHex([L, C, H]: Lch): string {
  const fits = (c: number) => linearRgb([L, c, H]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let c = C;
  if (!fits(c)) {
    let lo = 0;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + c) / 2;
      if (fits(mid)) lo = mid;
      else c = mid;
    }
    c = lo;
  }
  return `#${linearRgb([L, c, H])
    .map((v) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

export type PaperTone = 'paper' | 'paper-raised' | 'paper-sunk' | 'rule' | 'rule-strong';

/** The stock tones, as styles.css has them: parchment, and deep brown-black paper. */
const STOCK: Record<'light' | 'dark', Record<PaperTone, string>> = {
  light: { paper: '#f6efe1', 'paper-raised': '#fffaf0', 'paper-sunk': '#efe5d2', rule: '#d9cdb8', 'rule-strong': '#b9aa90' },
  dark: { paper: '#1d1814', 'paper-raised': '#28211b', 'paper-sunk': '#16120f', rule: '#463b31', 'rule-strong': '#6a5c4d' },
};

/** The parchment: a file whose paper is this looks like a file without one. */
export const STOCK_PAPER = STOCK.light.paper;

/** How light the paper may be in the light theme: never so dark that the ink stops reading. */
const LIGHT_RANGE: [number, number] = [0.92, 1];
/** How much colour paper takes: a tint, not a fill; the rules, drawn thin, a little more. */
const MAX_CHROMA = 0.07;
const MAX_RULE_CHROMA = 0.09;

/** The five paper tones for a paper colour, in the light or the dark theme. */
export function paperTones(color: string, dark: boolean): Record<PaperTone, string> {
  const stock = STOCK[dark ? 'dark' : 'light'];
  const [l0, c0] = hexToOklch(stock.paper);
  const [l, c, h] = hexToOklch(color);
  const lightL = Math.min(LIGHT_RANGE[1], Math.max(LIGHT_RANGE[0], l));
  // The dark paper moves a little with the light one, so white and cream stay apart in the dark.
  const paperL = dark ? l0 + (lightL - hexToOklch(STOCK.light.paper)[0]) * 0.25 : lightL;
  const paperC = Math.min(c, MAX_CHROMA) * (dark ? c0 / hexToOklch(STOCK.light.paper)[1] : 1);
  const out = {} as Record<PaperTone, string>;
  for (const [tone, hex] of Object.entries(stock) as [PaperTone, string][]) {
    const [tl, tc] = hexToOklch(hex);
    out[tone] = oklchToHex([Math.min(1, Math.max(0, paperL + tl - l0)), Math.min(MAX_RULE_CHROMA, c0 > 0 ? (paperC * tc) / c0 : paperC), h]);
  }
  return out;
}
