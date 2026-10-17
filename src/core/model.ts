/**
 * The chronology: what `timeline.json` inside a .timeline holds (Task §3).
 *
 * A file is written in one language, `lang`: every text in it is a plain
 * string. The same chronology in another language is another file.
 *
 * `parseDoc` validates field by field. A bad field is dropped, a bad item is
 * skipped, each with a warning the user sees once — never a blank screen.
 * Only a file that is not a timeline at all is refused.
 *
 * Forward compatibility: every object keeps the fields this version does not
 * know in `extra`, and `serializeDoc` writes them back after the known ones,
 * so a file from a newer app survives a load → edit → save here untouched.
 *
 * `serializeDoc` is deterministic: keys in a fixed order, items in date order,
 * images by hash, short objects on one line — a diff of two saves reads like
 * the edit that was made.
 */

import { endDay, endOf, isNow, isValidWhen, midOf, startOf, todayDay, YEAR_DAYS, type End, type When } from './dates';
import { t } from './i18n';
import { isUnit, type ScaleSpec } from './scale';

export const FORMAT = 'timeline';
export const VERSION = 1;

type Extra = Record<string, unknown>;

export type ItemKind = 'event' | 'period' | 'era';
export type DocKind = 'history' | 'life';
/** How much an event matters, as its card's size says: 1 large or huge, 2 normal, 3 small. */
export type Rank = 1 | 2 | 3;
/** How large an event's card is drawn on the strip; "normal" is left out of the file. */
export type CardSize = 'small' | 'normal' | 'large' | 'huge';
/** An event's card: a rectangle (left out of the file) or round — a medallion with its picture, a disc without. */
export type CardShape = 'card' | 'round';

export interface Credit {
  author?: string;
  source?: string;
  license?: string;
  url?: string;
  extra?: Extra;
}

export type ImageExt = 'webp' | 'png' | 'jpg' | 'svg';

/** What background music may be: kept as the author gave it, never re-encoded. */
export type AudioExt = 'mp3' | 'm4a' | 'aac' | 'ogg' | 'opus' | 'wav' | 'webm' | 'flac';
export const AUDIO_EXTS: readonly AudioExt[] = ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'webm', 'flac'];

/**
 * The chronology's background music: `audio/<file>.<ext>` beside the images,
 * named by the hash of its bytes, played in a loop while the file is open
 * (the reader may turn it off). The JSON holds only its name and what it is.
 */
export interface Music {
  file: string;
  ext: AudioExt;
  /** What the music is: "Bach, Air on the G string". */
  title?: string;
  credit?: Credit;
  extra?: Extra;
}

export interface ImageInfo {
  ext: ImageExt;
  /** The large image's size, so cards are laid out before a pixel is decoded. */
  w: number;
  h: number;
  caption?: string;
  credit?: Credit;
  extra?: Extra;
}

export interface Anchor {
  /** A date, or … */
  at?: When;
  /** … an item whose start is the anchor ("birth"). */
  item?: string;
  label: string;
  /** What the anchor's own year is called: 1 for Anno Mundi, 0 for an age. */
  base?: number;
  extra?: Extra;
}

/** The display face of titles: the book serif, or the interface's sans. */
export type TitleFont = 'serif' | 'sans';

/** What the paper is printed with: grain, nothing, a school notebook's squares or lines, dots, graph paper. */
export type Texture = 'grain' | 'plain' | 'grid' | 'lines' | 'dots' | 'graph';
export const TEXTURES: readonly Texture[] = ['grain', 'plain', 'grid', 'lines', 'dots', 'graph'];

/**
 * How the whole chronology looks, whoever opens it: the paper's colour (kept
 * in its hue and darkened in the dark theme), its texture, the colour of items
 * without one of their own, the face of titles. Each left out is the app's own.
 */
export interface Style {
  /** "#rrggbb": the paper. */
  paper?: string;
  /** Grain when left out. */
  texture?: Texture;
  /** "#rrggbb": items without a colour of their own; the warm grey when left out. */
  color?: string;
  font?: TitleFont;
  extra?: Extra;
}

