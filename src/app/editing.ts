/**
 * Edit mode on the strip (Task §6, §7).
 *
 * Edit mode is a toggle; outside it nothing moves by accident. In it:
 * - the edit bar adds: pick Event or Period, then click on the strip (an
 *   event) or drag from start to end (a period) where it belongs; eras have
 *   their own editor, a list (eras.ts), so they tile and never overlap;
 * - drag a card anywhere to move it: its date and its dot stay, a line joins
 *   them, and the date is changed only in the card's window; drag its corner
 *   to make it larger or smaller;
 * - drag a bar up or down to another row; a period's dates, like an event's,
 *   are set in its window;
 * - drag the boundary between two eras: both neighbours follow, and an edge
 *   alone stops at the next era's;
 * - long-press (touch) or N to add an event, Delete to remove one (with undo);
 * - drop photos on the strip: one event per photo, at the date it was taken;
 *   on an item, they join its gallery.
 * The editor dialog (editor.ts) edits everything else. Every change is one
 * command on the undo stack — a whole drag included.
 */

import { itemChange, imageChange, fieldChange, type Change } from '../core/commands';
import { endDay, formatDuration, formatRange, formatWhen, isNow, shiftWhen, snapTo, startOf, type When } from '../core/dates';
import { shortId } from '../core/hash';
import { t, tn } from '../core/i18n';
import { MAX_SHIFT, picturesOf, spanOf, type CardSize, type Item, type ItemKind } from '../core/model';
import { byId, h, isMac, isNarrow, isTouch, isTyping, swallowClick, trackPointer } from './dom';
import { deleteItem, openEditor, SIZE_OPTIONS, sizeLabel, whenAt } from './editor';
import { encodeImage } from './images';
import { focusItem, select } from './reading';
import { app, emit, on } from './state';
import { confirmDialog, toast } from './ui';
import { CARD_SIZES, discOf, ROW } from './view';

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
  if (placing && isNarrow()) {
    return placing.kind === 'event' ? t('editbar', 'Tap where it happened.') : t('editbar', 'Drag from its start to its end.');
  }
  switch (placing?.kind) {
    case 'event':
      return t('editbar', 'Click on the strip where the event happened.');
    case 'period':
      return t('editbar', 'Drag along the strip from the start of the period to its end.');
    default:
      return isTouch()
        ? t('editbar', 'Drag cards and bars to move them — their dates stay. Long-press to add an event.')
        : t('editbar', 'Drag cards anywhere and bars up or down — their dates stay; a card’s corner resizes it. Drop photos on the strip.');
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
    swallowClick();
    arm(null);
    void openEditor(null, defaults);
  };
  trackPointer(strip.root, move, up);
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
    let mode: 'move' | 'boundary-left' | 'boundary-right' = 'move';
    if (item.kind === 'era') {
      if (localX < 7) mode = 'boundary-left';
      else if (box.width - localX < 7) mode = 'boundary-right';
      else return false; // the middle of an era pans, as everywhere
    }
    const px = strip.view.pxPerDay;
    const x0 = event.clientX;
    const y0 = event.clientY;
    let moved = false;
    const placed = strip.placed.get(item.id);
    // An event's date is set in its window, never by a drag: its dot stays put, and only a card moves.
    if (item.kind === 'event' && (!placed || placed.mode === 'dot')) return false;
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
      document.body.classList.add('dragging');
      const days = dx / px;
      next = [];
      let text = '';
      if (item.kind === 'event' && placed) {
        // The card goes anywhere, its row snapped as it goes; its dot, its date and the line to it stay.
        const lane = Math.max(0, placed.row - Math.round(dy / ROW));
        const shift = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, (item.shift ?? 0) + Math.round(dx)));
        const changed: Item = { ...item, lane, shift };
        if (!shift) delete changed.shift;
        next = lane === item.lane && changed.shift === item.shift ? [] : [itemChange(doc, item.id, changed)];
        text = `${formatWhen(item.start)} · ${t('editor', 'Row {n}', { n: lane + 1 })}`;
        target.style.transform = `translate(${shift - (item.shift ?? 0)}px, ${(placed.row - lane) * ROW}px)`;
        strip.leanPointer(item.id, shift, lane);
        label = t('editor', 'Move {title}', { title: item.title });
      } else if (item.kind === 'period') {
        // A bar moves only up or down, to another row — one past the last row starts a new one. Its dates are set in its window.
        const slot = strip.barSlotAt(e.clientY);
        if (!slot) return;
        next = slot.row === strip.barRowOf(item.id) ? [] : [itemChange(doc, item.id, { ...item, lane: slot.row })];
        text = `${formatRange(item.start, item.end)} · ${t('editor', 'Row {n}', { n: slot.row + 1 })}`;
        target.style.transform = `translateY(${slot.y - parseFloat(target.style.top || '0')}px)`;
        label = t('editor', 'Move {title}', { title: item.title });
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
      document.body.classList.remove('dragging');
      clearTip();
      target.style.transform = '';
      target.style.width = '';
      target.style.boxShadow = '';
      if (moved) swallowClick();
      if (moved && next.length) run(label, next);
      else if (moved) strip.refresh();
    };
    trackPointer(target, move, up);
    return true;
  };
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
  trackPointer(card, move, up);
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
      let encoded;
      try {
        encoded = await encodeImage(file);
      } catch (error) {
        // One picture that cannot be read is skipped, as in the editor: the others still come in.
        toast(t('editor', 'This picture could not be read: {error}', { error: (error as Error).message }), { kind: 'error' });
        continue;
      }
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
  if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
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
  on('anchor', (id) => void makeAnchor(id));
  document.addEventListener('keydown', onKey);
  setupEditBar();
  setupDragging();
  setupLongPress();
  setupDrops();
}
