/**
 * Interface languages.
 *
 * The English text stays in the code. A string is looked up by its context —
 * the part of the interface it belongs to — and that English text, in the
 * dictionary of the chosen language, src/locales/<code>.json:
 *
 *   { "context": { "English text": "translation", … }, … }
 *
 * Whatever a dictionary lacks is shown in English. `{name}` is a placeholder.
 * A translation that depends on a number is an object with one text per
 * plural category of the language (Intl.PluralRules: one, few, many, other),
 * keyed by the English plural form. A new language is one more JSON file and
 * one line in LANGUAGES.
 *
 * Content is a separate matter: a .timeline is written in one language (its
 * `lang`), and its texts are shown as they are, whatever the interface speaks.
 */

import ru from '../locales/ru.json';

/** Each named in itself. */
export const LANGUAGES = {
  en: 'English',
  ru: 'Русский',
} as const;

export type Language = keyof typeof LANGUAGES;

type Forms = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Dictionary = Record<string, Record<string, string | Forms>>;

const DICTIONARIES: Partial<Record<Language, Dictionary>> = { ru: ru as Dictionary };

let current: Language = 'en';
let rules = new Intl.PluralRules('en');

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.hasOwn(LANGUAGES, value);
}

/** The first of the browser's languages that has a dictionary; English otherwise. */
export function detectLanguage(preferred: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

export function language(): Language {
  return current;
}

const listeners = new Set<() => void>();

/** Called after every change of language: views that cache text redraw. */
export function onLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLanguage(next: Language): void {
  current = next;
  rules = new Intl.PluralRules(next);
  formats.clear();
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

type Values = Record<string, string | number>;

function fill(text: string, values?: Values): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : match));
}

/** The text in the current language: t("editor", "Delete {title}", { title }). */
export function t(context: string, text: string, values?: Values): string {
  const found = DICTIONARIES[current]?.[context]?.[text];
  return fill(typeof found === 'string' && found ? found : text, values);
}

/**
 * A text with a number in it: tn("files", "{count} item", "{count} items", n).
 * The English plural form is the key; `{count}` is filled in.
 */
export function tn(context: string, one: string, other: string, count: number, values?: Values): string {
  const found = DICTIONARIES[current]?.[context]?.[other];
  const all = { count: count.toLocaleString(current), ...values };
  if (typeof found === 'string' && found) return fill(found, all);
  if (found && typeof found === 'object') {
    const form = found[rules.select(count)] ?? found.other;
    if (form) return fill(form, all);
  }
  return fill(count === 1 ? one : other, all);
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** Dates in the interface language. */
export function dateFormat(options: Intl.DateTimeFormatOptions, lang: string = current): Intl.DateTimeFormat {
  const key = lang + JSON.stringify(options);
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(lang, { timeZone: 'UTC', ...options });
    formats.set(key, format);
  }
  return format;
}

/* ------------------------------------------------------------------ *
 * The page's own markup
 *
 * `data-i18n="context"` translates an element's text. A child marked
 * `data-slot="name"` stays as it is and stands in the text as `{name}`:
 *   <p data-i18n="gate">or drag a <code data-slot="file">.kdbx</code> file here</p>
 * is looked up as "or drag a {file} file here".
 *
 * `data-i18n-attr="context"` translates the element's title, placeholder
 * and aria-label.
 * ------------------------------------------------------------------ */

const ATTRIBUTES = ['title', 'placeholder', 'aria-label'] as const;

interface Source {
  text: string;
  slots: Map<string, Element>;
}

const contents = new WeakMap<Element, Source>();
const attributes = new WeakMap<Element, Partial<Record<(typeof ATTRIBUTES)[number], string>>>();

/** The English text of a `data-i18n` element, as the dictionaries key it. */
export function sourceOf(element: Element): Source {
  let source = contents.get(element);
  if (!source) {
    const slots = new Map<string, Element>();
    let text = '';
    for (const node of Array.from(element.childNodes)) {
      const slot = node instanceof Element ? node.getAttribute('data-slot') : null;
      if (slot && node instanceof Element) {
        slots.set(slot, node);
        text += `{${slot}}`;
      } else text += node.textContent ?? '';
    }
    source = { text: text.replace(/\s+/g, ' ').trim(), slots };
    contents.set(element, source);
  }
  return source;
}

export function translatePage(root: ParentNode = document): void {
  for (const element of Array.from(root.querySelectorAll('[data-i18n]'))) {
    const context = element.getAttribute('data-i18n') ?? '';
    const { text, slots } = sourceOf(element);
    const parts = t(context, text).split(/(\{\w+\})/);
    element.replaceChildren(
      ...parts.filter(Boolean).map((part) => slots.get(part.slice(1, -1)) ?? document.createTextNode(part)),
    );
  }
  for (const element of Array.from(root.querySelectorAll('[data-i18n-attr]'))) {
    const context = element.getAttribute('data-i18n-attr') ?? '';
    let source = attributes.get(element);
    if (!source) {
      source = {};
      for (const name of ATTRIBUTES) {
        const value = element.getAttribute(name);
        if (value) source[name] = value;
      }
      attributes.set(element, source);
    }
    for (const [name, value] of Object.entries(source)) element.setAttribute(name, t(context, value));
  }
}