export interface ViewSpec {
  center?: When;
  scale?: ScaleSpec;
  extra?: Extra;
}

export interface Meta {
  id: string;
  kind: DocKind;
  created?: string;
  modified?: string;
  generator?: string;
  extra?: Extra;
}

export interface Item {
  id: string;
  kind: ItemKind;
  start: When;
  end?: End;
  title: string;
  text?: string;
  refs?: string;
  links?: string[];
  /** "#rrggbb": the colour of the card's mark, the dot, the bar or the era band. */
  color?: string;
  /** "#rrggbb": an event card's own fill; its text turns light or dark to read on it. */
  background?: string;
  tags?: string[];
  image?: string;
  /** More pictures after `image`, in the order the details panel shows them. */
  gallery?: string[];
  /**
   * An event's card size on the strip, and so how much it matters: a large or
   * huge card shows at every zoom, a normal one from a little closer, a small
   * one close up. Normal when left out.
   */
  size?: Exclude<CardSize, 'normal'>;
  /** An event's card shape; a rectangle when left out. */
  shape?: Exclude<CardShape, 'card'>;
  /** The row fixed by hand: a card's row above the axis, a bar's row in its band. */
  lane?: number;
  extra?: Extra;
}

export interface Doc {
  format: typeof FORMAT;
  version: number;
  /** The language every text in the file is written in: "en", "ru", "pt-BR". */
  lang: string;
  meta: Meta;
  title: string;
  description?: string;
  sources?: string;
  /** Where the chronology begins, when not at its first item. */
  start?: When;
  /** Where it ends — a date, or today; the strip stops there as it does at the start. */
  end?: End;
  cover?: string;
  anchor?: Anchor;
  style?: Style;
  music?: Music;
  images: Record<string, ImageInfo>;
  items: Item[];
  view?: ViewSpec;
  extra?: Extra;
}

