/**
 * The search bar (Task §5.3): `/` opens it, typing filters, ↑↓ walk the hits —
 * each one brought onto the strip — Enter opens the current one, Esc closes.
 * While a query is typed, everything that does not match is faded.
 */

import { formatRange, formatWhen } from '../core/dates';
import { tn } from '../core/i18n';
import { search, type Hit } from '../core/search';
import { byId, h } from './dom';

export interface SearchHandlers {
  items(): import('../core/model').Item[];
  /** Brings a hit onto the strip and selects it. */
  reveal(id: string): void;
  open(id: string): void;
  highlight(ids: Set<string> | null): void;
}

export class SearchBar {
  private readonly form = byId<HTMLFormElement>('search');
  private readonly input = byId<HTMLInputElement>('search-input');
  private readonly list = byId<HTMLOListElement>('search-results');
  private readonly count = byId('search-count');
  private hits: Hit[] = [];
  private index = -1;
  private timer = 0;

  constructor(private readonly handlers: SearchHandlers) {
    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.run(), 80);
    });
    this.input.addEventListener('keydown', (event) => this.onKey(event));
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const hit = this.hits[Math.max(0, this.index)];
      if (hit) {
        this.handlers.reveal(hit.item.id);
        this.handlers.open(hit.item.id);
        this.list.hidden = true;
      }
    });
    byId('search-close').addEventListener('click', () => this.close());
    this.input.addEventListener('focus', () => {
      if (this.hits.length) this.list.hidden = false;
    });
  }

  get open(): boolean {
    return !this.form.hidden;
  }

  show(): void {
    this.form.hidden = false;
    this.input.focus();
    this.input.select();
    if (this.input.value) this.run();
  }

  close(): void {
    this.form.hidden = true;
    this.list.hidden = true;
    this.input.value = '';
    this.hits = [];
    this.count.textContent = '';
    this.handlers.highlight(null);
  }

  private run(): void {
    const query = this.input.value.trim();
    this.hits = query ? search(this.handlers.items(), query) : [];
    this.index = -1;
    this.count.textContent = query ? tn('search', '{count} found', '{count} found', this.hits.length) : '';
    this.handlers.highlight(query ? new Set(this.hits.map((hit) => hit.item.id)) : null);
    this.list.replaceChildren(
      ...this.hits.slice(0, 50).map((hit, i) =>
        h(
          'li',
          {
            class: 'search-result',
            role: 'option',
            id: `hit-${i}`,
            'aria-selected': 'false',
            onclick: () => {
              this.select(i);
              this.handlers.open(hit.item.id);
              this.list.hidden = true;
            },
          },
          h('span', { class: 'search-result-date' }, hit.item.kind === 'event' ? formatWhen(hit.item.start) : formatRange(hit.item.start, hit.item.end)),
          h('span', { class: 'search-result-title' }, hit.item.title),
          h('span', { class: 'search-result-snippet' }, hit.snippet),
        ),
      ),
    );
    this.list.hidden = !this.hits.length;
  }

  private select(i: number): void {
    this.index = i;
    for (const [j, li] of [...this.list.children].entries()) li.setAttribute('aria-selected', String(j === i));
    const li = this.list.children[i] as HTMLElement | undefined;
    li?.scrollIntoView({ block: 'nearest' });
    this.input.setAttribute('aria-activedescendant', li?.id ?? '');
    const hit = this.hits[i];
    if (hit) this.handlers.reveal(hit.item.id);
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.hits.length) return;
      this.list.hidden = false;
      const n = Math.min(this.hits.length, 50);
      this.select(((this.index < 0 && event.key === 'ArrowUp' ? 0 : this.index) + (event.key === 'ArrowDown' ? 1 : -1) + n) % n);
    }
  }
}
