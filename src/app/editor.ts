/**
 * Editing (Task §6, §7).
 *
 * Edit mode is a toggle; outside it nothing moves by accident. In it:
 * - the edit bar adds: pick Event or Period, then click on the strip (an
 *   event) or drag from start to end (a period) where it belongs; eras have
 *   their own editor, a list (eras.ts), so they tile and never overlap;
 * - drag a card sideways to change its date (snapped to the precision it has:
 *   a year-only date moves by years), up or down to fix its row; drag its
 *   corner to make it larger or smaller;
 * - drag a bar to move a period, its end to change that date, or up and down
 *   to another row;
 * - drag the boundary between two eras: both neighbours follow, and an edge
 *   alone stops at the next era's;
 * - long-press (touch) or N to add an event, Delete to remove one (with undo);
 * - drop photos on the strip: one event per photo, at the date it was taken;
 *   on an item, they join its gallery.
 * The editor dialog edits everything else. Every change is one command on
 * the undo stack — a whole drag included.
 */

import { itemChange, imageChange, fieldChange, type Change } from '../core/commands';
import { daysInMonth, endDay, formatDuration, formatRange, formatWhen, isNow, isValidWhen, monthName, shiftWhen, snapTo, startOf, today, type End, type When } from '../core/dates';
import { shortId } from '../core/hash';
import { t, tn } from '../core/i18n';
import { DEFAULT_COLOR, picturesOf, spanOf, type CardShape, type CardSize, type Credit, type ImageInfo, type Item, type ItemKind } from '../core/model';
import { byId, h, isMac, isTouch } from './dom';
import { encodeImage, type NewImage } from './images';
import { pickFromLibrary } from './library';
import { focusItem, select } from './reading';
import { app, emit, on } from './state';
import { confirmDialog, dialog, toast } from './ui';
import { CARD_SIZES, discOf, galleryIcon, ROW } from './view';

function run(label: string, changes: Change[]): void {
  app.session?.history.run({ label, changes });
}

export function setEditing(on: boolean): void {
  app.editing = on;
  const button = byId('edit-toggle');
  button.setAttribute('aria-pressed', String(on));
  document.body.classList.toggle('editing', on);
  byId('edit-bar').hidden = !on;
  if (!on) arm(null);
  updateEditBar();
  emit('editing', on);
  if (app.strip.selected) select(app.strip.selected, false, false);
}

/* ------------------------------------------------------------------ *
 * The edit bar: add, undo, redo, and a line of help
 * ------------------------------------------------------------------ */

function hintText(): string {
  // A phone has room for one short line.
  if (placing && matchMedia('(max-width: 720px)').matches) {
    return placing.kind === 'event' ? t('editbar', 'Tap where it happened.') : t('editbar', 'Drag from its start to its end.');
  }
  switch (placing?.kind) {
    case 'event':
      return t('editbar', 'Click on the strip where the event happened.');
    case 'period':
      return t('editbar', 'Drag along the strip from the start of the period to its end.');
    default:
      return isTouch()
        ? t('editbar', 'Drag cards and bars to change dates, up or down to change rows. Long-press to add an event.')
        : t('editbar', 'Drag cards and bars sideways to change dates, up or down to change rows; a card’s corner to resize it. Drop photos on the strip.');
  }
}

function updateEditBar(): void {
  const history = app.session?.history;
  const undo = byId<HTMLButtonElement>('undo');
  const redo = byId<HTMLButtonElement>('redo');
  const mod = isMac() ? '⌘' : 'Ctrl+';
  undo.disabled = !history?.canUndo;
  redo.disabled = !history?.canRedo;
  undo.title = history?.undoLabel ? t('editbar', 'Undo: {what}', { what: history.undoLabel }) + ` (${mod}Z)` : t('editbar', 'Nothing to undo');
  redo.title = history?.redoLabel ? t('editbar', 'Redo: {what}', { what: history.redoLabel }) + ` (${isMac() ? '⇧⌘Z' : 'Ctrl+Y'})` : t('editbar', 'Nothing to redo');
  byId('edit-hint').textContent = hintText();
  byId('edit-cancel').hidden = !placing;
  for (const b of document.querySelectorAll<HTMLElement>('.add-button[data-kind]')) b.setAttribute('aria-pressed', String(b.dataset.kind === placing?.kind));
}

/* ------------------------------------------------------------------ *
 * Adding on the strip: pick a kind, then click (an event) or drag from
 * start to end (a period) where it belongs. The editor opens with the
 * dates filled in. Eras are not drawn: they are a list (eras.ts).
 * ------------------------------------------------------------------ */

type PlacedKind = Exclude<ItemKind, 'era'>;
let placing: { kind: PlacedKind; stop: () => void } | null = null;