export interface Warning {
  /** Where in the file: `items[3].start`, `images.3f9a…`. */
  path: string;
  code: 'newer-version' | 'item-skipped' | 'field-dropped' | 'duplicate-id' | 'image-missing' | 'music-missing' | 'fixed';
  text: string;
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

/** A text: a string with something in it. */
export const asText = (v: unknown): string | null => (isString(v) && v ? v : null);

export const LANG_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const HASH_PATTERN = /^[0-9a-f]{8,64}$/;
const COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** "#ABC" → "#aabbcc": one spelling per colour, the one a colour input gives back. */
const normalColor = (color: string): string => (color.length === 4 ? `#${[...color.slice(1)].map((c) => c + c).join('')}` : color).toLowerCase();
const IMAGE_EXTS: readonly ImageExt[] = ['webp', 'png', 'jpg', 'svg'];

/** A link the user may open: http(s) or mailto, nothing that runs. */
export const isSafeUrl = (v: unknown): v is string => isString(v) && /^(https?:\/\/|mailto:)[^\s]+$/i.test(v);

function extraOf(source: Record<string, unknown>, known: readonly string[]): Extra | undefined {
  let extra: Extra | undefined;
  for (const [key, value] of Object.entries(source)) {
    if (!known.includes(key)) (extra ??= {})[key] = value;
  }
  return extra;
}

const KEYS = {
  doc: ['format', 'version', 'lang', 'meta', 'title', 'description', 'sources', 'start', 'end', 'cover', 'anchor', 'style', 'music', 'images', 'items', 'view'],
  meta: ['id', 'kind', 'created', 'modified', 'generator'],
  image: ['ext', 'w', 'h', 'caption', 'credit'],
  credit: ['author', 'source', 'license', 'url'],
  anchor: ['at', 'item', 'label', 'base'],
  style: ['paper', 'texture', 'color', 'font'],
  music: ['file', 'ext', 'title', 'credit'],
  view: ['center', 'scale'],
  item: ['id', 'kind', 'start', 'end', 'title', 'text', 'refs', 'links', 'color', 'background', 'tags', 'image', 'gallery', 'size', 'shape', 'lane'],
  when: ['y', 'm', 'd', 'approx', 'spread'],
} as const;

/**
 * What files of the first months had and this version reads only to carry
 * over: categories (an item took its colour from one), tracks (labelled bands
 * of bars), an event's importance (now its size: a key event is a large card,
 * a minor one a small card). They are not kept in `extra` — what replaced
 * them says the same.
 */
const RETIRED = { doc: ['categories', 'tracks'], item: ['category', 'track', 'importance'] } as const;

function readWhen(v: unknown): When | null {
  if (!isValidWhen(v)) return null;
  const out: When = { y: v.y };
  if (v.m !== undefined) out.m = v.m;
  if (v.d !== undefined) out.d = v.d;
  if (v.approx) out.approx = true;
  if (v.spread) out.spread = v.spread;
  return out;
}

export function parseDoc(json: unknown): { doc: Doc; warnings: Warning[] } {
  if (!isObject(json)) throw new ModelError(t('model', 'This is not a timeline: timeline.json holds no object'));
  if (json.format !== FORMAT) throw new ModelError(t('model', 'This is not a timeline: the format is not "timeline"'));
  const warnings: Warning[] = [];
  const warn = (path: string, code: Warning['code'], text: string) => warnings.push({ path, code, text });
  const dropped = (path: string) => warn(path, 'field-dropped', t('model', '{path}: not understood, left out', { path }));

  let version = VERSION;
  if (Number.isInteger(json.version) && (json.version as number) >= 1) version = json.version as number;
  else dropped('version');
  if (version > VERSION) {
    warn('version', 'newer-version', t('model', 'Made by a newer version of Timeline (format {version}): what this version does not know is kept but not shown', { version }));
  }

  // meta
  const metaIn = isObject(json.meta) ? json.meta : {};
  if (!isObject(json.meta)) dropped('meta');
  const meta: Meta = { id: 'untitled', kind: 'history' };
  if (isString(metaIn.id) && ID_PATTERN.test(metaIn.id)) meta.id = metaIn.id;
  else if (isObject(json.meta)) dropped('meta.id');
  if (metaIn.kind === 'history' || metaIn.kind === 'life') meta.kind = metaIn.kind;
  else if (metaIn.kind !== undefined) dropped('meta.kind');
  for (const key of ['created', 'modified', 'generator'] as const) {
    if (isString(metaIn[key])) meta[key] = metaIn[key];
    else if (metaIn[key] !== undefined) dropped(`meta.${key}`);
  }
  const metaExtra = extraOf(metaIn, KEYS.meta);
  if (metaExtra) meta.extra = metaExtra;

  // A file that does not say its language is taken for English.
  let lang = 'en';
  if (isString(json.lang) && LANG_PATTERN.test(json.lang)) lang = json.lang;
  else if (json.lang !== undefined) dropped('lang');

  const doc: Doc = {
    format: FORMAT,
    version,
    lang,
    meta,
    title: asText(json.title) ?? 'Untitled',
    images: {},
    items: [],
  };
  if (!asText(json.title)) dropped('title');
  for (const key of ['description', 'sources'] as const) {
    if (json[key] === undefined) continue;
    const text = asText(json[key]);
    if (text) doc[key] = text;
    else dropped(key);
  }

  // Where the chronology begins and ends, when the author says so.
  if (json.start !== undefined) {
    const start = readWhen(json.start);
    if (start) doc.start = start;
    else dropped('start');
  }
  if (json.end !== undefined) {
    const end: End | null = isObject(json.end) && json.end.now === true ? { now: true } : readWhen(json.end);
    if (end && (!doc.start || isNow(end) || endDay(end) > startOf(doc.start))) doc.end = end;
    else dropped('end');
  }

  // An old file's categories: their colours go to the items that used them.
  const categoryColors = new Map<string, string>();
  if (Array.isArray(json.categories)) {
    for (const c of json.categories as unknown[]) {
      if (isObject(c) && isString(c.id) && isString(c.color) && COLOR_PATTERN.test(c.color)) categoryColors.set(c.id, normalColor(c.color));
    }
  }
  // Every file of the time wrote both lists, mostly empty: only one that had some says so.
  if (RETIRED.doc.some((key) => Array.isArray(json[key]) ? (json[key] as unknown[]).length > 0 : json[key] !== undefined)) {
    warn('categories', 'fixed', t('model', 'Categories and tracks are no longer used: each item keeps its category’s colour as its own'));
  }

  // images
  if (json.images !== undefined && !isObject(json.images)) dropped('images');
  // In hash order: the order they are written in, and the one undo restores.
  for (const [hash, value] of Object.entries(isObject(json.images) ? json.images : {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const path = `images.${hash}`;
    if (!HASH_PATTERN.test(hash) || !isObject(value) || !IMAGE_EXTS.includes(value.ext as ImageExt)) {
      dropped(path);
      continue;
    }
    const size = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= 100_000 ? (v as number) : 0);
    const info: ImageInfo = { ext: value.ext as ImageExt, w: size(value.w), h: size(value.h) };
    if (!info.w || !info.h) {
      // Unknown size: laid out as a square until decoded.
      if (value.w !== undefined || value.h !== undefined) dropped(`${path}.w`);
      info.w = info.h = 1;
    }
    if (value.caption !== undefined) {
      const caption = asText(value.caption);
      if (caption) info.caption = caption;
      else dropped(`${path}.caption`);
    }
    if (value.credit !== undefined) {
      if (isObject(value.credit)) {
        const credit: Credit = {};
        for (const key of ['author', 'source', 'license'] as const) if (isString(value.credit[key])) credit[key] = value.credit[key];
        if (value.credit.url !== undefined) {
          if (isSafeUrl(value.credit.url)) credit.url = value.credit.url;
          else dropped(`${path}.credit.url`);
        }
        const extra = extraOf(value.credit, KEYS.credit);
        if (extra) credit.extra = extra;
        info.credit = credit;
      } else dropped(`${path}.credit`);
    }
    const extra = extraOf(value, KEYS.image);
    if (extra) info.extra = extra;
    doc.images[hash] = info;
  }

  // items
  const itemIds = new Set<string>();
  if (json.items !== undefined && !Array.isArray(json.items)) dropped('items');
  (Array.isArray(json.items) ? json.items : []).forEach((value: unknown, i: number) => {
    const path = `items[${i}]`;
    const skip = (why: string) => warn(path, 'item-skipped', t('model', '{path} skipped: {why}', { path, why }));
    if (!isObject(value)) return skip(t('model', 'not an object'));
    const id = value.id;
    if (!isString(id) || !ID_PATTERN.test(id)) return skip(t('model', 'no valid id'));
    if (itemIds.has(id)) return warn(path, 'duplicate-id', t('model', '{path}: a second "{id}", left out', { path, id }));
    const kind = value.kind;
    if (kind !== 'event' && kind !== 'period' && kind !== 'era') return skip(t('model', 'unknown kind'));
    const start = readWhen(value.start);
    if (!start) return skip(t('model', 'no valid start date'));
    const item: Item = { id, kind, start, title: asText(value.title) ?? id };
    if (!asText(value.title)) dropped(`${path}.title`);

    if (kind === 'event') {
      if (value.end !== undefined) dropped(`${path}.end`);
    } else {
      let end: End | null = isObject(value.end) && value.end.now === true ? { now: true } : readWhen(value.end);
      if (!end) return skip(kind === 'era' ? t('model', 'an era needs an end date') : t('model', 'a period needs an end date'));
      if (!isNow(end) && endDay(end) <= startOf(start)) {
        // Written the wrong way round: the dates are kept, swapped.
        const swapped = end;
        end = item.start;
        item.start = swapped;
        warn(`${path}.end`, 'fixed', t('model', '{path}: the end came before the start; swapped', { path: `${path}.end` }));
      }
      item.end = end;
    }

    for (const key of ['text', 'refs'] as const) {
      if (value[key] === undefined) continue;
      const text = asText(value[key]);
      if (text) item[key] = text;
      else dropped(`${path}.${key}`);
    }
    if (value.links !== undefined) {
      if (Array.isArray(value.links)) {
        const links = value.links.filter(isSafeUrl);
        if (links.length !== value.links.length) dropped(`${path}.links`);
        if (links.length) item.links = links;
      } else dropped(`${path}.links`);
    }
    if (value.color !== undefined) {
      if (isString(value.color) && COLOR_PATTERN.test(value.color)) item.color = normalColor(value.color);
      else dropped(`${path}.color`);
    } else if (isString(value.category) && categoryColors.has(value.category)) item.color = categoryColors.get(value.category);
    if (value.background !== undefined) {
      if (kind === 'event' && isString(value.background) && COLOR_PATTERN.test(value.background)) item.background = normalColor(value.background);
      else dropped(`${path}.background`);
    }
    if (value.tags !== undefined) {
      if (Array.isArray(value.tags) && value.tags.every(isString)) {
        if (value.tags.length) item.tags = value.tags as string[];
      } else dropped(`${path}.tags`);
    }
    if (value.image !== undefined) {
      if (isString(value.image) && doc.images[value.image]) item.image = value.image;
      else warn(`${path}.image`, 'image-missing', t('model', '{path}: the image is not in the file', { path: `${path}.image` }));
    }
    if (value.gallery !== undefined) {
      if (Array.isArray(value.gallery)) {
        const gallery: string[] = [];
        value.gallery.forEach((hash: unknown, j: number) => {
          if (isString(hash) && doc.images[hash]) {
            if (hash !== item.image && !gallery.includes(hash)) gallery.push(hash);
          } else warn(`${path}.gallery[${j}]`, 'image-missing', t('model', '{path}: the image is not in the file', { path: `${path}.gallery[${j}]` }));
        });
        // A gallery whose first picture went missing still has a picture on its card.
        if (!item.image && gallery.length) item.image = gallery.shift();
        if (gallery.length) item.gallery = gallery;
      } else dropped(`${path}.gallery`);
    }
    if (value.size !== undefined) {
      if (kind === 'event' && (value.size === 'small' || value.size === 'large' || value.size === 'huge')) item.size = value.size;
      else if (value.size !== 'normal') dropped(`${path}.size`);
    } else if (kind === 'event' && (value.importance === 1 || value.importance === 3)) {
      // An older file's importance says the size: the more it matters, the larger the card.
      item.size = value.importance === 1 ? 'large' : 'small';
    }
    if (value.shape !== undefined) {
      if (kind === 'event' && value.shape === 'round') item.shape = 'round';
      else if (value.shape !== 'card') dropped(`${path}.shape`);
    }
    if (value.lane !== undefined) {
      if (Number.isInteger(value.lane) && (value.lane as number) >= 0 && (value.lane as number) < 100) item.lane = value.lane as number;
      else dropped(`${path}.lane`);
    }
    const extra = extraOf(value, [...KEYS.item, ...RETIRED.item]);
    if (extra) item.extra = extra;
    itemIds.add(id);
    doc.items.push(item);
  });

  if (json.cover !== undefined) {
    if (isString(json.cover) && doc.images[json.cover]) doc.cover = json.cover;
    else warn('cover', 'image-missing', t('model', '{path}: the image is not in the file', { path: 'cover' }));
  }

  if (json.anchor !== undefined) {
    const a = json.anchor;
    const at = isObject(a) ? readWhen(a.at) : null;
    const item = isObject(a) && isString(a.item) && itemIds.has(a.item) ? a.item : undefined;
    if (isObject(a) && (at || item)) {
      const anchor: Anchor = { label: asText(a.label) ?? '' };
      if (at) anchor.at = at;
      else anchor.item = item;
      if (Number.isInteger(a.base)) anchor.base = a.base as number;
      const extra = extraOf(a, KEYS.anchor);
      if (extra) anchor.extra = extra;
      doc.anchor = anchor;
    } else dropped('anchor');
  }

  if (json.style !== undefined) {
    if (isObject(json.style)) {
      const s = json.style;
      const style: Style = {};
      for (const key of ['paper', 'color'] as const) {
        if (s[key] === undefined) continue;
        if (isString(s[key]) && COLOR_PATTERN.test(s[key])) style[key] = normalColor(s[key]);
        else dropped(`style.${key}`);
      }
      if (s.texture !== undefined) {
        if (TEXTURES.includes(s.texture as Texture)) style.texture = s.texture as Texture;
        else dropped('style.texture');
      }
      if (s.font !== undefined) {
        if (s.font === 'serif' || s.font === 'sans') style.font = s.font;
        else dropped('style.font');
      }
      const extra = extraOf(s, KEYS.style);
      if (extra) style.extra = extra;
      if (Object.keys(style).length) doc.style = style;
    } else dropped('style');
  }

  if (json.music !== undefined) {
    const m = json.music;
    if (isObject(m) && isString(m.file) && HASH_PATTERN.test(m.file) && AUDIO_EXTS.includes(m.ext as AudioExt)) {
      const music: Music = { file: m.file, ext: m.ext as AudioExt };
      if (m.title !== undefined) {
        const title = asText(m.title);
        if (title) music.title = title;
        else dropped('music.title');
      }
      if (isObject(m.credit)) {
        const credit: Credit = {};
        for (const key of ['author', 'source', 'license'] as const) if (isString(m.credit[key])) credit[key] = m.credit[key];
        if (isSafeUrl(m.credit.url)) credit.url = m.credit.url;
        const extra = extraOf(m.credit, KEYS.credit);
        if (extra) credit.extra = extra;
        music.credit = credit;
      } else if (m.credit !== undefined) dropped('music.credit');
      const extra = extraOf(m, KEYS.music);
      if (extra) music.extra = extra;
      doc.music = music;
    } else dropped('music');
  }

  if (json.view !== undefined) {
    if (isObject(json.view)) {
      const v = json.view;
      const view: ViewSpec = {};
      if (v.center !== undefined) {
        const center = readWhen(v.center);
        if (center) view.center = center;
        else dropped('view.center');
      }
      if (v.scale !== undefined) {
        const s = v.scale;
        if (isObject(s) && typeof s.px === 'number' && s.px > 0 && isUnit(s.unit) && (s.count === undefined || (typeof s.count === 'number' && s.count > 0))) {
          view.scale = { px: s.px, unit: s.unit, count: (s.count as number | undefined) ?? 1 };
        } else dropped('view.scale');
      }
      const extra = extraOf(v, KEYS.view);
      if (extra) view.extra = extra;
      doc.view = view;
    } else dropped('view');
  }

  const extra = extraOf(json, [...KEYS.doc, ...RETIRED.doc]);
  if (extra) doc.extra = extra;
  return { doc, warnings };
}

/** Warnings for images the JSON lists but the zip lacks. The entries stay; their cards show a placeholder. */
export function missingImages(doc: Doc, has: (hash: string, info: ImageInfo) => boolean): Warning[] {
  return Object.entries(doc.images)
    .filter(([hash, info]) => !has(hash, info))
    .map(([hash]) => ({ path: `images.${hash}`, code: 'image-missing' as const, text: t('model', '{path}: the image is not in the file', { path: `images.${hash}` }) }));
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** Known keys in their fixed order, then whatever the file carried that this version does not know. */
function ordered(fields: [string, unknown][], extra?: Extra): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of fields) if (value !== undefined) out[key] = value;
  if (extra) for (const [key, value] of Object.entries(extra)) if (!(key in out)) out[key] = value;
  return out;
}

const whenOut = (w: When | undefined) => w && ordered(KEYS.when.map((k) => [k, w[k]]));
const endOut = (e: End | undefined) => (e === undefined ? undefined : isNow(e) ? { now: true } : whenOut(e));

/** Where an item sits in time, for sorting: its start, events at their middle. */
export const itemDay = (item: Item): number => (item.kind === 'event' ? midOf(item.start) : startOf(item.start));
const KIND_ORDER: Record<ItemKind, number> = { era: 0, period: 1, event: 2 };
export const compareItems = (a: Item, b: Item): number => itemDay(a) - itemDay(b) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function docToJson(doc: Doc): Record<string, unknown> {
  const items = [...doc.items].sort(compareItems).map((item) =>
    ordered(
      [
        ['id', item.id],
        ['kind', item.kind],
        ['start', whenOut(item.start)],
        ['end', endOut(item.end)],
        ['title', item.title],
        ['text', item.text],
        ['refs', item.refs],
        ['links', item.links],
        ['color', item.color],
        ['background', item.background],
        ['tags', item.tags],
        ['image', item.image],
        ['gallery', item.gallery?.length ? item.gallery : undefined],
        ['size', item.size],
        ['shape', item.shape],
        ['lane', item.lane],
      ],
      item.extra,
    ),
  );
  const images = Object.fromEntries(
    Object.keys(doc.images)
      .sort()
      .map((hash) => {
        const i = doc.images[hash]!;
        const credit = i.credit && ordered(KEYS.credit.map((k) => [k, i.credit![k]]), i.credit.extra);
        return [hash, ordered([['ext', i.ext], ['w', i.w], ['h', i.h], ['caption', i.caption], ['credit', credit]], i.extra)];
      }),
  );
  const m = doc.meta;
  const a = doc.anchor;
  const s = doc.style;
  const v = doc.view;
  return ordered(
    [
      ['format', FORMAT],
      ['version', Math.max(doc.version, VERSION)],
      ['lang', doc.lang],
      ['meta', ordered(KEYS.meta.map((k) => [k, m[k]]), m.extra)],
      ['title', doc.title],
      ['description', doc.description],
      ['sources', doc.sources],
      ['start', whenOut(doc.start)],
      ['end', endOut(doc.end)],
      ['cover', doc.cover],
      ['anchor', a && ordered([['at', whenOut(a.at)], ['item', a.item], ['label', a.label], ['base', a.base]], a.extra)],
      ['style', s && ordered(KEYS.style.map((k) => [k, s[k]]), s.extra)],
      ['music', doc.music && ordered([['file', doc.music.file], ['ext', doc.music.ext], ['title', doc.music.title], ['credit', doc.music.credit && ordered(KEYS.credit.map((k) => [k, doc.music!.credit![k]]), doc.music.credit.extra)]], doc.music.extra)],
      ['images', images],
      ['items', items],
      ['view', v && ordered([['center', whenOut(v.center)], ['scale', v.scale && ordered([['px', v.scale.px], ['unit', v.scale.unit], ['count', v.scale.count]])]], v.extra)],
    ],
    doc.extra,
  );
}

/**
 * JSON as people read it: two-space indent, and any object or array that fits
 * in `width` columns on one line — `"start": { "y": -2517, "approx": true }`.
 */
export function prettyJson(value: unknown, width = 100): string {
  const inline = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
    if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
    const entries = Object.entries(v as Record<string, unknown>);
    return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}';
  };
  const write = (v: unknown, indent: string, room: number): string => {
    const flat = inline(v);
    if (flat.length <= room || v === null || typeof v !== 'object') return flat;
    const inner = `${indent}  `;
    if (Array.isArray(v)) return `[\n${v.map((x) => inner + write(x, inner, width - inner.length - 1)).join(',\n')}\n${indent}]`;
    const lines = Object.entries(v as Record<string, unknown>).map(([k, x]) => {
      const key = `${JSON.stringify(k)}: `;
      return inner + key + write(x, inner, width - inner.length - key.length - 1);
    });
    return `{\n${lines.join(',\n')}\n${indent}}`;
  };
  return `${write(value, '', width)}\n`;
}

