/**
 * The eras' own editor: a list, in time order (Task §6). Eras tile the axis,
 * so each row says only where its era begins; it ends the day before the next
 * row begins, and the last one where the list says — a date or the present
 * day. Overlaps cannot be written down; a row without a name is a gap. Dates
 * are typed as people write them ("c. 1446 BC", "14 Apr AD 30", "1517") and
 * read back at once below the row with the span and length they make.
 *
 * The Eras button on the edit bar opens it; so does a click on an era in edit
 * mode, at that era's row. A row's pencil saves the list and opens the era in
 * the item editor, for its text and pictures. Saving is one command.
 */

import { itemChange, type Change } from '../core/commands';
import { endDay, formatDuration, formatRange, isNow, parseWhen, snapTo, startOf, todayDay, whenText, type End, type When } from '../core/dates';
import { checkEras, readEras, writeEras, type EraRow } from '../core/eras';
import { shortId } from '../core/hash';
import { language, t } from '../core/i18n';
import { DEFAULT_COLOR, extentOf } from '../core/model';
import { byId, h, icon } from './dom';
import { openEditor } from './editor';
import { PALETTE } from './forms';
import { app, on } from './state';
import { dialog } from './ui';

/** A row as edited: the era (or gap) and the text of its beginning, which may not be a date yet. */
interface Row {
  era: EraRow;
  text: string;
}

const PENCIL = ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'];
const PLUS = ['M12 5v14M5 12h14'];
const CROSS = ['M6 6l12 12M18 6L6 18'];