function arm(kind: PlacedKind | null): void {
  placing?.stop();
  placing = null;
  document.body.classList.remove('placing');
  if (!kind || !app.session) {
    updateEditBar();
    return;
  }
  if (!app.editing) setEditing(true);
  const strip = app.strip;
  const tipEl = h('span', { class: 'place-tip' });
  const guide = h('div', { class: 'place-guide', hidden: true }, tipEl);
  strip.root.append(guide);
  const hover = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || document.body.classList.contains('drawing')) return;
    const x = event.clientX - strip.root.getBoundingClientRect().left;
    guide.hidden = false;
    guide.style.left = `${x}px`;
    tipEl.textContent = formatWhen(whenAt(strip.dayAt(x)));
  };
  const leave = () => (guide.hidden = true);
  const key = (event: KeyboardEvent) => {
    if (document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      arm(null);
    } else if (event.key === 'Enter' && !(event.target as HTMLElement).closest('button, input, select, textarea')) {
      // The keyboard way: the editor, at the middle of the screen.
      event.preventDefault();
      const kind = placing!.kind;
      arm(null);
      void openEditor(null, defaultsAt(kind, strip.view.center));
    }
  };
  strip.root.addEventListener('pointermove', hover);
  strip.root.addEventListener('pointerleave', leave);
  document.addEventListener('keydown', key, true);
  placing = {
    kind,
    stop: () => {
      guide.remove();
      strip.root.removeEventListener('pointermove', hover);
      strip.root.removeEventListener('pointerleave', leave);
      document.removeEventListener('keydown', key, true);
    },
  };
  document.body.classList.add('placing');
  updateEditBar();
}

/** A new item of a kind at a day: an event there, a period a sixth of the screen around it. */
function defaultsAt(kind: PlacedKind, day: number): Partial<Item> {
  if (kind === 'event') return { kind, start: whenAt(day) };
  const half = app.strip.view.width / app.strip.view.pxPerDay / 12;
  return { kind, start: whenAt(day - half), end: whenAt(day + half) };
}

/** A pointer pressed while adding: draws the range, and on release opens the editor. */
function startPlacing(event: PointerEvent): void {
  const strip = app.strip;
  const kind = placing!.kind;
  const rect = strip.root.getBoundingClientRect();
  const x0 = event.clientX - rect.left;
  const overBars = !!(event.target as HTMLElement).closest('.bars');
  const dayOf = (x: number) => strip.dayAt(x);
  // Where the new bar shows while it is drawn: the row under the pointer.
  const rootTop = rect.top;
  let barTop = 0;
  if (kind === 'period') {
    const bars = strip.root.querySelector<HTMLElement>('.bars-inner');
    const slot = overBars ? strip.barSlotAt(event.clientY) : null;
    const top = bars?.getBoundingClientRect().top ?? rootTop;
    barTop = top - rootTop + (slot ? slot.y : 4);
  }
  const range = h(
    'div',
    { class: `place-range place-range--${kind}`, hidden: true },
    h('span', { class: 'place-tip' }),
    kind === 'event' ? null : h('span', { class: 'place-bar', style: `top:${barTop}px` }),
  );
  strip.root.append(range);
  strip.root.setPointerCapture(event.pointerId);
  document.body.classList.add('drawing');
  let x1 = x0;
  const span = () => {
    const [a, b] = x0 <= x1 ? [x0, x1] : [x1, x0];
    return { a, b, start: whenAt(dayOf(a)), end: whenAt(dayOf(b)) };
  };
  const move = (e: PointerEvent) => {
    x1 = e.clientX - rect.left;
    if (kind === 'event' || Math.abs(x1 - x0) < 4) {
      range.hidden = true;
      return;
    }
    const { a, b, start, end } = span();
    range.hidden = false;
    range.style.left = `${a}px`;
    range.style.width = `${b - a}px`;
    (range.firstElementChild as HTMLElement).textContent = `${formatRange(start, end)} · ${formatDuration(startOf(end) - startOf(start))}`;
  };
  const up = (e: PointerEvent) => {
    strip.root.removeEventListener('pointermove', move);
    strip.root.removeEventListener('pointerup', up);
    strip.root.removeEventListener('pointercancel', up);
    document.body.classList.remove('drawing');
    range.remove();
    if (e.type === 'pointercancel') return;
    x1 = e.clientX - rect.left;
    let defaults: Partial<Item>;
    if (kind === 'event' || Math.abs(x1 - x0) < 4) defaults = defaultsAt(kind, strip.dayAt(kind === 'event' ? x1 : x0));
    else {
      const { start, end } = span();
      defaults = { kind, start, end: startOf(end) < startOf(start) ? start : end };
    }
    // The click that follows is not a selection.
    const swallow = (c: Event) => (c.stopPropagation(), c.preventDefault());
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    arm(null);
    void openEditor(null, defaults);
  };
  strip.root.addEventListener('pointermove', move);
  strip.root.addEventListener('pointerup', up);
  strip.root.addEventListener('pointercancel', up);
}

