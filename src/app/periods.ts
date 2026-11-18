/**
 * The list of periods: every period of the timeline, in time order, each with
 * an eye that puts it out of sight or brings it back — a click, no dialog, the
 * strip follows at once. The shown ones come first; the hidden ones have a
 * section of their own, where a period is shown again.
 *
 * Hiding is kept in the file (`"hidden": true` on the period) and is an edit
 * like any other: one command on the undo stack, ⌘/Ctrl Z brings it back. An
 * event goes out of sight once every period it is attached to is hidden,
 * unless the reader keeps them (a setting of the reader's, at the foot of the list).
 *
 * Beside the strip on the left on a desktop, a bottom sheet on a phone; the
 * toolbar button or P opens and closes it.
 */

import { itemChange, type Change } from '../core/commands';
import { formatRange } from '../core/dates';
import { t, tn } from '../core/i18n';
import { colorOf, inTimeOrder, type Item } from '../core/model';
import { normalize } from '../core/search';
import { byId, h, icon, isNarrow, isTyping, shape } from './dom';
import { select } from './reading';
import type { Settings } from './settings';
import { app, on } from './state';

const EYE = (): SVGSVGElement => icon('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', shape('circle', { cx: 12, cy: 12, r: 3 }));
const EYE_SHUT = (): SVGSVGElement => icon('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M4 4l16 16');

let panel: HTMLElement;
let lists: HTMLElement;
let filter: HTMLInputElement;
let filterBox: HTMLElement;
let keepBox: HTMLInputElement;
let foot: HTMLElement;
let query = '';

/** Hides or shows periods: one command, whatever their number. */
export function setHidden(periods: readonly Item[], hidden: boolean): void {
  const session = app.session;
  if (!session) return;
  const doc = session.doc;
  const changes: Change[] = [];
  let only: Item | null = null;
  for (const period of periods) {
    if (period.kind !== 'period' || !!period.hidden === hidden) continue;
    const next: Item = { ...period };
    if (hidden) next.hidden = true;
    else delete next.hidden;
    changes.push(itemChange(doc, period.id, next));
    only = period;
  }
  if (!changes.length) return;
  const label =
    changes.length === 1 && only
      ? hidden
        ? t('periods', 'Hide {title}', { title: only.title })
        : t('periods', 'Show {title}', { title: only.title })
      : hidden
        ? tn('periods', 'Hide {count} period', 'Hide {count} periods', changes.length)
        : tn('periods', 'Show {count} period', 'Show {count} periods', changes.length);
  session.history.run({ label, changes });
}

/** Brings a period on screen and selects it; on a phone the list gives way to its details. */
function goTo(id: string): void {
  const found = app.session?.doc.items.find((i) => i.id === id);
  if (!found) return;
  if (isNarrow()) close();
  app.strip.reveal(found);
  select(found.id);
}

function row(period: Item, events: number): HTMLElement {
  const doc = app.session!.doc;
  const title = period.title;
  const meta = [formatRange(period.start, period.end), events ? tn('periods', '{count} event', '{count} events', events) : ''].filter(Boolean).join(' · ');
  const hidden = !!period.hidden;
  const toggleLabel = hidden ? t('periods', 'Show “{title}”', { title }) : t('periods', 'Hide “{title}”', { title });
  // A shown period's name goes to it; a hidden one's shows it again and goes to it.
  const name = h(
    'button',
    {
      class: 'period-name',
      type: 'button',
      title: hidden ? t('periods', 'Show it and go to it') : t('periods', 'Go to it'),
      onclick: () => {
        if (hidden) setHidden([period], false);
        goTo(period.id);
      },
    },
    h('span', { class: 'period-title', lang: doc.lang }, title),
    h('span', { class: 'period-meta' }, meta),
  );
  return h(
    'li',
    {
      class: `period-row${hidden ? ' period-row--hidden' : ''}${app.strip.selected === period.id ? ' period-row--selected' : ''}`,
      'data-period': period.id,
      style: `--cat:${colorOf(period, doc)}`,
    },
    h('span', { class: 'period-swatch', 'aria-hidden': 'true' }),
    name,
    h(
      'button',
      {
        class: 'icon-button period-eye',
        type: 'button',
        title: toggleLabel,
        'aria-label': toggleLabel,
        onclick: () => setHidden([period], !hidden),
      },
      hidden ? EYE_SHUT() : EYE(),
    ),
  );
}

