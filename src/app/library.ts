/**
 * "Image from…" (Task §7): another .timeline as a library of pictures —
 * stock-images.en.timeline first of all. Its images are shown with their
 * captions; the one picked is copied into the open file with its caption and
 * credit, under the same content-hash name.
 */

import { t } from '../core/i18n';
import type { ImageInfo } from '../core/model';
import { h } from './dom';
import { openPicker, PICKER_TYPES, readTimeline } from './files';
import { ImageStore, type NewImage } from './images';
import { lastLibrary, permitted, rememberLibrary } from './recent';
import { dialog, toast } from './ui';

export interface Picked {
  hash: string;
  info: ImageInfo;
  image: NewImage;
}

async function chooseFile(): Promise<{ file: File; handle: FileSystemFileHandle | null } | null> {
  const picker = openPicker();
  if (picker) {
    const last = await lastLibrary();
    try {
      const [handle] = await picker({ types: PICKER_TYPES, id: 'library', startIn: last });
      if (!handle) return null;
      await rememberLibrary(handle);
      return { file: await handle.getFile(), handle };
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.timeline,.zip' });
    input.addEventListener('change', () => resolve(input.files?.[0] ? { file: input.files[0], handle: null } : null));
    // Without it a cancelled picker would leave the editor waiting for good.
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Opens the last library again if the browser still allows it, else asks for one. */
export async function pickFromLibrary(fresh = false): Promise<Picked | null> {
  let chosen: { file: File; handle: FileSystemFileHandle | null } | null = null;
  const last = fresh ? undefined : await lastLibrary();
  if (last && (await permitted(last))) {
    try {
      chosen = { file: await last.getFile(), handle: last };
    } catch {
      chosen = null;
    }
  }
  chosen ??= await chooseFile();
  if (!chosen) return null;
  let opened;
  try {
    opened = await readTimeline(chosen.file);
  } catch (error) {
    toast((error as Error).message, { kind: 'error' });
    return null;
  }
  const { doc, archive, prefix } = opened;
  const store = new ImageStore(archive, prefix, (hash) => doc.images[hash]?.ext);
  const hashes = Object.keys(doc.images);
  if (!hashes.length) {
    toast(t('library', '{name} has no pictures.', { name: chosen.file.name }));
    return null;
  }
  let picked: string | null = null;
  const grid = h('div', { class: 'library-grid', role: 'listbox' });
  // A thumb is read out of the file as its tile scrolls near: a library of hundreds costs a screenful at first.
  const waiting = new Map<Element, string>();
  const lazy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const hash = waiting.get(entry.target);
        if (!entry.isIntersecting || !hash) continue;
        waiting.delete(entry.target);
        lazy.unobserve(entry.target);
        const img = entry.target as HTMLImageElement;
        void store.thumb(hash).then((url) => url && (img.src = url));
      }
    },
    { root: grid, rootMargin: '200px' },
  );
  for (const hash of hashes) {
    const info = doc.images[hash]!;
    const img = h('img', { alt: '', class: 'library-thumb' });
    waiting.set(img, hash);
    lazy.observe(img);
    const button = h(
      'button',
      {
        class: 'library-item',
        type: 'button',
        role: 'option',
        'aria-selected': 'false',
        onclick: () => {
          picked = hash;
          for (const b of grid.children) b.setAttribute('aria-selected', String(b === button));
        },
        ondblclick: () => {
          picked = hash;
          (grid.closest('form')?.querySelector('.button--primary') as HTMLButtonElement | null)?.click();
        },
      },
      img,
      h('span', { class: 'library-caption' }, info.caption || hash.slice(0, 8)),
    );
    grid.append(button);
  }
  const another = h('button', { class: 'link-button', type: 'button' }, t('library', 'Another file…'));
  const body = h('div', {}, h('p', { class: 'dialog-text' }, doc.title), grid, h('p', { class: 'library-more' }, another));
  let again = false;
  another.addEventListener('click', () => {
    again = true;
    (another.closest('dialog') as HTMLDialogElement | null)?.close();
  });
  const answer = await dialog({
    title: t('library', 'Image from a library'),
    body,
    className: 'dialog--wide',
    buttons: [
      { label: t('ui', 'Cancel'), value: 'cancel' },
      { label: t('library', 'Use this picture'), value: 'use', primary: true },
    ],
    check: (value) => value !== 'use' || picked !== null,
  });
  try {
    if (again) return await pickFromLibrary(true);
    if (answer !== 'use' || !picked) return null;
    const info = structuredClone(doc.images[picked]!);
    const { thumb, image } = await store.bytes(picked);
    if (!image) {
      toast(t('library', 'That picture is missing from its file.'), { kind: 'error' });
      return null;
    }
    return { hash: picked, info, image: { ext: info.ext, thumb: thumb ?? image, image } };
  } finally {
    lazy.disconnect();
    store.dispose();
  }
}