function setupEditBar(): void {
  for (const button of document.querySelectorAll<HTMLElement>('.add-button[data-kind]')) {
    button.addEventListener('click', () => {
      const kind = button.dataset.kind as PlacedKind;
      arm(placing?.kind === kind ? null : kind);
    });
  }
  byId('edit-cancel').addEventListener('click', () => arm(null));
  byId('edit-done').addEventListener('click', () => setEditing(false));
  byId('undo').addEventListener('click', () => app.session?.history.undo());
  byId('redo').addEventListener('click', () => app.session?.history.redo());
  on('changed', updateEditBar);
  on('opened', updateEditBar);
  on('saved', updateEditBar);
  on('language', updateEditBar);
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

interface DateField {
  el: HTMLElement;
  read(): When | null;
}

export function dateField(label: string, initial: When | undefined, withNow = false, isNowInitially = false): DateField & { now(): boolean } {
  const w = initial ?? today();
  const year = h('input', { class: 'field-input date-year', type: 'number', min: '1', step: '1', value: String(w.y <= 0 ? 1 - w.y : w.y), 'aria-label': t('editor', 'Year') });
  const era = h(
    'select',
    { class: 'field-input date-era', 'aria-label': t('editor', 'Era') },
    h('option', { value: 'ad', selected: w.y > 0 }, t('editor', 'AD')),
    h('option', { value: 'bc', selected: w.y <= 0 }, t('editor', 'BC')),
  );
  const month = h(
    'select',
    { class: 'field-input date-month', 'aria-label': t('editor', 'Month') },
    h('option', { value: '' }, t('editor', '— month')),
    ...Array.from({ length: 12 }, (_, i) => h('option', { value: String(i + 1), selected: w.m === i + 1 }, monthName(i + 1))),
  );
  const day = h(
    'select',
    { class: 'field-input date-day', 'aria-label': t('editor', 'Day') },
    h('option', { value: '' }, t('editor', '— day')),
    ...Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1), selected: w.d === i + 1 }, String(i + 1))),
  );
  const approx = h('input', { type: 'checkbox', checked: !!w.approx });
  const spread = h('input', { class: 'field-input date-spread', type: 'number', min: '0', step: '1', value: w.spread ? String(w.spread) : '', placeholder: '±', 'aria-label': t('editor', 'Give or take, years') });
  const nowBox = h('input', { type: 'checkbox', checked: isNowInitially });
  const sync = () => {
    day.disabled = !month.value;
    if (!month.value) day.value = '';
    for (const el of [year, era, month, day, approx, spread]) el.disabled = withNow && nowBox.checked ? true : el === day ? !month.value : false;
  };
  month.addEventListener('change', sync);
  nowBox.addEventListener('change', sync);
  sync();
  const row = h(
    'div',
    { class: 'date-row' },
    day,
    month,
    year,
    era,
    h('label', { class: 'inline-check', title: t('editor', 'Approximate: shown as “c.”') }, approx, h('span', {}, t('editor', 'c.'))),
    h('label', { class: 'inline-spread' }, h('span', {}, '±'), spread, h('span', {}, t('editor', 'yrs'))),
  );
  const el = h(
    'fieldset',
    { class: 'field date-field' },
    h('legend', { class: 'field-label' }, label),
    row,
    withNow ? h('label', { class: 'inline-check' }, nowBox, h('span', {}, t('editor', 'Until today'))) : null,
  );
  return {
    el,
    now: () => withNow && nowBox.checked,
    read() {
      const n = Number(year.value);
      if (!Number.isInteger(n) || n < 1 || n > 999_999) return null;
      const out: When = { y: era.value === 'bc' ? 1 - n : n };
      if (month.value) {
        out.m = Number(month.value);
        if (day.value) {
          const d = Number(day.value);
          if (d > daysInMonth(out.y, out.m)) return null;
          out.d = d;
        }
      }
      if (approx.checked) out.approx = true;
      const s = Number(spread.value);
      if (s > 0) out.spread = Math.round(s);
      // What the file's reader would refuse is refused here, not skipped silently at the next open.
      return isValidWhen(out) ? out : null;
    },
  };
}

/**
 * Title and text, or a caption: plain fields, written in the file's own
 * language — `lang` on them gives the spell checker the right dictionary.
 */
