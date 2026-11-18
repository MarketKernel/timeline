/**
 * The details panel (Task §5.1): beside the strip on a desktop, a bottom sheet
 * on a phone. The large image, or the gallery (gallery.ts), with caption and
 * credit; the date line with "c." and the spread, the title, references, text,
 * links, and "← previous · next →" in time order.
 *
 * It is not modal: the strip stays live behind it, and a click on another item
 * shows that one.
 */

import { formatDuration, formatRange, formatSpread, formatWhen, isNow } from '../core/dates';
import { t, tn } from '../core/i18n';
import { parseMarkdown, type Inline } from '../core/markdown';
import { colorOf, eventsOf, picturesOf, spanOf, type Doc, type Item } from '../core/model';
import { byId, h } from './dom';
import { detailsGallery, type Gallery } from './gallery';
import type { ImageStore } from './images';

export interface DetailsHandlers {
  /** Shows another item (previous / next). */
  show(id: string): void;
  edit(id: string): void;
  /** Makes the item the anchor of the second ruler. */
  anchor(id: string): void;
  /** A new event, attached to this period. */
  addToPeriod(id: string): void;
  close(): void;
  /** Whether edit mode is on: Edit and "count from here" appear only then. */
  editing(): boolean;
  /** Every item in time order. */
  ordered(): readonly Item[];
}

function renderInline(nodes: Inline[]): Node[] {
  return nodes.map((node) => {
    switch (node.kind) {
      case 'text':
        return document.createTextNode(node.text);
      case 'br':
        return h('br');
      case 'em':
        return h('em', {}, ...renderInline(node.children));
      case 'strong':
        return h('strong', {}, ...renderInline(node.children));
      case 'link':
        // Opened by the reader in a new tab, never fetched by the page.
        return h('a', { href: node.href, target: '_blank', rel: 'noopener noreferrer' }, ...renderInline(node.children));
    }
  });
}

function renderText(source: string): Node[] {
  return parseMarkdown(source).map((paragraph) => h('p', {}, ...renderInline(paragraph)));
}

export class Details {
  readonly panel = byId('details');
  private readonly body = byId('details-body');
  current: string | null = null;
  private gallery: Gallery | null = null;

