/**
 * The editor dialog (Task §6, §7): an item's own window — an event's, a
 * period's or an era's; one kind never turns into another. Titles and text,
 * dates, size and shape, colours, the pictures of its gallery with their
 * captions and credits, references, links and tags. Saving is one command on
 * the undo stack; so is a delete.
 */

import { itemChange, imageChange, fieldChange, type Change } from '../core/commands';
import { formatRange, isNow, snapTo, startOf, type End, type When } from '../core/dates';
import { shortId } from '../core/hash';
import { t } from '../core/i18n';
import { DEFAULT_COLOR, picturesOf, type CardShape, type CardSize, type Credit, type ImageInfo, type Item, type ItemKind } from '../core/model';
import { h, icon, shape, trackPointer } from './dom';
import { colorField, dateField, field, group, hint, textFields } from './forms';
import { encodeImage, type NewImage } from './images';
import { pickFromLibrary } from './library';
import { select } from './reading';
import { app } from './state';
import { dialog, toast } from './ui';
import { galleryIcon } from './view';

function run(label: string, changes: Change[]): void {
  app.session?.history.run({ label, changes });
}

/** The precision a new date gets at this zoom: days when a day is visible, years when it is not. */
export function whenAt(day: number): When {
  const px = app.strip.view.pxPerDay;
  const like: When = px >= 1 ? { y: 0, m: 1, d: 1 } : px >= 1 / 40 ? { y: 0, m: 1 } : { y: 0 };
  return snapTo(day, like);
}

function newId(kind: ItemKind): string {
  const doc = app.session!.doc;
  const ids = new Set(doc.items.map((i) => i.id));
  return shortId(kind === 'event' ? 'e' : kind === 'period' ? 'p' : 'r', ids);
}

/* ------------------------------------------------------------------ *
 * The editor dialog
 * ------------------------------------------------------------------ */

/** A picture in the editor's gallery: its entry in the file, and its bytes when it is new to the file. */
interface Picture {
  hash: string;
  info: ImageInfo;
  encoded?: NewImage;
}

/** The size picker's options, each drawn as a little card of its size. */
export const SIZE_OPTIONS: [CardSize, number][] = [
  ['small', 9],
  ['normal', 12],
  ['large', 16],
  ['huge', 21],
];

export const sizeLabel = (size: CardSize): string =>
  size === 'small' ? t('editor', 'Small') : size === 'large' ? t('editor', 'Large') : size === 'huge' ? t('editor', 'Huge') : t('editor', 'Normal');

const sizeIcon = (px: number): SVGSVGElement => icon(shape('rect', { x: (24 - px) / 2, y: 24 - 2 - px * 0.8, width: px, height: px * 0.8, rx: 1.5 }));

/** The window's title: each kind has its own window, and one kind never turns into another. */
const TITLES: Record<ItemKind, [made: () => string, edited: () => string]> = {
  event: [() => t('editor', 'New event'), () => t('editor', 'Edit the event')],
  period: [() => t('editor', 'New period'), () => t('editor', 'Edit the period')],
  era: [() => t('editor', 'New era'), () => t('editor', 'Edit the era')],
};

/** Fills for an event's card offered first: pale tints that the ink reads on, and two deep ones the light ink reads on. */
const BACKGROUNDS = ['#f6e7c8', '#f4dccf', '#e3ebd6', '#dbe5ef', '#efdce0', '#e3def0', '#ece6da', '#3b342e', '#2f3d4c'];

/** What each size does on the strip — the larger the card, the more the event matters; the editor says so. */
const SIZE_MEANS: Record<CardSize, () => string> = {
  small: () => t('editor', 'Small: a footnote — a card only close up, and hidden altogether when “Show small events” is off in Settings.'),
  normal: () => t('editor', 'Normal: a card once you zoom in a little; further out, a dot on the axis.'),
  large: () => t('editor', 'Large: a turning point — a card even when the whole timeline is on the screen, with the large picture.'),
  huge: () => t('editor', 'Huge: a turning point, the largest card, its gallery beside its picture.'),
};