function textFields(lang: string, fields: { key: string; label: string; multiline?: boolean; value: string | undefined }[]) {
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  const el = h('div', { class: 'text-fields' });
  for (const f of fields) {
    const input = f.multiline
      ? h('textarea', { class: 'field-input', rows: '4', id: `edit-${f.key}`, lang })
      : h('input', { class: 'field-input', type: 'text', id: `edit-${f.key}`, lang, autofocus: f.key === 'title' });
    input.value = f.value ?? '';
    inputs.set(f.key, input);
    el.append(h('label', { class: 'field' }, h('span', { class: 'field-label' }, f.label), input));
  }
  /** Replaces a field's text (a picture from a library brings its caption). */
  const set = (key: string, text: string | undefined) => {
    inputs.get(key)!.value = text ?? '';
  };
  const read = (key: string): string | undefined => inputs.get(key)!.value.trim() || undefined;
  return { el, read, set };
}

/** A picture in the editor's gallery: its entry in the file, and its bytes when it is new to the file. */
interface Picture {
  hash: string;
  info: ImageInfo;
  encoded?: NewImage;
}

/** The size picker's options, each drawn as a little card of its size. */
const SIZE_OPTIONS: [CardSize, number][] = [
  ['small', 9],
  ['normal', 12],
  ['large', 16],
  ['huge', 21],
];

const sizeLabel = (size: CardSize): string =>
  size === 'small' ? t('editor', 'Small') : size === 'large' ? t('editor', 'Large') : size === 'huge' ? t('editor', 'Huge') : t('editor', 'Normal');

function sizeIcon(px: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  const x = (24 - px) / 2;
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(24 - 2 - px * 0.8));
  rect.setAttribute('width', String(px));
  rect.setAttribute('height', String(px * 0.8));
  rect.setAttribute('rx', '1.5');
  svg.append(rect);
  return svg;
}

/** Muted earth tones that still separate (Task §9): the colours offered first. */
export const PALETTE = ['#b07d3c', '#a5603f', '#6f7f4f', '#5c6f86', '#8a4a52', '#4f5486', '#8a6a3c', '#7b5e8a', '#4f7f78', '#946b2d', '#6b6b6b'];

/**
 * A colour picker: none (shown in what "none" means — the warm grey, the
 * parchment), the palette, or any other; `value()` is undefined for none.
 */
export function colorField(options: {
  label: string;
  initial: string | undefined;
  none: { label: string; color: string };
  palette?: readonly string[];
  /** Called on every pick: a live preview. */
  onChange?: (color: string | undefined) => void;
}): { el: HTMLElement; value: () => string | undefined } {
  const palette = options.palette ?? PALETTE;
  let color = options.initial;
  const labelId = `color-label-${++colorFields}`;
  const custom = h('input', { class: 'color-custom', type: 'color', value: color ?? options.none.color, title: t('editor', 'Another colour'), 'aria-label': t('editor', 'Another colour') });
  const swatches = [undefined, ...palette].map((c) =>
    h('button', {
      class: c ? 'color-swatch' : 'color-swatch color-swatch--none',
      type: 'button',
      style: `--swatch:${c ?? options.none.color}`,
      'data-color': c ?? '',
      title: c ?? options.none.label,
      'aria-label': c ?? options.none.label,
      onclick: () => {
        color = c;
        paint();
      },
    }),
  );
  const paint = () => {
    for (const b of swatches) b.setAttribute('aria-pressed', String(b.dataset.color === (color ?? '')));
    custom.classList.toggle('is-picked', !!color && !palette.includes(color));
    options.onChange?.(color);
  };
  custom.addEventListener('input', () => {
    color = custom.value;
    paint();
  });
  paint();
  const el = h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label', id: labelId }, options.label),
    h('div', { class: 'color-row', role: 'group', 'aria-labelledby': labelId }, ...swatches, custom),
  );
  return { el, value: () => color };
}
let colorFields = 0;

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
function shapeIcon(shape: CardShape): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const el = document.createElementNS('http://www.w3.org/2000/svg', shape === 'round' ? 'circle' : 'rect');
  const attrs: Record<string, string> = shape === 'round' ? { cx: '12', cy: '12', r: '8' } : { x: '4', y: '6', width: '16', height: '12', rx: '2' };
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  svg.append(el);
  return svg;
}

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
  const shapeField = h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, t('editor', 'Shape')),
    shapeRow,
    h('p', { class: 'field-hint' }, t('editor', 'Round: a medallion with its picture and the title under it, or a disc that holds the title.')),
  );


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
  const sizeField = h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('editor', 'Size — the larger, the more it matters')), sizeRow, sizeHint);

  // A row fixed by dragging: kept, or given back to the layout.
  const keepLane = h('input', { type: 'checkbox', checked: true });
  const laneField = h(
    'label',
    { class: 'inline-check lane-field', hidden: base.lane === undefined },
    keepLane,
    h('span', {}, t('editor', 'Keep it in the row it was dragged to (row {n})', { n: (base.lane ?? 0) + 1 })),
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
        tile.removeEventListener('pointermove', moveTo);
        tile.removeEventListener('pointerup', up);
        tile.removeEventListener('pointercancel', up);
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
      tile.addEventListener('pointermove', moveTo);
      tile.addEventListener('pointerup', up);
      tile.addEventListener('pointercancel', up);
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
          start.el.querySelector<HTMLInputElement>('.date-year')!.value = String(encoded.taken.y);
          start.el.querySelector<HTMLSelectElement>('.date-era')!.value = 'ad';
          start.el.querySelector<HTMLSelectElement>('.date-month')!.value = String(encoded.taken.m);
          start.el.querySelector<HTMLSelectElement>('.date-month')!.dispatchEvent(new Event('change'));
          start.el.querySelector<HTMLSelectElement>('.date-day')!.value = String(encoded.taken.d);
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
  const pictureField = h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('editor', 'Pictures')), imageBox);
  // A card's row and a bar's row are different things; an era has neither.
  laneField.hidden = base.lane === undefined || isEra;
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
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('editor', 'References')), refs),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('editor', 'Links, one per line')), links),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('editor', 'Tags, separated by commas')), tags),
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
    if (laneField.hidden || !keepLane.checked) delete item.lane;
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
  if (!app.editing) setEditing(true);
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