async function openEras(focusId?: string): Promise<void> {
  const session = app.session;
  if (!session) return;
  const doc = session.doc;
  const lang = language();
  const list = readEras(doc.items);
  const rows: Row[] = (list?.rows ?? []).map((era) => ({ era: { ...era }, text: whenText(era.start, lang) }));
  let end: End = list?.end ?? doc.end ?? { now: true };
  const taken = new Set(doc.items.map((i) => i.id));
  const newId = () => {
    const id = shortId('r', taken);
    taken.add(id);
    return id;
  };
  /** A colour for a new era that neither neighbour has. */
  const colorBeside = (i: number) => PALETTE.find((c) => c !== rows[i - 1]?.era.color && c !== rows[i]?.era.color) ?? PALETTE[0]!;

  const listEl = h('ol', { class: 'era-list' });
  const endMode = h(
    'select',
    { class: 'field-input', id: 'eras-end-mode' },
    h('option', { value: 'date' }, t('eras', 'On a date')),
    h('option', { value: 'now' }, t('eras', 'To the present day')),
  );
  const endText = h('input', { class: 'field-input era-date', type: 'text', id: 'eras-end', 'aria-label': t('eras', 'The last era ends'), spellcheck: 'false', autocomplete: 'off' });
  const endMeta = h('p', { class: 'era-meta' });
  endMode.value = isNow(end) ? 'now' : 'date';
  endText.value = isNow(end) ? '' : whenText(end, lang);
  const endField = h(
    'div',
    { class: 'era-end' },
    h('span', { class: 'field-label' }, t('eras', 'The last era ends')),
    h('div', { class: 'era-end-row' }, endMode, endText),
    endMeta,
  );
  const empty = h('p', { class: 'era-empty' }, t('eras', 'No eras yet. An era is a coloured band under the axis — the coarse view that still reads when everything else is folded away.'));
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });

  /** The end as typed: a date, today, or null when the text is not a date. */
  const readEnd = (): End | null => (endMode.value === 'now' ? { now: true } : parseWhen(endText.value));

  /** Below each row: the span it makes and how long, or what is wrong. */
  const refresh = () => {
    const starts = rows.map((r) => parseWhen(r.text));
    const typedEnd = readEnd();
    endText.hidden = endMode.value === 'now';
    endField.hidden = !rows.length;
    empty.hidden = rows.length > 0;
    const problems = starts.every(Boolean) && typedEnd ? checkEras({ rows: rows.map((r, i) => ({ ...r.era, start: starts[i]! })), end: typedEnd }) : [];
    rows.forEach((row, i) => {
      const li = listEl.children[i] as HTMLElement | undefined;
      if (!li) return;
      const meta = li.querySelector<HTMLElement>('.era-meta')!;
      const start = starts[i];
      const next = starts[i + 1];
      let text = '';
      let wrong = false;
      if (!start) {
        text = t('eras', 'Not a date: write it as 1446 BC, c. 30 AD, Oct 1517 or 1517-10-31.');
        wrong = true;
      } else if (problems.some((p) => p.row === i && p.problem === 'order')) {
        text = t('eras', 'Begins no later than the era above: the list is in time order.');
        wrong = true;
      } else {
        const last: End | null = i < rows.length - 1 ? (next ? snapTo(startOf(next) - 1, next) : null) : typedEnd;
        // Above a row that begins too early there is no span to show: the mistake is that row's.
        if (last && endDay(last) > startOf(start)) {
          const span = `${formatRange(start, last)} · ${formatDuration(endDay(last) - startOf(start))}`;
          text = row.era.title ? span : `${t('eras', 'A gap: no era here')} · ${span}`;
        }
      }
      meta.textContent = text;
      meta.classList.toggle('era-meta--wrong', wrong);
      li.classList.toggle('era-row--wrong', wrong);
      li.classList.toggle('era-row--gap', !row.era.title);
      li.querySelector<HTMLInputElement>('.era-date')!.setAttribute('aria-invalid', String(wrong));
    });
    const endWrong = endMode.value === 'date' && (!typedEnd || problems.some((p) => p.problem === 'end'));
    endMeta.textContent = !typedEnd ? t('eras', 'Not a date: write it as 1446 BC, c. 30 AD, Oct 1517 or 1517-10-31.') : endWrong ? t('eras', 'The last era ends before it begins.') : '';
    endMeta.classList.toggle('era-meta--wrong', endWrong);
    endField.classList.toggle('era-end--wrong', endWrong);
    endText.setAttribute('aria-invalid', String(endWrong));
  };

  const rowEl = (row: Row, i: number): HTMLElement => {
    const color = h('input', {
      class: 'era-color',
      type: 'color',
      list: 'era-palette',
      value: row.era.color ?? DEFAULT_COLOR,
      title: t('eras', 'Colour'),
      'aria-label': t('eras', 'Colour'),
    });
    color.addEventListener('input', () => (row.era.color = color.value));
    const name = h('input', { class: 'field-input era-name', type: 'text', lang: doc.lang, value: row.era.title, placeholder: t('eras', 'No name: a gap'), 'aria-label': t('eras', 'Name') });
    name.addEventListener('input', () => {
      const was = !!row.era.title;
      row.era.title = name.value.trim();
      // A gap that is given a name becomes an era.
      if (row.era.title && !row.era.id) row.era.id = newId();
      if (row.era.title && !was && !row.era.color) color.value = row.era.color = colorBeside(i);
      refresh();
    });
    const date = h('input', { class: 'field-input era-date', type: 'text', value: row.text, spellcheck: 'false', autocomplete: 'off', 'aria-label': t('eras', 'Begins') });
    date.addEventListener('input', () => {
      row.text = date.value;
      refresh();
    });
    const button = (paths: string[], label: string, run: () => void, extra = '') =>
      h('button', { class: `icon-button era-action${extra}`, type: 'button', title: label, 'aria-label': label, onclick: run }, icon(...paths));
    return h(
      'li',
      { class: 'era-row', 'data-id': row.era.id ?? '' },
      color,
      name,
      h('label', { class: 'era-from' }, h('span', {}, t('eras', 'from')), date),
      h(
        'div',
        { class: 'era-actions' },
        row.era.title ? button(PENCIL, t('eras', 'Text and pictures…'), () => details(row)) : null,
        button(PLUS, t('eras', 'Split it: a new era in its second half'), () => split(i)),
        button(CROSS, t('eras', 'Delete: the era above takes its time'), () => remove(i), ' era-action--danger'),
      ),
      h('p', { class: 'era-meta' }),
    );
  };
  const render = (focus?: number) => {
    listEl.replaceChildren(...rows.map(rowEl));
    refresh();
    if (focus !== undefined) listEl.children[focus]?.querySelector<HTMLInputElement>('.era-name')?.select();
  };

  /** Where row i ends, as typed so far: the next row's beginning, or the list's end. */
  const endOfRow = (i: number): number | null => {
    const next = rows[i + 1] ? parseWhen(rows[i + 1]!.text) : null;
    if (rows[i + 1]) return next ? startOf(next) : null;
    const e = readEnd();
    return e ? endDay(e) : null;
  };
  const insert = (at: number, start: When) => {
    rows.splice(at, 0, { era: { id: newId(), title: t('eras', 'New era'), start, color: colorBeside(at) }, text: whenText(start, lang) });
    render(at);
  };
  const split = (i: number) => {
    const start = parseWhen(rows[i]!.text);
    const until = endOfRow(i);
    if (!start || until === null) return refresh();
    const middle = snapTo((startOf(start) + until) / 2, { y: 0, ...(start.m !== undefined ? { m: 1 } : {}), ...(start.d !== undefined ? { d: 1 } : {}) });
    // Too short to halve at its precision: halve it by days.
    insert(i + 1, startOf(middle) > startOf(start) ? middle : snapTo((startOf(start) + until) / 2, { y: 0, m: 1, d: 1 }));
  };
  const remove = (i: number) => {
    rows.splice(i, 1);
    render();
  };
  /** At the end: after the last era, as long as it — or, when the list runs to today, in the second half of the last. */
  const append = () => {
    if (!rows.length) {
      const [lo, hi] = extentOf(doc);
      const start = snapTo(lo, { y: 0 });
      if (!doc.end) {
        endMode.value = 'date';
        endText.value = whenText(snapTo(hi - 1, { y: 0 }), lang);
      } else if (isNow(doc.end)) endMode.value = 'now';
      return insert(0, start);
    }
    const last = rows.length - 1;
    const e = readEnd();
    const start = parseWhen(rows[last]!.text);
    if (!e || !start) return refresh();
    if (isNow(e)) return split(last);
    const after = snapTo(endDay(e), e);
    const length = endDay(e) - startOf(start);
    endText.value = whenText(snapTo(endDay(e) + length - 1, e), lang);
    insert(rows.length, after);
  };

  endMode.addEventListener('change', () => {
    if (endMode.value === 'date' && !endText.value) endText.value = whenText(snapTo(todayDay(), { y: 0 }), lang);
    refresh();
  });
  endText.addEventListener('input', refresh);

  const palette = h('datalist', { id: 'era-palette' }, ...PALETTE.map((c) => h('option', { value: c })));
  const body = h(
    'div',
    { class: 'editor eras-editor' },
    h('p', { class: 'field-hint' }, t('eras', 'Eras follow one another: each begins where the one above it ends, so they never overlap. A row without a name is a gap.')),
    empty,
    listEl,
    h('button', { class: 'text-button era-add', type: 'button', onclick: append }, icon(...PLUS), t('eras', 'Add an era at the end')),
    endField,
    palette,
    error,
  );
  render();

  /** After saving, the era to open in the item editor. */
  let then: string | null = null;
  const details = (row: Row) => {
    then = row.era.id ?? null;
    body.closest('dialog')?.querySelector<HTMLButtonElement>('.button--primary')?.click();
  };

  let changes: Change[] = [];
  const check = (value: string): boolean => {
    if (value !== 'save') {
      then = null;
      return true;
    }
    /** Says what is wrong, naming the first era it is wrong with, and takes the reader to it: in view, its date in hand. */
    const fail = (message: string, at: number | 'end') => {
      error.textContent = message;
      error.hidden = false;
      then = null;
      refresh();
      // The row the list was opened at gives way to the one that needs the reader now.
      listEl.querySelector('.era-row--focus')?.classList.remove('era-row--focus');
      const input = at === 'end' ? endText : listEl.children[at]?.querySelector<HTMLInputElement>('.era-date');
      input?.closest('.era-row, .era-end')?.scrollIntoView({ block: 'center' });
      input?.focus();
      input?.select();
      return false;
    };
    const named = (i: number) => rows[i]!.era.title || t('eras', 'A gap');
    const starts = rows.map((r) => parseWhen(r.text));
    const typedEnd = readEnd();
    const notDate = starts.findIndex((s) => !s);
    if (notDate >= 0) return fail(t('eras', '“{title}”: its beginning is not a date yet.', { title: named(notDate) }), notDate);
    if (rows.length && !typedEnd) return fail(t('eras', 'The end of the last era is not a date yet.'), 'end');
    const eraList = { rows: rows.map((r, i) => ({ ...r.era, start: starts[i]! })), end: typedEnd ?? { now: true } };
    const [first] = checkEras(eraList);
    if (first?.problem === 'order') return fail(t('eras', 'The eras are not in time order: “{title}” begins no later than the era above it.', { title: named(first.row) }), first.row);
    if (first) return fail(t('eras', 'The last era ends before it begins.'), 'end');
    const written = writeEras(eraList, doc.items);
    changes = [];
    for (const era of written) {
      const old = doc.items.find((i) => i.id === era.id);
      if (!old || JSON.stringify(old) !== JSON.stringify(era)) changes.push(itemChange(doc, era.id, era));
    }
    for (const old of doc.items) if (old.kind === 'era' && !written.some((e) => e.id === old.id)) changes.push(itemChange(doc, old.id, undefined));
    return true;
  };

  const shown = dialog({
    title: t('eras', 'Eras'),
    body,
    buttons: [
      { label: t('ui', 'Cancel'), value: 'cancel' },
      { label: t('eras', 'Save'), value: 'save', primary: true },
    ],
    className: 'dialog--editor dialog--eras',
    check,
  });
  // The era clicked on the strip: its row, ready to edit.
  const at = focusId ? rows.findIndex((r) => r.era.id === focusId) : -1;
  if (at >= 0) {
    const li = listEl.children[at] as HTMLElement;
    li.classList.add('era-row--focus');
    li.scrollIntoView({ block: 'center' });
    li.querySelector<HTMLInputElement>('.era-name')?.focus();
  }
  const answer = await shown;
  if (answer !== 'save' || app.session !== session) return;
  session.history.run({ label: t('eras', 'Change the eras'), changes });
  const open = then && doc.items.find((i) => i.id === then);
  if (open) await openEditor(open);
}

export function setupEras(): void {
  byId('edit-eras').addEventListener('click', () => void openEras());
  // In edit mode an era opens the list, at its row.
  on('open', (id) => {
    if (!app.editing) return;
    const item = app.session?.doc.items.find((i) => i.id === id);
    if (item?.kind === 'era') void openEras(item.id);
  });
}