/** The shape picker's options, each drawn as itself. */
const shapeIcon = (card: CardShape): SVGSVGElement =>
  icon(card === 'round' ? shape('circle', { cx: 12, cy: 12, r: 8 }) : shape('rect', { x: 4, y: 6, width: 16, height: 12, rx: 2 }));

export async function openEditor(existing: Item | null, defaults: Partial<Item> = {}): Promise<void> {
  const session = app.session;
  if (!session) return;
  const doc = session.doc;
  const base: Item = existing
    ? structuredClone(existing)
    : { id: '', kind: 'event', start: whenAt(app.strip.view.center), title: '', ...defaults };
  // Each kind has its own window: an event stays an event, a period a period, an era an era (its dates set in the list of eras).
  const kind: ItemKind = base.kind;
  const isEra = kind === 'era';
  const texts = textFields(doc.lang, [
    { key: 'title', label: t('editor', 'Title'), value: base.title },
    { key: 'text', label: t('editor', 'Text'), multiline: true, value: base.text },
  ]);
  const start = dateField(t('editor', 'Start'), base.start);
  // A new item's end, should it become a period: a sixth of the screen after its start.
  const screen = app.strip.view.width / app.strip.view.pxPerDay;
  const endGuess = base.end && !isNow(base.end) ? base.end : existing ? base.start : snapTo(startOf(base.start) + screen / 6, base.start);
  const end = dateField(t('editor', 'End'), endGuess, true, !!base.end && isNow(base.end));

  const color = colorField({
    label: kind === 'event' ? t('editor', 'Colour: the dot and the mark on the card') : t('editor', 'Colour'),
    initial: base.color,
    none: { label: t('editor', 'No colour of its own'), color: doc.style?.color ?? DEFAULT_COLOR },
  });
  // An event's card: its fill and its shape.
  const background = colorField({
    label: t('editor', 'Card background'),
    initial: base.background,
    none: { label: t('editor', 'Paper, as every card'), color: '#fffaf0' },
    palette: BACKGROUNDS,
  });
  const shapeRow = h(
    'div',
    { class: 'segmented segmented--sizes', role: 'radiogroup', 'aria-label': t('editor', 'Shape') },
    ...([
      ['card', t('editor', 'Rectangle')],
      ['round', t('editor', 'Round')],
    ] as [CardShape, string][]).map(([shape, label]) =>
      h('label', { class: 'segment' }, h('input', { type: 'radio', name: 'shape', value: shape, checked: (base.shape ?? 'card') === shape }), h('span', {}, shapeIcon(shape), label)),
    ),
  );
  const shapeField = group(t('editor', 'Shape'), shapeRow, hint(t('editor', 'Round: a medallion with its picture and the title under it, or a disc that holds the title.')));


  // The card's size on the strip: each option a little card of its size.
  const sizeRow = h(
    'div',
    { class: 'segmented segmented--sizes', role: 'radiogroup', 'aria-label': t('editor', 'Size on the strip') },
    ...SIZE_OPTIONS.map(([size, px]) =>
      h(
        'label',
        { class: 'segment', title: sizeLabel(size) },
        h('input', { type: 'radio', name: 'size', value: size, checked: (base.size ?? 'normal') === size }),
        h('span', {}, sizeIcon(px), sizeLabel(size)),
      ),
    ),
  );
  // The size is how much the event matters: said under the picker, for the one picked.
  const sizeHint = h('p', { class: 'field-hint', id: 'edit-size-hint' });
  sizeRow.setAttribute('aria-describedby', 'edit-size-hint');
  const explainSize = () => (sizeHint.textContent = SIZE_MEANS[(sizeRow.querySelector<HTMLInputElement>('input:checked')?.value ?? 'normal') as CardSize]());
  sizeRow.addEventListener('change', explainSize);
  explainSize();
  const sizeField = group(t('editor', 'Size — the larger, the more it matters'), sizeRow, sizeHint);

  // A card moved by hand (its row, and how far from its dot) or a bar's row: kept, or given back to the layout.
  const keepLane = h('input', { type: 'checkbox', checked: true });
  const moved = base.lane !== undefined || base.shift !== undefined;
  const laneField = h(
    'label',
    { class: 'inline-check lane-field', hidden: !moved },
    keepLane,
    h(
      'span',
      {},
      base.kind === 'event'
        ? t('editor', 'Keep the card where it was dragged to; its date stays as set above')
        : t('editor', 'Keep it in the row it was dragged to (row {n})', { n: (base.lane ?? 0) + 1 }),
    ),
  );

  // The pictures: the first is on the card, the rest are its gallery.
  const pictures: Picture[] = picturesOf(base)
    .filter((hash) => doc.images[hash])
    .map((hash) => ({ hash, info: structuredClone(doc.images[hash]!) }));
  let current = 0;
  /** Thumbs asked of the store for the tiles, given back when the dialog closes. */
  const held = new Set<string>();
  const made = new Map<string, string>();
  const thumbUrl = async (p: Picture): Promise<string> => {
    if (p.encoded) {
      if (!made.has(p.hash)) made.set(p.hash, URL.createObjectURL(p.encoded.thumb));
      return made.get(p.hash)!;
    }
    if (!held.has(p.hash)) held.add(p.hash);
    else session.store.release(p.hash);
    return (await session.store.thumb(p.hash)) ?? '';
  };

  const tiles = h('div', { class: 'gallery-tiles', role: 'listbox', 'aria-label': t('editor', 'Pictures') });
  const preview = h('img', { class: 'editor-image', alt: '' });
  const captions = textFields(doc.lang, [{ key: 'caption', label: t('editor', 'Caption'), value: undefined }]);
  const creditAuthor = h('input', { class: 'field-input', type: 'text', placeholder: t('editor', 'Author') });
  const creditLicense = h('input', { class: 'field-input', type: 'text', placeholder: t('editor', 'Licence') });
  const creditUrl = h('input', { class: 'field-input', type: 'url', placeholder: 'https://…' });
  const earlier = h('button', { class: 'text-button', type: 'button' }, t('editor', '← Earlier'));
  const later = h('button', { class: 'text-button', type: 'button' }, t('editor', 'Later →'));
  const onCard = h('button', { class: 'text-button', type: 'button' }, t('editor', 'Put on the card'));
  const removeImage = h('button', { class: 'text-button text-button--danger', type: 'button' }, t('editor', 'Remove'));
  const pictureMeta = h(
    'div',
    { class: 'editor-image-meta' },
    captions.el,
    h('details', { class: 'credit' }, h('summary', {}, t('editor', 'Credit')), h('div', { class: 'credit-fields' }, creditAuthor, creditLicense, creditUrl)),
    h('div', { class: 'picture-actions' }, earlier, later, onCard, removeImage),
  );
  const selected = h('div', { class: 'editor-image-box' }, preview, pictureMeta);
  const imageEmpty = h('div', { class: 'gallery-empty' }, galleryIcon(), h('span', {}, t('editor', 'Drop or paste pictures here — the first one is on the card, the others make a gallery')));

  /** The caption and credit fields go into the picture they belong to before another one is shown. */
  const keepFields = () => {
    const p = pictures[current];
    if (!p) return;
    const caption = captions.read('caption');
    if (caption) p.info.caption = caption;
    else delete p.info.caption;
    const credit: Credit = { ...(p.info.credit ?? {}) };
    const fields = { author: creditAuthor.value.trim(), license: creditLicense.value.trim(), url: creditUrl.value.trim() };
    for (const key of ['author', 'license', 'url'] as const) {
      if (fields[key] && (key !== 'url' || /^https?:\/\//.test(fields[key]))) credit[key] = fields[key];
      else delete credit[key];
    }
    if (Object.keys(credit).length) p.info.credit = credit;
    else delete p.info.credit;
  };
  const loadFields = () => {
    const p = pictures[current];
    captions.set('caption', p?.info.caption);
    creditAuthor.value = p?.info.credit?.author ?? '';
    creditLicense.value = p?.info.credit?.license ?? '';
    creditUrl.value = p?.info.credit?.url ?? '';
  };
  const choose = (i: number) => {
    keepFields();
    current = Math.max(0, Math.min(i, pictures.length - 1));
    loadFields();
    void showPictures();
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= pictures.length || from === to) return;
    keepFields();
    const [p] = pictures.splice(from, 1);
    pictures.splice(to, 0, p!);
    current = to;
    loadFields();
    void showPictures();
  };
  const showPictures = async () => {
    const has = pictures.length > 0;
    selected.hidden = !has;
    imageEmpty.hidden = has;
    tiles.hidden = !has;
    const nodes = pictures.map((p, i) => {
      const img = h('img', { class: 'gallery-tile-image', alt: '', draggable: 'false' });
      void thumbUrl(p).then((url) => (img.src = url));
      const tile = h(
        'button',
        {
          class: 'gallery-tile',
          type: 'button',
          role: 'option',
          'aria-selected': String(i === current),
          'aria-label': p.info.caption || t('editor', 'Picture {n}', { n: i + 1 }),
          'data-index': String(i),
        },
        img,
        i === 0 ? h('span', { class: 'gallery-tile-badge' }, t('editor', 'Card')) : null,
      );
      tile.addEventListener('click', () => choose(i));
      tile.addEventListener('keydown', (event) => {
        // Alt + arrows move the picture; arrows alone walk the tiles.
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const step = event.key === 'ArrowLeft' ? -1 : 1;
        if (event.altKey) move(i, i + step);
        else choose(i + step);
        tiles.querySelector<HTMLElement>(`[data-index="${current}"]`)?.focus();
      });
      dragToReorder(tile, i);
      return tile;
    });
    nodes.push(h('button', { class: 'gallery-tile gallery-tile--add', type: 'button', title: t('editor', 'Add pictures'), 'aria-label': t('editor', 'Add pictures'), onclick: () => fileInput.click() }, '+'));
    tiles.replaceChildren(...nodes);
    earlier.disabled = current === 0;
    later.disabled = current >= pictures.length - 1;
    onCard.hidden = current === 0;
    const p = pictures[current];
    if (!p) return;
    if (p.encoded) {
      if (!made.has(`large:${p.hash}`)) made.set(`large:${p.hash}`, URL.createObjectURL(p.encoded.image));
      preview.src = made.get(`large:${p.hash}`)!;
    } else preview.src = (await session.store.image(p.hash)) ?? '';
  };
  /** A tile dragged along the row lands where it is let go. */
  const dragToReorder = (tile: HTMLElement, index: number) => {
    tile.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const x0 = event.clientX;
      let dragging = false;
      const moveTo = (e: PointerEvent) => {
        if (!dragging && Math.abs(e.clientX - x0) < 6) return;
        if (!dragging) {
          dragging = true;
          tile.setPointerCapture(e.pointerId);
          tile.classList.add('gallery-tile--dragging');
        }
        tile.style.transform = `translateX(${e.clientX - x0}px)`;
      };
      const up = (e: PointerEvent) => {
        if (!dragging) return;
        tile.style.transform = '';
        tile.classList.remove('gallery-tile--dragging');
        const rects = [...tiles.querySelectorAll<HTMLElement>('.gallery-tile:not(.gallery-tile--add)')].map((el) => el.getBoundingClientRect());
        let to = rects.findIndex((r) => e.clientX < r.left + r.width / 2);
        if (to < 0) to = rects.length;
        if (to > index) to--;
        // The click that follows is not a choice.
        tile.addEventListener('click', (c) => c.stopImmediatePropagation(), { capture: true, once: true });
        move(index, to);
      };
      trackPointer(tile, moveTo, up);
    });
  };
  const takeBlobs = async (blobs: Blob[]) => {
    for (const blob of blobs) {
      try {
        const encoded = await encodeImage(blob);
        if (pictures.some((p) => p.hash === encoded.hash)) continue;
        keepFields();
        pictures.push({ hash: encoded.hash, info: { ext: encoded.ext, w: encoded.w, h: encoded.h }, encoded });
        current = pictures.length - 1;
        loadFields();
        // A photo's own date fills an empty new event.
        if (!existing && encoded.taken && kind === 'event' && pictures.length === 1) {
          start.set(encoded.taken);
        }
      } catch (error) {
        toast(t('editor', 'This picture could not be read: {error}', { error: (error as Error).message }), { kind: 'error' });
      }
    }
    await showPictures();
  };
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length) void takeBlobs(files);
  });
  earlier.addEventListener('click', () => move(current, current - 1));
  later.addEventListener('click', () => move(current, current + 1));
  onCard.addEventListener('click', () => move(current, 0));
  removeImage.addEventListener('click', () => {
    pictures.splice(current, 1);
    current = Math.min(current, pictures.length - 1);
    loadFields();
    void showPictures();
  });
  const imageBox = h(
    'div',
    { class: 'gallery-editor' },
    tiles,
    imageEmpty,
    selected,
    h(
      'div',
      { class: 'editor-image-buttons' },
      h('button', { class: 'text-button', type: 'button', onclick: () => fileInput.click() }, t('editor', 'Choose files…')),
      h(
        'button',
        {
          class: 'text-button',
          type: 'button',
          onclick: async () => {
            const picked = await pickFromLibrary();
            if (!picked) return;
            keepFields();
            const at = pictures.findIndex((p) => p.hash === picked.hash);
            // Its caption and credit come with it.
            if (at < 0) pictures.push({ hash: picked.hash, info: picked.info, encoded: picked.image });
            current = at < 0 ? pictures.length - 1 : at;
            loadFields();
            await showPictures();
          },
        },
        t('editor', 'From a library file…'),
      ),
      fileInput,
    ),
  );
  loadFields();
  void showPictures();

  const refs = h('input', { class: 'field-input', type: 'text', id: 'edit-refs', value: base.refs ?? '', lang: doc.lang });
  const links = h('textarea', { class: 'field-input', rows: '2', id: 'edit-links', placeholder: 'https://…' }, (base.links ?? []).join('\n'));
  const tags = h('input', { class: 'field-input', type: 'text', id: 'edit-tags', value: (base.tags ?? []).join(', ') });

  const endBox = h('div', { class: 'editor-end' }, end.el);
  // A period is a bar: it has no pictures. (A file that gave one some keeps them; they are not edited here.)
  const hasPictures = kind !== 'period';
  const pictureField = group(t('editor', 'Pictures'), imageBox);
  // A card's row and a bar's row are different things; an era has neither.
  laneField.hidden = !moved || isEra;
  const isEvent = kind === 'event';

  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const body = h(
    'div',
    { class: `editor editor--${kind}` },
    texts.el,
    isEra
      ? h('p', { class: 'field-hint' }, `${formatRange(base.start, base.end)} · ${t('editor', 'An era’s dates are set in the list of eras, where they meet the eras beside it.')}`)
      : h('div', { class: 'editor-dates' }, start.el, kind === 'period' ? endBox : null),
    isEvent ? sizeField : null,
    color.el,
    isEvent ? background.el : null,
    hasPictures ? pictureField : null,
    isEvent ? shapeField : null,
    laneField,
    field(t('editor', 'References'), refs),
    field(t('editor', 'Links, one per line'), links),
    field(t('editor', 'Tags, separated by commas'), tags),
    error,
  );

  // Paste or drop pictures anywhere on the dialog — of an item that has pictures.
  body.addEventListener('paste', (event) => {
    if (!hasPictures) return;
    const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      void takeBlobs(files);
    }
  });
  body.addEventListener('dragover', (event) => {
    if (hasPictures && event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.stopPropagation();
      body.classList.add('editor--dropping');
    }
  });
  body.addEventListener('dragleave', (event) => {
    if (!body.contains(event.relatedTarget as Node)) body.classList.remove('editor--dropping');
  });
  body.addEventListener('drop', (event) => {
    body.classList.remove('editor--dropping');
    if (!hasPictures) return;
    const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void takeBlobs(files);
  });

  let result: Item | null = null;
  const check = (value: string): boolean => {
    if (value !== 'save') return true;
    const fail = (message: string) => {
      error.textContent = message;
      error.hidden = false;
      return false;
    };
    const title = texts.read('title');
    if (!title) return fail(t('editor', 'Give it a title.'));
    const s = isEra ? base.start : start.read();
    if (!s) return fail(t('editor', 'The start date is not a date.'));
    const item: Item = { ...base, id: base.id || newId(kind), kind, start: s, title };
    if (isEvent) {
      const fill = background.value();
      if (fill) item.background = fill;
      else delete item.background;
      if (shapeRow.querySelector<HTMLInputElement>('input:checked')?.value === 'round') item.shape = 'round';
      else delete item.shape;
    }
    if (isEra) item.end = base.end;
    else delete item.end;
    if (kind !== 'event' && !isEra) {
      let e: End | null = end.now() ? { now: true } : end.read();
      if (!e) return fail(t('editor', 'The end date is not a date.'));
      if (!isNow(e) && startOf(e) < startOf(s)) return fail(t('editor', 'The end comes before the start.'));
      item.end = e;
    }
    const text = texts.read('text');
    if (text) item.text = text;
    else delete item.text;
    const r = refs.value.trim();
    if (r) item.refs = r;
    else delete item.refs;
    const linkList = links.value.split(/\s+/).filter(Boolean);
    if (linkList.some((url) => !/^(https?:\/\/|mailto:)\S+$/i.test(url))) return fail(t('editor', 'Links must start with https:// or http://'));
    if (linkList.length) item.links = linkList;
    else delete item.links;
    const tagList = tags.value.split(',').map((tag) => tag.trim()).filter(Boolean);
    if (tagList.length) item.tags = tagList;
    else delete item.tags;
    if (kind === 'event') {
      const size = (sizeRow.querySelector<HTMLInputElement>('input:checked')?.value ?? 'normal') as CardSize;
      if (size === 'normal') delete item.size;
      else item.size = size;
    } else delete item.size;
    if (laneField.hidden || !keepLane.checked) {
      delete item.lane;
      delete item.shift;
    }
    const c = color.value();
    if (c) item.color = c;
    else delete item.color;
    keepFields();
    result = item;
    return true;
  };

  const buttons: { label: string; value: string; primary?: boolean; danger?: boolean }[] = [];
  if (existing) buttons.push({ label: t('editor', 'Delete'), value: 'delete', danger: true });
  buttons.push({ label: t('ui', 'Cancel'), value: 'cancel' }, { label: t('editor', 'Save'), value: 'save', primary: true });
  const answer = await dialog({ title: TITLES[kind][existing ? 1 : 0](), body, buttons, className: 'dialog--editor', check });
  for (const hash of held) session.store.release(hash);
  for (const url of made.values()) URL.revokeObjectURL(url);

  if (answer === 'delete' && existing) {
    deleteItem(existing.id);
    return;
  }
  if (answer !== 'save' || !result) return;
  const item: Item = result;
  const changes: Change[] = [];
  if (hasPictures) {
    for (const p of pictures) {
      if (p.encoded) session.store.added.set(p.hash, p.encoded);
      if (JSON.stringify(doc.images[p.hash]) !== JSON.stringify(p.info)) changes.push(imageChange(doc, p.hash, p.info));
    }
    if (pictures.length) item.image = pictures[0]!.hash;
    else delete item.image;
    if (pictures.length > 1) item.gallery = pictures.slice(1).map((p) => p.hash);
    else delete item.gallery;
  }
  if (!existing || JSON.stringify(existing) !== JSON.stringify(item)) changes.push(itemChange(doc, item.id, item));
  run(existing ? t('editor', 'Edit {title}', { title: item.title }) : t('editor', 'Add {title}', { title: item.title }), changes);
  const added = doc.items.find((i) => i.id === item.id);
  if (added) {
    app.strip.reveal(added);
    select(added.id);
  }
}

export function deleteItem(id: string): void {
  const session = app.session;
  const item = session?.doc.items.find((i) => i.id === id);
  if (!session || !item) return;
  const changes: Change[] = [itemChange(session.doc, id, undefined)];
  // An anchor on the item goes with it.
  if (session.doc.anchor?.item === id) changes.push(fieldChange(session.doc, 'anchor', undefined));
  const command = { label: t('editor', 'Delete {title}', { title: item.title }), changes };
  session.history.run(command);
  select(null);
  // The toast's Undo takes back this delete only — not whatever was done after it.
  toast(t('editor', 'Deleted “{title}”', { title: item.title }), {
    action: {
      label: t('editor', 'Undo'),
      run: () => {
        if (session.history.top === command) session.history.undo();
        else toast(t('editor', 'Other changes came after it: use Undo (⌘/Ctrl Z) step by step.'));
      },
    },
  });
}