  constructor(private readonly handlers: DetailsHandlers) {
    byId('details-close').addEventListener('click', () => handlers.close());
    this.sheetGestures();
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  hide(): void {
    this.panel.hidden = true;
    this.current = null;
    this.gallery?.dispose();
    this.gallery = null;
    document.body.classList.remove('details-open');
  }

  show(doc: Doc, item: Item, store: ImageStore | null, focus = false): void {
    // The same item again (an edit elsewhere, a save, the language): the reader stays where they were in it.
    const again = this.open && this.current === item.id;
    const scrolled = again ? this.body.scrollTop : 0;
    const shown = again ? this.gallery?.shown : undefined;
    this.current = item.id;
    const parts: Node[] = [];

    this.gallery?.dispose();
    this.gallery = null;
    const pictures = picturesOf(item).filter((hash) => doc.images[hash]);
    if (pictures.length) {
      this.gallery = detailsGallery(doc, pictures, store, shown ? Math.max(0, pictures.indexOf(shown)) : 0);
      parts.push(this.gallery.el);
    }

    // The date line: as precise as stored, "c.", the spread, a period's length.
    const dateParts = [item.kind === 'event' ? formatWhen(item.start) : formatRange(item.start, item.end)];
    const spread = formatSpread(item.start);
    if (spread) dateParts.push(spread);
    if (item.end) {
      const [s, e] = spanOf(item);
      dateParts.push(isNow(item.end) ? t('details', 'to this day') : formatDuration(e - s));
    }
    parts.push(
      h(
        'p',
        { class: 'details-date', style: `--cat:${colorOf(item, doc)}` },
        h('span', { class: 'details-mark', 'aria-hidden': 'true' }),
        dateParts.join(' · '),
      ),
    );
    const lang = doc.lang;
    parts.push(h('h2', { id: 'details-title', class: 'details-title', lang }, item.title));
    if (item.refs) parts.push(h('p', { class: 'details-refs', lang }, item.refs));
    if (item.text) parts.push(h('div', { class: 'details-text', lang }, ...renderText(item.text)));
    if (item.links?.length) {
      parts.push(
        h(
          'ul',
          { class: 'details-links' },
          ...item.links.map((url) => h('li', {}, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')))),
        ),
      );
    }
    // An event's periods, a period's events: each a step to the other.
    const periods = item.kind === 'event' ? doc.items.filter((i) => item.periods?.includes(i.id)) : [];
    if (periods.length) {
      parts.push(
        h(
          'div',
          { class: 'details-period' },
          h('span', { class: 'details-period-label' }, periods.length === 1 ? t('details', 'Period') : t('details', 'Periods')),
          ...periods.map((period) =>
            h(
              'button',
              { class: 'details-period-name details-period-link', type: 'button', lang, style: `--cat:${colorOf(period, doc)}`, onclick: () => this.handlers.show(period.id) },
              h('span', { class: 'details-mark', 'aria-hidden': 'true' }),
              period.title,
            ),
          ),
        ),
      );
    }
    if (item.kind === 'period') {
      const events = eventsOf(doc, item.id);
      if (events.length) {
        parts.push(
          h(
            'section',
            { class: 'details-events', 'aria-label': t('details', 'Events of this period') },
            h('h3', { class: 'details-events-title' }, tn('details', '{count} event in this period', '{count} events in this period', events.length)),
            h(
              'ul',
              { class: 'details-events-list' },
              ...events.map((event) =>
                h(
                  'li',
                  {},
                  h(
                    'button',
                    { class: 'details-event', type: 'button', style: `--cat:${colorOf(event, doc)}`, onclick: () => this.handlers.show(event.id) },
                    h('span', { class: 'details-mark', 'aria-hidden': 'true' }),
                    h('span', { class: 'details-event-date' }, formatWhen(event.start)),
                    h('span', { class: 'details-event-title', lang }, event.title),
                  ),
                ),
              ),
            ),
          ),
        );
      }
    }

    const meta: Node[] = [];
    const kinds = { event: t('details', 'Event'), period: t('details', 'Period'), era: t('details', 'Era') };
    meta.push(h('span', { class: 'chip chip--plain' }, kinds[item.kind]));
    for (const tag of item.tags ?? []) meta.push(h('span', { class: 'chip chip--plain' }, `#${tag}`));
    parts.push(h('div', { class: 'details-meta' }, ...meta));

    // Previous and next in time.
    const sorted = this.handlers.ordered();
    const i = sorted.findIndex((x) => x.id === item.id);
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const nav = h('nav', { class: 'details-nav', 'aria-label': t('details', 'Previous and next') });
    nav.append(
      prev ? h('button', { class: 'details-step', type: 'button', onclick: () => this.handlers.show(prev.id) }, h('span', { 'aria-hidden': 'true' }, '← '), prev.title) : h('span'),
      next ? h('button', { class: 'details-step details-step--next', type: 'button', onclick: () => this.handlers.show(next.id) }, next.title, h('span', { 'aria-hidden': 'true' }, ' →')) : h('span'),
    );
    parts.push(nav);

    const actions = h('div', { class: 'details-actions' });
    if (this.handlers.editing()) {
      actions.append(h('button', { class: 'button', type: 'button', onclick: () => this.handlers.edit(item.id) }, t('details', 'Edit')));
      if (item.kind === 'period') {
        actions.append(h('button', { class: 'text-button', type: 'button', onclick: () => this.handlers.addToPeriod(item.id) }, t('details', 'Add an event to it')));
      }
      if (item.kind === 'period' || item.kind === 'event') {
        actions.append(h('button', { class: 'text-button', type: 'button', onclick: () => this.handlers.anchor(item.id) }, t('details', 'Count years from here')));
      }
    }
    if (actions.childElementCount) parts.push(actions);

    this.body.replaceChildren(...parts);
    this.body.scrollTop = scrolled;
    this.panel.hidden = false;
    document.body.classList.add('details-open');
    if (focus) byId('details-close').focus();
  }

  /** On a phone the sheet is dragged down by its handle to close. */
  private sheetGestures(): void {
    const handle = this.panel.querySelector<HTMLElement>('.sheet-handle');
    if (!handle) return;
    let start: number | null = null;
    handle.addEventListener('pointerdown', (event) => {
      start = event.clientY;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (start === null) return;
      this.panel.style.transform = `translateY(${Math.max(0, event.clientY - start)}px)`;
    });
    const end = (event: PointerEvent) => {
      if (start === null) return;
      const moved = event.clientY - start;
      start = null;
      this.panel.style.transform = '';
      if (moved > 80) this.handlers.close();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
}