function section(kind: 'shown' | 'hidden', title: string, periods: Item[], counts: Map<string, number>, empty: string, all: () => void, allLabel: string): HTMLElement {
  return h(
    'section',
    { class: `periods-section periods-section--${kind}`, 'aria-label': title },
    h(
      'div',
      { class: 'periods-section-head' },
      h('h3', { class: 'periods-section-title' }, title, h('span', { class: 'periods-count' }, String(periods.length))),
      periods.length > 1 ? h('button', { class: 'text-button periods-all', type: 'button', onclick: all }, allLabel) : null,
    ),
    periods.length ? h('ul', { class: 'period-list' }, ...periods.map((p) => row(p, counts.get(p.id) ?? 0))) : h('p', { class: 'periods-empty' }, empty),
  );
}

/** Marks the selected period's row, without drawing the list again. */
function markSelected(): void {
  for (const li of lists.querySelectorAll<HTMLElement>('[data-period]')) li.classList.toggle('period-row--selected', li.dataset.period === app.strip.selected);
}

/** Draws the lists again: after an edit, an undo, a filter typed, a language picked. */
function render(): void {
  const session = app.session;
  if (!session || panel.hidden) return;
  // A period hidden or shown from the keyboard keeps the focus: on its row, now in the other section.
  // With the mouse the list stays where it was, so that one period after another is hidden in a row.
  const scroller = byId('periods-body');
  const scrolled = scroller.scrollTop;
  const active = document.activeElement as HTMLElement | null;
  const focusedRow = active && panel.contains(active) && active.matches(':focus-visible') ? active.closest<HTMLElement>('[data-period]') : null;
  const focusedPart = active?.classList.contains('period-eye') ? '.period-eye' : '.period-name';
  const refocus = () => {
    scroller.scrollTop = scrolled;
    if (!focusedRow) return;
    const again = lists.querySelector<HTMLElement>(`[data-period="${CSS.escape(focusedRow.dataset.period ?? '')}"] ${focusedPart}`);
    (again ?? byId('periods-close')).focus();
  };
  const doc = session.doc;
  const periods = inTimeOrder(doc.items.filter((i) => i.kind === 'period'));
  keepBox.checked = !app.settings.hidePeriodEvents;
  filterBox.hidden = periods.length < 7;
  foot.hidden = !periods.length;
  if (!periods.length) {
    lists.replaceChildren(h('p', { class: 'periods-empty' }, t('periods', 'This timeline has no periods yet. In edit mode, Period on the edit bar adds one: drag along the strip from its start to its end.')));
    refocus();
    return;
  }
  const counts = new Map<string, number>();
  for (const item of doc.items) if (item.kind === 'event') for (const id of item.periods ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const wanted = filterBox.hidden ? '' : normalize(query.trim());
  const found = wanted ? periods.filter((p) => normalize(p.title).includes(wanted)) : periods;
  const shown = found.filter((p) => !p.hidden);
  const hidden = found.filter((p) => p.hidden);
  lists.replaceChildren(
    section(
      'shown',
      t('periods', 'Shown'),
      shown,
      counts,
      wanted ? t('periods', 'No shown period has this in its name.') : t('periods', 'Every period is hidden.'),
      () => setHidden(shown, true),
      wanted ? t('periods', 'Hide these') : t('periods', 'Hide all'),
    ),
    section(
      'hidden',
      t('periods', 'Hidden'),
      hidden,
      counts,
      wanted ? t('periods', 'No hidden period has this in its name.') : t('periods', 'None. The eye beside a period hides it; it waits here to be shown again.'),
      () => setHidden(hidden, false),
      wanted ? t('periods', 'Show these') : t('periods', 'Show all'),
    ),
  );
  refocus();
}

/** The strip leaves the panel's side free when it brings an item on screen. */
function cover(): void {
  app.strip.coveredLeft = !panel.hidden && !isNarrow() ? panel.offsetWidth + 16 : 0;
}

export function open(): void {
  if (!app.session) return;
  panel.hidden = false;
  byId('periods-button').setAttribute('aria-pressed', 'true');
  document.body.classList.add('periods-open');
  // On a phone the two sheets are one at a time.
  if (isNarrow()) select(null);
  render();
  cover();
}

export function close(): void {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  byId('periods-button').setAttribute('aria-pressed', 'false');
  document.body.classList.remove('periods-open');
  cover();
}

export const toggle = (): void => (panel.hidden ? open() : close());

/** `change` saves a reader's setting (main.ts owns them). */
export function setupPeriods(change: (next: Partial<Settings>) => void): void {
  panel = byId('periods');
  lists = h('div', { class: 'periods-lists' });
  filter = h('input', { class: 'field-input periods-filter', type: 'search', placeholder: t('periods', 'Find a period'), 'aria-label': t('periods', 'Find a period'), autocomplete: 'off', spellcheck: 'false' });
  filter.addEventListener('input', () => {
    query = filter.value;
    render();
  });
  filterBox = h('div', { class: 'periods-filter-box' }, filter);
  keepBox = h('input', { type: 'checkbox', id: 'periods-keep-events' });
  keepBox.addEventListener('change', () => change({ hidePeriodEvents: !keepBox.checked }));
  foot = h(
    'label',
    { class: 'toggle periods-foot' },
    keepBox,
    h('span', {}, h('span', { class: 'toggle-label' }, t('periods', 'Keep the events of hidden periods')), h('span', { class: 'toggle-hint' }, t('periods', 'Otherwise an event is hidden once every period it is attached to is.'))),
  );
  byId('periods-body').replaceChildren(filterBox, lists, foot);

  byId('periods-button').addEventListener('click', toggle);
  byId('periods-close').addEventListener('click', () => {
    close();
    byId('periods-button').focus();
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    // Esc in the filter empties it first.
    if (event.target === filter && filter.value) {
      filter.value = query = '';
      render();
      return;
    }
    close();
    byId('periods-button').focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'p' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!app.session || byId('app').hidden || isTyping(event.target) || document.querySelector('dialog[open]') || document.querySelector('.menu')) return;
    event.preventDefault();
    toggle();
    if (!panel.hidden) (filterBox.hidden ? panel.querySelector<HTMLElement>('.period-name, .period-eye') : filter)?.focus();
  });
  on('changed', render);
  on('settingsChanged', render);
  on('language', () => {
    filter.placeholder = t('periods', 'Find a period');
    filter.setAttribute('aria-label', t('periods', 'Find a period'));
    foot.querySelector('.toggle-label')!.textContent = t('periods', 'Keep the events of hidden periods');
    foot.querySelector('.toggle-hint')!.textContent = t('periods', 'Otherwise an event is hidden once every period it is attached to is.');
    render();
  });
  // Another file is another list: the filter goes, the panel stays as the reader left it.
  on('opened', () => {
    filter.value = query = '';
    render();
  });
  on('closed', () => close());
  // The row of hidden periods under the bars: the list opens at its hidden section.
  on('periods', () => {
    open();
    const hiddenSection = lists.querySelector<HTMLElement>('.periods-section--hidden');
    if (!hiddenSection) return;
    const scroller = byId('periods-body');
    scroller.scrollTop += hiddenSection.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    hiddenSection.querySelector<HTMLElement>('.period-name')?.focus({ preventScroll: true });
  });
  // The selected period is marked in the list.
  on('selected', markSelected);
  window.addEventListener('resize', cover);
}
