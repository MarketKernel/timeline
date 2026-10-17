/**
 * Reading a timeline (Task §5): selecting and the details panel, search,
 * and the keyboard for items — Tab through them in time order, Enter for
 * details, Esc to step back out.
 */

import { t } from '../core/i18n';
import { inTimeOrder, itemDay, type Item } from '../core/model';
import { byId, isNarrow, isTyping } from './dom';
import { Details } from './details';
import { SearchBar } from './search';
import { app, emit, on } from './state';

let details: Details;
let searchBar: SearchBar;

const item = (id: string | null): Item | undefined => (id ? app.session?.doc.items.find((i) => i.id === id) : undefined);

/** Selects an item (or nothing): the ink ring, the details panel, a period's age on the second ruler. */
export function select(id: string | null, focusPanel = false, reveal = true): void {
  const strip = app.strip;
  const found = item(id);
  strip.selected = found?.id ?? null;
  strip.tempAnchor = found?.kind === 'period' ? { at: found.start, label: t('strip', 'Age: {name}', { name: found.title }) } : null;
  strip.restyle();
  if (found && app.session) {
    details.show(app.session.doc, found, app.session.store, focusPanel);
    // On a desktop the panel stands over the strip's right side: keep the item clear of it.
    const wide = !isNarrow();
    strip.coveredRight = wide ? details.panel.offsetWidth + 16 : 0;
    if (wide && reveal) strip.reveal(found);
  } else {
    details.hide();
    strip.coveredRight = 0;
  }
}

/** The document's items in time order, sorted once a change: the panel's previous and next, and Tab, walk it. */
let ordered: Item[] | null = null;
const inOrder = (): Item[] => (ordered ??= inTimeOrder(app.session?.doc.items ?? []));

/** Items a reader can reach: what the strip shows, in time order. */
function reachable(): Item[] {
  return inOrder().filter((i) => app.strip.visibleItem(i));
}

/** Puts keyboard focus on an item, bringing it onto the strip first. */
export function focusItem(target: Item): void {
  const strip = app.strip;
  strip.reveal(target, false);
  strip.build();
  const el = strip.elementOf(target.id);
  el?.focus({ preventScroll: true });
}

function onKey(event: KeyboardEvent): void {
  if (!app.session || byId('app').hidden || document.querySelector('dialog[open]') || document.querySelector('.menu')) return;
  if (event.key === 'Escape') {
    if (app.strip.clearMeasure()) return event.preventDefault();
    if (searchBar.open) return (searchBar.close(), event.preventDefault());
    if (details.open) {
      const id = details.current;
      select(null);
      if (id) app.strip.elementOf(id)?.focus({ preventScroll: true });
      return event.preventDefault();
    }
    return;
  }
  if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === '/') {
    event.preventDefault();
    searchBar.show();
    return;
  }
  if (event.key === 'Tab') {
    // Inside the toolbar, the search bar and the panel, Tab is the browser's.
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.closest('.toolbar') || active.closest('.search') || active.closest('.details'))) return;
    const list = reachable();
    if (!list.length) return;
    const currentId = active?.closest<HTMLElement>('[data-id]')?.dataset.id ?? app.strip.selected;
    const at = list.findIndex((i) => i.id === currentId);
    const next = at < 0 ? (event.shiftKey ? list.length - 1 : firstOnScreen(list)) : at + (event.shiftKey ? -1 : 1);
    if (next < 0 || next >= list.length) return;
    event.preventDefault();
    focusItem(list[next]!);
  }
}

/** The first item at or after the left edge of the screen: where Tab starts. */
function firstOnScreen(list: Item[]): number {
  const left = app.strip.dayAt(0);
  const i = list.findIndex((x) => itemDay(x) >= left);
  return i < 0 ? 0 : i;
}

export function setupReading(): void {
  details = new Details({
    show: (id) => {
      const found = item(id);
      if (!found) return;
      app.strip.reveal(found);
      select(id);
    },
    edit: (id) => emit('open', id),
    anchor: (id) => emit('anchor', id),
    close: () => select(null),
    editing: () => app.editing,
    ordered: inOrder,
  });
  searchBar = new SearchBar({
    items: () => app.session?.doc.items ?? [],
    reveal: (id) => {
      const found = item(id);
      if (!found) return;
      app.strip.reveal(found);
      select(id);
    },
    open: (id) => select(id, true),
    highlight: (ids) => {
      app.strip.highlight = ids;
      app.strip.restyle();
    },
  });
  on('select', (id) => select(id));
  on('open', (id) => {
    if (!app.editing) select(id, true);
  });
  on('closed', () => {
    ordered = null;
    details.hide();
    searchBar.close();
  });
  on('opened', () => (ordered = null));
  on('changed', () => {
    ordered = null;
    // An edit can change or remove what the panel shows.
    const id = details.current;
    if (!id) return;
    // Refreshed in place: an edit elsewhere must not pull the strip to this item.
    if (item(id)) select(id, false, false);
    else select(null);
  });
  on('language', () => {
    if (details.current) select(details.current, false, false);
  });
  byId('search-button').addEventListener('click', () => (searchBar.open ? searchBar.close() : searchBar.show()));
  document.addEventListener('keydown', onKey);
}