/* ------------------------------------------------------------------ *
 * Dragging on the strip
 * ------------------------------------------------------------------ */

function tip(text: string, x: number, y: number): HTMLElement {
  let el = document.querySelector<HTMLElement>('.drag-tip');
  if (!el) {
    el = h('div', { class: 'drag-tip', role: 'status' });
    app.strip.root.append(el);
  }
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  return el;
}

const clearTip = () => document.querySelector('.drag-tip')?.remove();

function setupDragging(): void {
  const strip = app.strip;
  strip.claimPointer = (event) => {
    if (!app.editing || !app.session) return false;
    // Adding: the press is where the new item goes, whatever is under it; a second finger changes nothing.
    if (placing) {
      if (!document.body.classList.contains('drawing')) startPlacing(event);
      return true;
    }
    const target = (event.target as HTMLElement).closest<HTMLElement>('.card, .dot, .bar, .era');
    const id = target?.dataset.id;
    const doc = app.session.doc;
    const item = doc.items.find((i) => i.id === id);
    if (!target || !item) return false;
    if ((event.target as HTMLElement).closest('.card-resize')) {
      resizeCard(event, target, item);
      return true;
    }
    const rect = strip.root.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const localX = event.clientX - box.left;
    let mode: 'move' | 'start' | 'end' | 'boundary-left' | 'boundary-right' = 'move';
    if (item.kind === 'period') {
      if (localX < 7) mode = 'start';
      else if (box.width - localX < 7) mode = 'end';
    }
    if (item.kind === 'era') {
      if (localX < 7) mode = 'boundary-left';
      else if (box.width - localX < 7) mode = 'boundary-right';
      else return false; // the middle of an era pans, as everywhere
    }
    const px = strip.view.pxPerDay;
    const x0 = event.clientX;
    const y0 = event.clientY;
    let moved = false;
    /** A drag goes one way: sideways changes the date, up or down the row — never both by accident. */
    let axis: 'x' | 'y' | null = null;
    const placed = strip.placed.get(item.id);
    const canRise = (item.kind === 'event' && !!placed && placed.mode !== 'dot') || (item.kind === 'period' && mode === 'move');
    let next: Change[] = [];
    let label = '';
    target.setPointerCapture(event.pointerId);

    const eras = doc.items.filter((i) => i.kind === 'era').sort((a, b) => startOf(a.start) - startOf(b.start));
    const neighbour = (side: 'left' | 'right'): Item | undefined => {
      const i = eras.indexOf(item);
      return side === 'left' ? eras[i - 1] : eras[i + 1];
    };

    const move = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      axis ??= canRise && Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      document.body.classList.add('dragging');
      const days = dx / px;
      next = [];
      let text = '';
      if (axis === 'y' && item.kind === 'event' && placed) {
        // Up or down: the card's row, counted from the axis, snapped as it goes.
        const lane = Math.max(0, placed.row - Math.round(dy / ROW));
        next = lane === placed.row && item.lane === lane ? [] : [itemChange(doc, item.id, { ...item, lane })];
        text = t('editor', 'Row {n}', { n: lane + 1 });
        target.style.transform = `translateY(${(placed.row - lane) * ROW}px)`;
        label = t('editor', 'Move {title}', { title: item.title });
      } else if (axis === 'y' && item.kind === 'period') {
        // Up or down: another row — one past the last row starts a new one.
        const slot = strip.barSlotAt(e.clientY);
        if (!slot) return;
        next = [itemChange(doc, item.id, { ...item, lane: slot.row })];
        text = t('editor', 'Row {n}', { n: slot.row + 1 });
        target.style.transform = `translateY(${slot.y - parseFloat(target.style.top || '0')}px)`;
        label = t('editor', 'Move {title}', { title: item.title });
      } else if (item.kind === 'event') {
        const start = shiftWhen(item.start, days);
        next = [itemChange(doc, item.id, { ...item, start })];
        text = formatWhen(start);
        target.style.transform = `translateX(${dx}px)`;
        label = t('editor', 'Move {title}', { title: item.title });
      } else if (item.kind === 'period') {
        const changed: Item = { ...item };
        if (mode !== 'end') changed.start = shiftWhen(item.start, days);
        if (mode !== 'start' && item.end && !isNow(item.end)) changed.end = shiftWhen(item.end, days);
        if (changed.end && !isNow(changed.end) && startOf(changed.end) < startOf(changed.start)) return;
        next = [itemChange(doc, item.id, changed)];
        text = mode === 'end' && changed.end && !isNow(changed.end) ? formatWhen(changed.end) : formatWhen(changed.start);
        if (mode === 'move') target.style.transform = `translateX(${dx}px)`;
        else if (mode === 'start') {
          target.style.transform = `translateX(${dx}px)`;
          target.style.width = `${Math.max(2, box.width - dx)}px`;
        } else target.style.width = `${Math.max(2, box.width + dx)}px`;
        label = t('editor', 'Change {title}', { title: item.title });
      } else {
        // An era boundary: when the neighbour touches this edge, both move; otherwise the edge alone.
        const other = neighbour(mode === 'boundary-left' ? 'left' : 'right');
        const touching = (l: Item | undefined, r: Item | undefined) => !!l?.end && !isNow(l.end) && !!r && endDay(l.end) === startOf(r.start);
        const left = mode === 'boundary-left' ? (touching(other, item) ? other : undefined) : item;
        const right = mode === 'boundary-left' ? item : touching(item, other) ? other : undefined;
        if (left && right && left.end && !isNow(left.end)) {
          const rightStart = snapTo(startOf(right.start) + days, right.start);
          const leftEnd = snapTo(startOf(rightStart) - 1, left.end);
          if (startOf(leftEnd) < startOf(left.start) || (right.end && !isNow(right.end) && startOf(right.end) < startOf(rightStart))) return;
          next = [itemChange(doc, left.id, { ...left, end: leftEnd }), itemChange(doc, right.id, { ...right, start: rightStart })];
          text = formatWhen(rightStart);
        } else if (mode === 'boundary-left') {
          const start = shiftWhen(item.start, days);
          if (item.end && !isNow(item.end) && startOf(item.end) < startOf(start)) return;
          // An edge alone stops where the era before it ends: eras never overlap.
          if (other?.end && startOf(start) < endDay(other.end)) return;
          next = [itemChange(doc, item.id, { ...item, start })];
          text = formatWhen(start);
        } else {
          if (!item.end || isNow(item.end)) return;
          const end = shiftWhen(item.end, days);
          if (startOf(end) < startOf(item.start)) return;
          if (other && endDay(end) > startOf(other.start)) return;
          next = [itemChange(doc, item.id, { ...item, end })];
          text = formatWhen(end);
        }
        target.style.boxShadow = 'inset 0 0 0 2px var(--accent)';
        label = t('editor', 'Move the boundary of {title}', { title: item.title });
      }
      tip(text, e.clientX - rect.left, e.clientY - rect.top - 36);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
      clearTip();
      target.style.transform = '';
      target.style.width = '';
      target.style.boxShadow = '';
      if (moved) swallowClick();
      if (moved && next.length) run(label, next);
      else if (moved) strip.refresh();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    return true;
  };
}

