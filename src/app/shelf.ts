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
 * index.json may list files and covers on another site, by https:// address
 * (docs/format.md, "A library"): they are fetched from there, and kept offline
 * the same way.
 *
 * From file:// there is no shelf — that page has no server beside it.
 */

import { language, LANGUAGES, t, tn } from '../core/i18n';
import { shelfGroups, type LibraryEntry } from '../core/library';
import { byId, h } from './dom';
import { sizeText } from './files';
import { openFile } from './session';
import { toast } from './ui';
import { isPwa } from './update';

const LIBRARY = 'timeline-library';
const base = () => new URL('library/', location.href);
/** Where a file or a cover is: beside index.json, or at its own address elsewhere. */
const at = (path: string): string => new URL(path, base()).href;
/** The name a shelf file opens under: its own, not the address it came from. */
const fileName = (path: string): string => new URL(at(path)).pathname.split('/').pop() || path;

/** The addresses kept offline. */
async function kept(): Promise<Set<string>> {
  try {
    const cache = await caches.open(LIBRARY);
    return new Set((await cache.keys()).map((request) => request.url));
  } catch {
    return new Set();
  }
}

async function keepOffline(entry: LibraryEntry, keep: boolean): Promise<boolean> {
  const cache = await caches.open(LIBRARY);
  const urls = [at(entry.file), ...(entry.cover ? [at(entry.cover)] : [])];
  if (!keep) {
    for (const url of urls) await cache.delete(url);
    return true;
  }
  try {
    await cache.addAll([...urls, at('index.json')]);
    // Kept files must survive the browser's tidying when space runs short.
    void navigator.storage?.persist?.();
    return true;
  } catch {
    toast(t('shelf', 'Could not download {name} — are you online?', { name: entry.title }), { kind: 'error' });
    return false;
  }
}

async function open(entry: LibraryEntry): Promise<void> {
  const close = toast(t('shelf', 'Opening {name}…', { name: entry.title }), { duration: 0 });
  try {
    const response = await fetch(at(entry.file));
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();
    close();
    await openFile(new File([blob], fileName(entry.file), { type: 'application/zip' }), null, true);
  } catch {
    close();
    toast(t('shelf', '{name} could not be loaded — it is not kept offline and the network is not there.', { name: entry.title }), { kind: 'error' });
  }
}

/** A language's own name where the interface knows it, else its code. */
const languageName = (lang: string): string => (LANGUAGES as Record<string, string>)[lang] ?? lang.toUpperCase();

export async function renderShelf(): Promise<void> {
  const section = byId('shelf');
  if (!isPwa()) {
    section.hidden = true;
    return;
  }
  let entries: LibraryEntry[];
  try {
    const response = await fetch(at('index.json'));
    entries = ((await response.json()) as { files: LibraryEntry[] }).files;
  } catch {
    section.hidden = true;
    return;
  }
  const offline = await kept();
  const list = byId('shelf-list');
  list.replaceChildren(
    ...shelfGroups(entries, language()).map(({ shown: entry, others }) => {
      const box = h('input', { type: 'checkbox', checked: offline.has(at(entry.file)) });
      box.addEventListener('change', async () => {
        box.disabled = true;
        const ok = await keepOffline(entry, box.checked);
        if (!ok) box.checked = !box.checked;
        box.disabled = false;
      });
      const meta = entry.items ? `${entry.span} · ${tn('start', '{count} item', '{count} items', entry.items)}` : tn('shelf', '{count} picture', '{count} pictures', entry.images);
      return h(
        'div',
        { class: 'cover', 'data-file': entry.file },
        h(
          'button',
          { class: 'cover-open', type: 'button', title: entry.description, lang: entry.lang, onclick: () => void open(entry) },
          entry.cover ? h('img', { class: 'cover-image', src: at(entry.cover), alt: '' }) : h('span', { class: 'cover-image cover-image--empty' }),
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
        h('label', { class: 'cover-check' }, box, h('span', {}, t('shelf', 'Keep offline')), h('span', { class: 'cover-size' }, sizeText(entry.size))),
      );
    }),
  );
  section.hidden = entries.length === 0;
}
