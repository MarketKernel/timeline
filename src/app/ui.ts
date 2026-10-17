/**
 * The page's own toasts, menus and dialogs — never alert() or confirm().
 * Toasts go to a live region; dialogs are <dialog> elements, modal, closed by
 * Esc; on a phone they become bottom sheets (CSS).
 */

import { t } from '../core/i18n';
import { byId, h } from './dom';

export interface ToastOptions {
  /** A button in the toast: "Undo", "Details". */
  action?: { label: string; run: () => void };
  /** ms; 0 keeps it until closed. */
  duration?: number;
  kind?: 'info' | 'error';
}

export function toast(message: string, options: ToastOptions = {}): () => void {
  const box = byId('toasts');
  const close = () => {
    el.classList.add('toast--leaving');
    setTimeout(() => el.remove(), 200);
  };
  const el = h(
    'div',
    { class: `toast${options.kind === 'error' ? ' toast--error' : ''}` },
    h('span', { class: 'toast-text' }, message),
    options.action
      ? h('button', {
          class: 'toast-action',
          type: 'button',
          onclick: () => {
            options.action!.run();
            close();
          },
          text: options.action.label,
        })
      : null,
    h('button', { class: 'toast-close', type: 'button', 'aria-label': t('ui', 'Dismiss'), onclick: close, text: '×' }),
  );
  box.append(el);
  while (box.children.length > 4) box.firstElementChild?.remove();
  const duration = options.duration ?? (options.action ? 8000 : 4000);
  if (duration) setTimeout(close, duration);
  return close;
}

export interface MenuItem {
  label: string;
  run?: () => void;
  /** A checkbox item. */
  checked?: boolean;
  hint?: string;
  disabled?: boolean;
  /** A separator before this item. */
  separator?: boolean;
  /** Keeps the menu open after running (checkbox lists). */
  keepOpen?: boolean;
}

let openMenu: { el: HTMLElement; close: () => void } | null = null;

/** A popup menu under `anchor`. Arrow keys move, Esc closes, a click outside closes. */
export function menu(anchor: HTMLElement, items: (MenuItem | HTMLElement)[], className = ''): () => void {
  openMenu?.close();
  const list = h('div', { class: `menu ${className}`, role: 'menu' });
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    if (item instanceof HTMLElement) {
      list.append(item);
      continue;
    }
    if (item.separator) list.append(h('div', { class: 'menu-separator', role: 'separator' }));
    const button = h(
      'button',
      {
        class: 'menu-item',
        type: 'button',
        role: item.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
        'aria-checked': item.checked === undefined ? undefined : String(item.checked),
        disabled: item.disabled,
      },
      item.checked !== undefined ? h('span', { class: 'menu-check', 'aria-hidden': 'true' }, item.checked ? '✓' : '') : null,
      h('span', { class: 'menu-label' }, item.label),
      item.hint ? h('span', { class: 'menu-hint' }, item.hint) : null,
    );
    button.addEventListener('click', () => {
      if (!item.keepOpen) close();
      item.run?.();
      if (item.keepOpen && item.checked !== undefined) {
        item.checked = !item.checked;
        button.setAttribute('aria-checked', String(item.checked));
        button.querySelector('.menu-check')!.textContent = item.checked ? '✓' : '';
      }
    });
    buttons.push(button);
    list.append(button);
  }
  document.body.append(list);
  const rect = anchor.getBoundingClientRect();
  const width = list.offsetWidth;
  list.style.top = `${Math.round(rect.bottom + 4)}px`;
  list.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)))}px`;
  anchor.setAttribute('aria-expanded', 'true');

  const onKey = (event: KeyboardEvent) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      anchor.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = buttons[(i + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
      next?.focus();
    }
  };
  const onDown = (event: PointerEvent) => {
    if (!list.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
  };
  function close() {
    list.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    if (openMenu?.el === list) openMenu = null;
  }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  openMenu = { el: list, close };
  (buttons.find((b) => !b.disabled) ?? list).focus?.();
  return close;
}

export const closeMenus = (): void => openMenu?.close();

let dialogs = 0;

/**
 * A modal dialog with a title, a body and buttons. Resolves with the value of
 * the button pressed, or null on Esc / close.
 */
export function dialog<T extends string>(options: {
  title: string;
  body?: Node | string;
  buttons: { label: string; value: T; primary?: boolean; danger?: boolean }[];
  className?: string;
  /** Called before closing with the value; return false to stay open (a form with errors). */
  check?: (value: T) => boolean;
}): Promise<T | null> {
  return new Promise((resolve) => {
    // Dialogs open over each other (the editor's confirm, the library over the settings): each names its own title.
    const titleId = `dialog-title-${++dialogs}`;
    const el = h('dialog', { class: `dialog ${options.className ?? ''}`, 'aria-labelledby': titleId });
    const form = h('form', { method: 'dialog', class: 'dialog-form' });
    form.append(
      h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
      h('h2', { id: titleId, class: 'dialog-title' }, options.title),
      typeof options.body === 'string' ? h('p', { class: 'dialog-text' }, options.body) : (options.body ?? ''),
      h(
        'div',
        { class: 'dialog-buttons' },
        ...options.buttons.map((b) =>
          // Only the primary button validates the form: Cancel and Delete always work.
          h('button', { class: `button${b.primary ? ' button--primary' : ''}${b.danger ? ' button--danger' : ''}`, value: b.value, type: 'submit', formnovalidate: !b.primary }, b.label),
        ),
      ),
    );
    el.append(form);
    document.body.append(el);
    let result: T | null = null;
    form.addEventListener('submit', (event) => {
      const value = ((event as SubmitEvent).submitter as HTMLButtonElement | null)?.value as T | undefined;
      if (value !== undefined && options.check && !options.check(value)) {
        event.preventDefault();
        return;
      }
      result = value ?? null;
    });
    el.addEventListener('close', () => {
      el.remove();
      resolve(result);
    });
    // Enter in a field means the primary button — not the first one in the row, which may be Delete.
    form.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (event.key !== 'Enter' || event.isComposing || !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      event.preventDefault();
      form.querySelector<HTMLButtonElement>('.button--primary')?.click();
    });
    // A click on the backdrop closes — when it began there too, not a text selection released over it.
    let downOnBackdrop = false;
    el.addEventListener('pointerdown', (event) => (downOnBackdrop = event.target === el));
    el.addEventListener('click', (event) => {
      if (event.target === el && downOnBackdrop) el.close();
      downOnBackdrop = false;
    });
    el.showModal();
    const first = el.querySelector<HTMLElement>('[autofocus]') ?? el.querySelector<HTMLElement>('input, textarea, select') ?? el.querySelector<HTMLElement>('.button--primary');
    first?.focus();
  });
}

/** Yes/no: true when the primary button was pressed. */
export async function confirmDialog(title: string, text: string, yes: string, no = t('ui', 'Cancel'), danger = false): Promise<boolean> {
  return (await dialog({ title, body: text, buttons: [{ label: no, value: 'no' }, { label: yes, value: 'yes', primary: !danger, danger }] })) === 'yes';
}