/** A mouse click follows a drag at once: swallow that one, and nothing later (a touch drag has no click). */
function swallowClick(): void {
  const swallow = (e: Event) => (e.stopPropagation(), e.preventDefault());
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

/**
 * The corner of a card dragged: the card grows up and to the right from its
 * dot, through the sizes small · normal · large · huge, snapping to each.
 */
function resizeCard(event: PointerEvent, card: HTMLElement, item: Item): void {
  const strip = app.strip;
  const doc = app.session!.doc;
  const rect = strip.root.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const from: CardSize = item.size ?? 'normal';
  // A round card is as wide as its disc.
  const widthOf = (s: CardSize) => (item.shape === 'round' ? discOf(s) : CARD_SIZES[s].width);
  let size = from;
  let moved = false;
  card.setPointerCapture(event.pointerId);
  document.body.classList.add('resizing');
  const move = (e: PointerEvent) => {
    if (!moved && Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 3) return;
    moved = true;
    // As wide as the pointer is far from the left edge, or as tall as it is above the bottom — whichever is more.
    const wanted = Math.max(e.clientX - box.left, ((box.bottom - e.clientY) * box.width) / box.height);
    size = SIZE_OPTIONS.map(([s]) => s).reduce((best, s) => (Math.abs(widthOf(s) - wanted) < Math.abs(widthOf(best) - wanted) ? s : best), from);
    const width = widthOf(size);
    if (item.shape === 'round') {
      // Its disc has a size of its own: the whole medallion grows from where it stands.
      card.style.transformOrigin = 'bottom center';
      card.style.transform = `scale(${width / box.width})`;
    } else {
      card.style.width = `${width}px`;
      card.style.height = `${Math.round((box.height * width) / box.width)}px`;
    }
    tip(sizeLabel(size), box.left - rect.left + width / 2, Math.max(12, e.clientY - rect.top - 36));
  };
  const up = () => {
    card.removeEventListener('pointermove', move);
    card.removeEventListener('pointerup', up);
    card.removeEventListener('pointercancel', up);
    document.body.classList.remove('resizing');
    clearTip();
    card.style.width = '';
    card.style.height = '';
    card.style.transform = '';
    card.style.transformOrigin = '';
    if (!moved) return;
    swallowClick();
    if (size === from) {
      strip.refresh();
      return;
    }
    const changed: Item = { ...item };
    if (size === 'normal') delete changed.size;
    else changed.size = size;
    run(t('editor', 'Resize {title}', { title: item.title }), [itemChange(doc, item.id, changed)]);
    // Made smaller than this zoom shows cards of: it is a dot now — say why, or it seems lost.
    setTimeout(() => {
      if (strip.placed.get(item.id)?.mode === 'dot') {
        toast(t('editor', '“{title}” is {size} now: cards that size show from closer. Zoom in to see it.', { title: item.title, size: sizeLabel(size).toLowerCase() }));
      }
    }, 120);
  };
  card.addEventListener('pointermove', move);
  card.addEventListener('pointerup', up);
  card.addEventListener('pointercancel', up);
}

/* ------------------------------------------------------------------ *
 * Long press, photos dropped on the strip
 * ------------------------------------------------------------------ */

function setupLongPress(): void {
  const strip = app.strip;
  let timer = 0;
  let at: { x: number; y: number } | null = null;
  let fingers = 0;
  strip.root.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') fingers++;
    clearTimeout(timer);
    // A second finger is a pinch, not a long press.
    if (fingers > 1) {
      at = null;
      return;
    }
    if (!app.editing || placing || event.pointerType === 'mouse' || (event.target as HTMLElement).closest('[data-id]')) return;
    at = { x: event.clientX, y: event.clientY };
    const x = event.clientX - strip.root.getBoundingClientRect().left;
    timer = window.setTimeout(() => {
      at = null;
      void openEditor(null, { start: whenAt(strip.dayAt(x)) });
    }, 550);
  });
  const cancel = (event: PointerEvent) => {
    if ((event.type === 'pointerup' || event.type === 'pointercancel') && event.pointerType !== 'mouse') fingers = Math.max(0, fingers - 1);
    if (at && event.type === 'pointermove' && Math.hypot(event.clientX - at.x, event.clientY - at.y) < 8) return;
    clearTimeout(timer);
    at = null;
  };
  for (const type of ['pointermove', 'pointerup', 'pointercancel'] as const) strip.root.addEventListener(type, cancel);
}

