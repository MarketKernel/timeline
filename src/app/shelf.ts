/**
 * The shelf (Task §4.3): in the PWA, the start screen lists the chronologies
 * put on the site beside it (library/index.json); the build puts none there. A
 * tap opens one from the server; "keep offline" puts its file in the Cache API,
 * where the service worker finds it with no network. The server's copy is
 * read-only: saving a shelf file is "Save as", and the copy saved is the reader's.
 *
 * A chronology may come in several languages, one file each. The shelf shows
 * it once, in the interface's language where there is such a file, and names
 * the other languages under it.
 *
 * From file:// there is no shelf — that page has no server beside it.
 */

import { language, LANGUAGES, t, tn } from '../core/i18n';
import { byId, h } from './dom';
import { openFile } from './session';
import { toast } from './ui';
import { isPwa } from './update';

interface ShelfEntry {
  id: string;
  /** The chronology this file is one language of: one key for all its language files. */
  group: string;
  lang: string;
  file: string;
  title: string;
  description: string;
  kind: string;
  span: string;
  items: number;
  images: number;
  size: number;
  cover: string | null;
}

const LIBRARY = 'timeline-library';
const base = () => new URL('library/', location.href);

async function kept(): Promise<Set<string>> {
  try {
    const cache = await caches.open(LIBRARY);
    return new Set((await cache.keys()).map((request) => new URL(request.url).pathname.split('/').pop() ?? ''));
  } catch {
    return new Set();
  }
}

async function keepOffline(entry: ShelfEntry, keep: boolean): Promise<boolean> {
  const cache = await caches.open(LIBRARY);
  const urls = [new URL(entry.file, base()).href, ...(entry.cover ? [new URL(entry.cover, base()).href] : [])];
  if (!keep) {
    for (const url of urls) await cache.delete(url);
    return true;
  }
  try {
    await cache.addAll([...urls, new URL('index.json', base()).href]);
    // Kept files must survive the browser's tidying when space runs short.
    void navigator.storage?.persist?.();
    return true;
  } catch {
    toast(t('shelf', 'Could not download {name} — are you online?', { name: entry.title }), { kind: 'error' });
    return false;
  }
}

async function open(entry: ShelfEntry): Promise<void> {
  const close = toast(t('shelf', 'Opening {name}…', { name: entry.title }), { duration: 0 });
  try {
    const response = await fetch(new URL(entry.file, base()));
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();
    close();
    await openFile(new File([blob], entry.file, { type: 'application/zip' }), null, true);
  } catch {
    close();
    toast(t('shelf', '{name} could not be loaded — it is not kept offline and the network is not there.', { name: entry.title }), { kind: 'error' });
  }
}

const mb = (bytes: number) => (bytes < 1 << 20 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** A language's own name where the interface knows it, else its code. */
const languageName = (lang: string): string => (LANGUAGES as Record<string, string>)[lang] ?? lang.toUpperCase();

/** The file to show for a chronology: in the interface's language, else English, else the first. */
function preferred(files: ShelfEntry[]): ShelfEntry {
  const lang = language();
  return files.find((f) => f.lang === lang) ?? files.find((f) => f.lang.split('-')[0] === lang) ?? files.find((f) => f.lang === 'en') ?? files[0]!;
}

export async function renderShelf(): Promise<void> {
  const section = byId('shelf');
  if (!isPwa()) {
    section.hidden = true;
    return;
  }
  let entries: ShelfEntry[];
  try {
    const response = await fetch(new URL('index.json', base()));
    entries = ((await response.json()) as { files: ShelfEntry[] }).files;
  } catch {
    section.hidden = true;
    return;
  }
  const groups = new Map<string, ShelfEntry[]>();
  for (const entry of entries) {
    const key = entry.group ?? entry.id;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const offline = await kept();
  const list = byId('shelf-list');
  list.replaceChildren(
    ...[...groups.values()].map((files) => {
      const entry = preferred(files);
      const box = h('input', { type: 'checkbox', checked: offline.has(entry.file) });
      box.addEventListener('change', async () => {
        box.disabled = true;
        const ok = await keepOffline(entry, box.checked);
        if (!ok) box.checked = !box.checked;
        box.disabled = false;
      });
      const meta = entry.items ? `${entry.span} · ${tn('start', '{count} item', '{count} items', entry.items)}` : tn('shelf', '{count} picture', '{count} pictures', entry.images);
      const others = files.filter((f) => f !== entry);
      return h(
        'div',
        { class: 'cover', 'data-file': entry.file },
        h(
          'button',
          { class: 'cover-open', type: 'button', title: entry.description, lang: entry.lang, onclick: () => void open(entry) },
          entry.cover ? h('img', { class: 'cover-image', src: new URL(entry.cover, base()).href, alt: '' }) : h('span', { class: 'cover-image cover-image--empty' }),
          h('span', { class: 'cover-title' }, entry.title),
          h('span', { class: 'cover-meta' }, meta),
        ),
        others.length
          ? h(
              'p',
              { class: 'cover-languages' },
              t('shelf', 'Also in:'),
              ...others.flatMap((f) => [' ', h('button', { class: 'link-button', type: 'button', lang: f.lang, 'data-file': f.file, onclick: () => void open(f) }, languageName(f.lang))]),
            )
          : null,
        h('label', { class: 'cover-check' }, box, h('span', {}, t('shelf', 'Keep offline')), h('span', { class: 'cover-size' }, mb(entry.size))),
      );
    }),
  );
  section.hidden = entries.length === 0;
}