export const serializeDoc = (doc: Doc): string => prettyJson(docToJson(doc));

/* ------------------------------------------------------------------ *
 * Questions the view asks
 * ------------------------------------------------------------------ */

/**
 * The first and last day of the chronology: its own start and end when it
 * has them, widened to every item (nothing is ever cut off); the items alone
 * otherwise; today ± a year for an empty file. A spread is a halo around a
 * date, not more time: the strip starts at the first date itself
 * ("c. 4174 BC ± 250" starts at 4174 BC, not 4424 BC).
 */
export function extentOf(doc: Doc, now = new Date()): [number, number] {
  let lo = doc.start ? startOf(doc.start) : Infinity;
  let hi = doc.end ? endDay(doc.end, now) : -Infinity;
  for (const item of doc.items) {
    lo = Math.min(lo, startOf(item.start));
    hi = Math.max(hi, item.end ? endDay(item.end, now) : midOf(item.start));
  }
  const today = todayDay(now);
  if (!Number.isFinite(lo)) lo = Math.min(today, hi) - YEAR_DAYS;
  if (!Number.isFinite(hi)) hi = Math.max(today, lo) + YEAR_DAYS;
  if (hi - lo < 30) return [lo - 15, hi + 15];
  return [lo, hi];
}

/** How much an event matters, as its size says: a large or huge card 1, a normal one 2, a small one 3. */
export const rankOf = (item: Item): Rank => (item.size === 'large' || item.size === 'huge' ? 1 : item.size === 'small' ? 3 : 2);