async function addPhotos(files: File[], dropDay: number, onto: Item | null): Promise<void> {
  const session = app.session;
  if (!session) return;
  const doc = session.doc;
  const close = toast(t('editor', 'Reading pictures…'), { duration: 0 });
  const changes: Change[] = [];
  const taken = new Set(doc.items.map((i) => i.id));
  /** Pictures dropped on an item join its gallery; the first becomes its card's picture if it had none. */
  const pictures = onto ? picturesOf(onto) : [];
  let added = 0;
  let firstId = '';
  try {
    for (const file of files) {
      const encoded = await encodeImage(file);
      session.store.added.set(encoded.hash, { ext: encoded.ext, thumb: encoded.thumb, image: encoded.image });
      if (!doc.images[encoded.hash] && !changes.some((c) => c.target === 'image' && c.id === encoded.hash)) {
        changes.push(imageChange(doc, encoded.hash, { ext: encoded.ext, w: encoded.w, h: encoded.h }));
      }
      if (onto) {
        if (!pictures.includes(encoded.hash)) {
          pictures.push(encoded.hash);
          added++;
        }
        continue;
      }
      const id = shortId('e', taken);
      taken.add(id);
      const start: When = encoded.taken ? { y: encoded.taken.y, m: encoded.taken.m, d: encoded.taken.d } : whenAt(dropDay);
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || t('editor', 'Photo');
      changes.push(itemChange(doc, id, { id, kind: 'event', start, title, image: encoded.hash }));
      added++;
      firstId ||= id;
    }
  } catch (error) {
    toast(t('editor', 'This picture could not be read: {error}', { error: (error as Error).message }), { kind: 'error' });
  } finally {
    close();
  }
  if (onto && added) {
    const changed: Item = { ...onto, image: pictures[0] };
    if (pictures.length > 1) changed.gallery = pictures.slice(1);
    changes.push(itemChange(doc, onto.id, changed));
    firstId = onto.id;
  }
  if (!changes.length || !added) return;
  run(onto ? tn('editor', 'Add {count} picture to {title}', 'Add {count} pictures to {title}', added, { title: onto.title }) : tn('editor', 'Add {count} photo', 'Add {count} photos', added), changes);
  if (onto && added) toast(tn('editor', '{count} picture added to “{title}”', '{count} pictures added to “{title}”', added, { title: onto.title }));
  const first = doc.items.find((i) => i.id === firstId);
  if (first) {
    app.strip.reveal(first);
    select(first.id);
  }
}

