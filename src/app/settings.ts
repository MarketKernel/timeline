/**
 * The reader's settings, one JSON in localStorage. Every field is checked when
 * read: a missing, unknown or damaged value falls back to its default.
 */

import { isLanguage, LANGUAGES, t, type Language } from '../core/i18n';
import { h } from './dom';
import { dialog } from './ui';

export interface Settings {
  language: 'system' | Language;
  theme: 'system' | 'light' | 'dark';
  /** Write into the open file every 30 s when its handle allows. */
  autosave: boolean;
  /** Events with a small card: the footnotes. */
  showMinor: boolean;
  /** The anchor ruler (AM, age…), when the file has an anchor. */
  secondRuler: boolean;
  reduceMotion: boolean;
  /** A timeline's own background music, where it has some. */
  music: boolean;
}

export const DEFAULTS: Readonly<Settings> = {
  language: 'system',
  theme: 'system',
  autosave: true,
  showMinor: true,
  secondRuler: true,
  reduceMotion: false,
  music: true,
};

const KEY = 'timeline.settings';

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    /* damaged: defaults */
  }
  const bool = (key: keyof Settings) => (typeof raw[key] === 'boolean' ? (raw[key] as boolean) : (DEFAULTS[key] as boolean));
  return {
    language: raw.language === 'system' || isLanguage(raw.language) ? (raw.language as Settings['language']) : DEFAULTS.language,
    theme: raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system' ? raw.theme : DEFAULTS.theme,
    autosave: bool('autosave'),
    showMinor: bool('showMinor'),
    secondRuler: bool('secondRuler'),
    reduceMotion: bool('reduceMotion'),
    music: bool('music'),
  };
}

export function saveSettings(settings: Settings): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode: kept for this session only */
  }
}

/** Small per-reader memories (the last position in a file, recent ids): JSON in localStorage, never essential. */
export function remember<T>(key: string, value: T): void {
  try {
    storage()?.setItem(`timeline.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function recall<T>(key: string): T | undefined {
  try {
    const raw = storage()?.getItem(`timeline.${key}`);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * The settings sheet (Task §5.1)
 * ------------------------------------------------------------------ */


export interface SettingsSheetOptions {
  settings: Settings;
  change(next: Partial<Settings>): void;
  /** The PWA's version line and Update button; absent in the single file. */
  extra?: () => Node | null;
}

export async function settingsSheet({ settings, change, extra }: SettingsSheetOptions): Promise<void> {
  const select = <K extends 'language' | 'theme'>(key: K, label: string, options: [Settings[K], string][]) => {
    const el = h('select', { class: 'field-input', id: `setting-${key}` }, ...options.map(([value, text]) => h('option', { value: String(value), selected: settings[key] === value }, text)));
    el.addEventListener('change', () => change({ [key]: el.value } as Partial<Settings>));
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), el);
  };
  const toggle = (key: 'autosave' | 'showMinor' | 'secondRuler' | 'reduceMotion' | 'music', label: string, hint: string) => {
    const box = h('input', { type: 'checkbox', id: `setting-${key}`, checked: settings[key] });
    box.addEventListener('change', () => change({ [key]: box.checked } as Partial<Settings>));
    return h('label', { class: 'toggle' }, box, h('span', {}, h('span', { class: 'toggle-label' }, label), h('span', { class: 'toggle-hint' }, hint)));
  };
  const body = h(
    'div',
    { class: 'settings' },
    select('language', t('settings', 'Language'), [
      ['system', t('settings', 'As in the system')],
      ...(Object.entries(LANGUAGES) as [Settings['language'], string][]),
    ]),
    select('theme', t('settings', 'Theme'), [
      ['system', t('settings', 'As in the system')],
      ['light', t('settings', 'Light')],
      ['dark', t('settings', 'Dark')],
    ]),
    toggle('autosave', t('settings', 'Save automatically'), t('settings', 'Every 30 seconds into the open file, when the browser allows it; otherwise a recovery copy is kept.')),
    toggle('showMinor', t('settings', 'Show small events'), t('settings', 'Events with small cards — the footnotes — when zoomed in.')),
    toggle('secondRuler', t('settings', 'Show the second ruler'), t('settings', 'Years from the file’s anchor: Anno Mundi, an age.')),
    toggle('reduceMotion', t('settings', 'Reduce motion'), t('settings', 'Jump instead of gliding; no inertia.')),
    toggle('music', t('settings', 'Play background music'), t('settings', 'When a timeline has music of its own. The speaker in the toolbar turns it off and on too.')),
    extra?.() ?? null,
  );
  await dialog({ title: t('settings', 'Settings'), body, buttons: [{ label: t('ui', 'Done'), value: 'done', primary: true }], className: 'dialog--settings' });
}