/** What an item without a colour of its own is drawn in: a warm grey that sits with every other. */
export const DEFAULT_COLOR = '#8c8176';
/** An item's colour: its own, else the file's colour for items without one, else the warm grey. */
export const colorOf = (item: Item, doc?: Doc): string => item.color ?? doc?.style?.color ?? DEFAULT_COLOR;

/**
 * The days an item covers on the strip.
 *
 * An era tiles the axis: from the first day of its start to the last day of
 * its end, so "1783–1902" and "1903–1918" meet without a gap.
 *
 * A period runs from the middle of its start to the middle of its end — the
 * same rule that puts a year-only event in the middle of its year. Reigns
 * that share their boundary year ("931–913 BC", then "913–911 BC") meet
 * instead of overlapping by a year, and "1010–970 BC" lasts 40 years. A
 * period within a single span (born and died "c. 30") still covers that span.
 */
export function spanOf(item: Item, now = new Date()): [number, number] {
  if (item.kind === 'event') {
    const mid = midOf(item.start);
    return [mid, mid];
  }
  if (!item.end) return [startOf(item.start), endOf(item.start)];
  if (item.kind === 'era') return [startOf(item.start), endDay(item.end, now)];
  const start = midOf(item.start);
  const end = isNow(item.end) ? todayDay(now) + 1 : midOf(item.end);
  return end > start ? [start, end] : [startOf(item.start), endDay(item.end, now)];
}

/** A new, empty chronology. */
export function emptyDoc(kind: DocKind, id: string, title: string, lang: string, generator: string, now = new Date()): Doc {
  const day = now.toISOString().slice(0, 10);
  return {
    format: FORMAT,
    version: VERSION,
    lang,
    meta: { id, kind, created: day, modified: day, generator },
    title,
    images: {},
    items: [],
  };
}

/**
 * Image hashes the document refers to: items, the cover. Anything else in
 * `images` goes at the next save — except in a file with no items at all,
 * which is a library of pictures (stock-images.en.timeline) and keeps every one.
 */
export function usedImages(doc: Doc): Set<string> {
  if (!doc.items.length) return new Set(Object.keys(doc.images));
  const used = new Set<string>();
  for (const item of doc.items) for (const hash of picturesOf(item)) used.add(hash);
  if (doc.cover) used.add(doc.cover);
  return used;
}

/** An item's pictures in order: the one on its card first, then its gallery. */
export const picturesOf = (item: Item): string[] => (item.image ? [item.image, ...(item.gallery ?? [])] : []);