function setupDrops(): void {
  const root = app.strip.root;
  root.addEventListener('dragover', (event) => {
    if (app.editing && event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    }
  });
  root.addEventListener('drop', (event) => {
    if (!app.editing) return;
    const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    document.body.classList.remove('dropping');
    // On an event, they join its gallery; anywhere else — a period's bar or an era included — each is an event of its own.
    const target = (event.target as HTMLElement).closest<HTMLElement>('.card, .dot');
    const onto = target ? (app.session?.doc.items.find((i) => i.id === target.dataset.id) ?? null) : null;
    const x = event.clientX - root.getBoundingClientRect().left;
    void addPhotos(files, app.strip.dayAt(x), onto);
  });
  // Paste a picture on the strip in edit mode: into the selected item's gallery, or a new event at the middle of the screen.
  document.addEventListener('paste', (event) => {
    if (!app.editing || !app.session || document.querySelector('dialog[open]')) return;
    const el = event.target as HTMLElement;
    if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
    const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    const selected = app.session.doc.items.find((i) => i.id === app.strip.selected && i.kind === 'event') ?? null;
    void addPhotos(files, app.strip.view.center, selected);
  });
}

/* ------------------------------------------------------------------ *
 * Keyboard: E, N, Delete
 * ------------------------------------------------------------------ */

function focused(): Item | undefined {
  const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-id]')?.dataset.id ?? app.strip.selected;
  return app.session?.doc.items.find((i) => i.id === id);
}

function onKey(event: KeyboardEvent): void {
  if (!app.session || byId('app').hidden || document.querySelector('dialog[open]') || document.querySelector('.menu')) return;
  const el = event.target as HTMLElement;
  if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'e') {
    event.preventDefault();
    const item = focused();
    if (item) {
      if (!app.editing) setEditing(true);
      void openEditor(item);
    } else setEditing(!app.editing);
  } else if (key === 'n') {
    event.preventDefault();
    if (!app.editing) setEditing(true);
    void openEditor(null);
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && app.editing) {
    const item = focused();
    if (!item) return;
    event.preventDefault();
    const list = [...app.session.doc.items];
    deleteItem(item.id);
    // Focus moves on to the next item in time.
    const nextItem = list.filter((i) => i.id !== item.id).sort((a, b) => spanOf(a)[0] - spanOf(b)[0]).find((i) => spanOf(i)[0] >= spanOf(item)[0]);
    if (nextItem) focusItem(nextItem);
  }
}

/** "Count years from here": the item becomes the anchor of the second ruler. */
async function makeAnchor(id: string): Promise<void> {
  const session = app.session;
  const item = session?.doc.items.find((i) => i.id === id);
  if (!session || !item) return;
  const current = session.doc.anchor;
  if (current && !(await confirmDialog(t('editor', 'Count years from here?'), t('editor', 'The second ruler counts from “{title}” instead of “{old}”.', { title: item.title, old: current.label }), t('editor', 'Count from here')))) {
    return;
  }
  run(t('editor', 'Count years from {title}', { title: item.title }), [fieldChange(session.doc, 'anchor', { item: item.id, label: item.title, base: 0 })]);
  if (!app.settings.secondRuler) toast(t('editor', 'The second ruler is off in Settings.'));
}

export function setupEditing(): void {
  byId('edit-toggle').addEventListener('click', () => setEditing(!app.editing));
  // An era opens the list of eras instead (eras.ts).
  on('open', (id) => {
    if (!app.editing) return;
    const item = app.session?.doc.items.find((i) => i.id === id);
    if (item && item.kind !== 'era') void openEditor(item);
  });
  on('closed', () => setEditing(false));
  window.addEventListener('timeline:anchor', (event) => void makeAnchor((event as CustomEvent<string>).detail));
  document.addEventListener('keydown', onKey);
  setupEditBar();
  setupDragging();
  setupLongPress();
  setupDrops();
}
