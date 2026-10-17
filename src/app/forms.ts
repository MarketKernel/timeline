/**
 * The pieces the page's forms are made of: a field with its label, a date,
 * a colour, texts in the file's language — shared by the editor, the eras'
 * list and Timeline settings.
 */

import { daysInMonth, isValidWhen, monthName, today, type When } from '../core/dates';
import { t } from '../core/i18n';
import { h } from './dom';

/** A heading inside a long form. */
export const section = (title: string): HTMLElement => h('h3', { class: 'form-section' }, title);

/** A line under a field that says what it does. */
export const hint = (text: string): HTMLElement => h('p', { class: 'field-hint' }, text);

/** A control with its label above it; a click on the label goes to the control. */
export const field = (label: string, control: HTMLElement, ...more: (HTMLElement | null)[]): HTMLElement =>
  h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, ...more);

/** Several controls under one label: a row of buttons, a picker. */
export const group = (label: string, ...children: (HTMLElement | null)[]): HTMLElement => h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), ...children);

export interface DateField {
  el: HTMLElement;
  /** The date typed, or null when it is not one a file may hold. */
  read(): When | null;
  /** Puts a date in (a photo's own date fills an empty new event). */
  set(w: When): void;
  /** "Until today" is ticked. */
  now(): boolean;
}

/** A date as day, month, year and era, with "c." and a spread; with `withNow`, "Until today" too. */
export function dateField(label: string, initial: When | undefined, withNow = false, isNowInitially = false): DateField {
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
    set(w) {
      year.value = String(w.y <= 0 ? 1 - w.y : w.y);
      era.value = w.y <= 0 ? 'bc' : 'ad';
      month.value = w.m ? String(w.m) : '';
      sync();
      day.value = w.d ? String(w.d) : '';
    },
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
export function textFields(lang: string, fields: { key: string; label: string; multiline?: boolean; value: string | undefined }[]) {
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  const el = h('div', { class: 'text-fields' });
  for (const f of fields) {
    const input = f.multiline
      ? h('textarea', { class: 'field-input', rows: '4', id: `edit-${f.key}`, lang })
      : h('input', { class: 'field-input', type: 'text', id: `edit-${f.key}`, lang, autofocus: f.key === 'title' });
    input.value = f.value ?? '';
    inputs.set(f.key, input);
    el.append(field(f.label, input));
  }
  /** Replaces a field's text (a picture from a library brings its caption). */
  const set = (key: string, text: string | undefined) => {
    inputs.get(key)!.value = text ?? '';
  };
  const read = (key: string): string | undefined => inputs.get(key)!.value.trim() || undefined;
  return { el, read, set };
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
