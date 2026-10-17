/**
 * The open document: opening a file, saving it back, closing it — with the
 * recovery draft, the recent-files list and the warnings along the way.
 */

import { History } from '../core/commands';
import { dateOf, formatRange, isNow, midOf, todayDay } from '../core/dates';
import { language, t, tn } from '../core/i18n';
import { extentOf, parseDoc, serializeDoc, usedImages, type Doc, type Warning } from '../core/model';
import { pxPerDayOf } from '../core/scale';
import { blobSource, openZip, rootPrefix } from '../core/zip';
import { byId, h } from './dom';
import { canSaveInPlace, download, FileError, fileNameFor, timelineBlob, PICKER_TYPES, readTimeline, saveToHandle, shareFile, type Opened } from './files';
import { ImageStore } from './images';
import { applyStyle } from './properties';
import { addRecent, dropDraft, loadDraft, permitted, saveDraft } from './recent';
import { recall, remember } from './settings';
import { app, emit, type Session } from './state';
import { confirmDialog, dialog, toast } from './ui';

export function showStart(): void {
  byId('app').hidden = true;
  byId('start').hidden = false;
  document.title = 'Timeline';
  window.dispatchEvent(new CustomEvent('timeline:start'));
}

function showApp(): void {
  byId('start').hidden = true;
  byId('app').hidden = false;
}

export function updateTitle(): void {
  const session = app.session;
  if (!session) return;
  const title = session.doc.title;
  byId('doc-title').textContent = title;
  byId('doc-title').lang = session.doc.lang;
  const dirty = session.history.dirty;
  byId('dirty').hidden = !dirty;
  document.title = `${dirty ? '• ' : ''}${title} — Timeline`;
}

/* ------------------------------------------------------------------ *
 * Opening
 * ------------------------------------------------------------------ */

const draftKey = (doc: Doc, name: string) => `${doc.meta.id}|${name}`;

/** Opens a file; `handle` lets Save write back into it. */
export async function openFile(file: File, handle: FileSystemFileHandle | null = null, remote = false): Promise<boolean> {
  if (app.busy) {
    toast(t('files', 'Another file is still opening — try again in a moment.'));
    return false;
  }
  // Read the new file first: one that does not open must not close the one that is open.
  app.busy = true;
  let opened: Opened;
  try {
    opened = await readTimeline(file);
  } catch (error) {
    toast(error instanceof FileError ? error.message : t('files', 'The file could not be opened: {error}', { error: String((error as Error).message ?? error) }), { kind: 'error', duration: 8000 });
    return false;
  } finally {
    app.busy = false;
  }
  if (app.session && !(await closeSession())) return false;
  // A bare timeline.json is an author's source: Save makes a .timeline beside it, never writes zip bytes into it.
  await startSession(opened, opened.archive ? handle : null, remote);
  return true;
}

/** Shows a document that is open now: from a file, or new from a template. */
export async function startSession(opened: Omit<Opened, 'file'>, handle: FileSystemFileHandle | null = null, remote = false): Promise<void> {
  const { doc, warnings, archive, prefix, name } = opened;
  const store = new ImageStore(archive, prefix, (hash) => doc.images[hash]?.ext);
  const session: Session = { doc, history: new History(doc), store, archive, prefix, name, handle, remote };
  app.session = session;
  // The file's look before its first frame, not after a draft has been offered.
  applyStyle();
  session.history.onChange(() => onDocChanged());
  app.strip.setDoc(doc, store);
  app.strip.selected = null;
  showApp();
  // Wait a frame so the strip has its width before the first view is chosen.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  app.strip.setView(initialView(doc), true);
  app.minimap.invalidate();
  updateTitle();
  if (warnings.length) showWarnings(warnings);
  if (archive || handle) void rememberRecent(session);
  await offerDraft(session);
  emit('opened');
}

/** A new document, never saved: Save asks where. */
export async function openNew(doc: Doc): Promise<boolean> {
  if (app.session && !(await closeSession())) return false;
  await startSession({ doc, warnings: [], archive: null, prefix: '', name: fileNameFor(doc) });
  app.session!.history.markDirty();
  updateTitle();
  return true;
}

/** The reader's own last position wins; then the author's view; then the kind's default. */
function initialView(doc: Doc): { center: number; pxPerDay: number; width: number } {
  const width = app.strip.view.width;
  const saved = recall<{ center: number; pxPerDay: number }>(`view.${doc.meta.id}`);
  if (saved && Number.isFinite(saved.center) && saved.pxPerDay > 0) return { ...saved, width };
  const [lo, hi] = extentOf(doc);
  const fit = () => {
    app.strip.setView({ center: (lo + hi) / 2, pxPerDay: 1, width });
    return { center: (lo + hi) / 2, pxPerDay: app.strip.fitPx, width };
  };
  if (doc.view?.center || doc.view?.scale) {
    const base = fit();
    const pxPerDay = doc.view.scale ? pxPerDayOf(doc.view.scale) : base.pxPerDay;
    // A scale with no centre opens where reading begins: at the start — or at today, for a chronology that runs to it.
    const center = doc.view.center
      ? midOf(doc.view.center)
      : doc.view.scale
        ? doc.end && isNow(doc.end)
          ? todayDay()
          : app.strip.startCenter(pxPerDay)
        : base.center;
    return { center, pxPerDay, width };
  }
  // A life opens at today with weeks on the ruler.
  if (doc.meta.kind === 'life') return { center: todayDay(), pxPerDay: 14, width };
  return fit();
}

function showWarnings(warnings: Warning[]): void {
  const skipped = warnings.filter((w) => w.code === 'item-skipped' || w.code === 'duplicate-id').length;
  const missing = warnings.filter((w) => w.code === 'image-missing').length;
  const newer = warnings.some((w) => w.code === 'newer-version');
  const other = warnings.length - skipped - missing - (newer ? 1 : 0);
  const parts: string[] = [];
  if (newer) parts.push(t('files', 'made by a newer version'));
  if (skipped) parts.push(tn('files', '{count} item skipped', '{count} items skipped', skipped));
  if (missing) parts.push(tn('files', '{count} image missing', '{count} images missing', missing));
  if (other) parts.push(tn('files', '{count} field left out', '{count} fields left out', other));
  toast(parts.join(', '), {
    duration: 12000,
    action: {
      label: t('files', 'Details'),
      run: () =>
        void dialog({
          title: t('files', 'What could not be read'),
          body: h('ul', { class: 'warning-list' }, ...warnings.map((w) => h('li', {}, w.text))),
          buttons: [{ label: t('ui', 'Close'), value: 'ok', primary: true }],
        }),
    },
  });
}

async function rememberRecent(session: Session): Promise<void> {
  const doc = session.doc;
  const [lo, hi] = extentOf(doc);
  const cover = doc.cover ? (await session.store.bytes(doc.cover)).thumb ?? undefined : undefined;
  const open = doc.items.some((i) => i.end && 'now' in i.end);
  const span = doc.items.length ? formatRange({ y: dateOf(lo).y }, open ? { now: true } : { y: dateOf(hi - 1).y }) : '';
  await addRecent({
    key: draftKey(doc, session.name),
    name: session.name,
    title: doc.title,
    kind: doc.meta.kind,
    span,
    items: doc.items.length,
    opened: Date.now(),
    handle: session.handle ?? undefined,
    cover,
  });
}

async function offerDraft(session: Session): Promise<void> {
  const draft = await loadDraft(draftKey(session.doc, session.name));
  if (!draft) return;
  const restore = await confirmDialog(
    t('files', 'Unsaved changes'),
    t('files', 'Restore unsaved changes to {name} from {when}?', { name: session.name, when: new Date(draft.saved).toLocaleString(language()) }),
    t('files', 'Restore'),
    t('files', 'Discard'),
  );
  if (!restore) {
    await dropDraft(draft.key);
    return;
  }
  const { doc } = parseDoc(JSON.parse(draft.json));
  for (const [hash, image] of draft.images) session.store.added.set(hash, image);
  for (const [hash, blob] of draft.audio ?? []) session.store.addedAudio.set(hash, blob);
  Object.assign(session.doc, doc);
  for (const key of Object.keys(session.doc) as (keyof Doc)[]) if (!(key in doc)) delete session.doc[key];
  session.history.markDirty();
  app.strip.changed();
  emit('changed');
}

/* ------------------------------------------------------------------ *
 * Saving
 * ------------------------------------------------------------------ */

function stampModified(doc: Doc): void {
  doc.meta.modified = new Date().toISOString().slice(0, 10);
  doc.meta.generator = `timeline ${__APP_VERSION__}`;
}

/** Saves into the open file when it can; otherwise asks where (or downloads). */
export async function save(as = false): Promise<boolean> {
  const session = app.session;
  if (!session || app.busy) return false;
  app.busy = true;
  try {
    stampModified(session.doc);
    let handle = as || session.remote ? null : session.handle;
    if (!handle && canSaveInPlace()) {
      try {
        handle = await (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
          suggestedName: session.handle?.name ?? (session.remote ? fileNameFor(session.doc) : session.name.replace(/\.(zip|json)$/i, '.timeline')),
          types: PICKER_TYPES,
        });
      } catch {
        return false;
      }
    }
    const oldDraft = draftKey(session.doc, session.name);
    // Pictures the file no longer needs are left out of it, but undo may bring their items back:
    // their bytes move into memory now, while the old file can still be read.
    const used = usedImages(session.doc);
    for (const hash of Object.keys(session.doc.images)) {
      if (used.has(hash) || session.store.added.has(hash)) continue;
      const { thumb, image } = await session.store.bytes(hash);
      if (image) session.store.added.set(hash, { ext: session.doc.images[hash]!.ext, thumb: thumb ?? image, image });
    }
    let result;
    if (handle) {
      if (!(await permitted(handle, true))) {
        toast(t('files', 'No permission to write the file.'), { kind: 'error' });
        return false;
      }
      result = await saveToHandle(handle, session.doc, session.store, session.archive, session.prefix);
      // The file on disk is a new one now: read images from it, not from the old snapshot.
      const file = await handle.getFile();
      session.archive = await openZip(blobSource(file));
      session.prefix = rootPrefix(session.archive.entries.map((e) => e.name));
      session.store.rebase(session.archive, session.prefix);
      // What the file now holds is read from it; what it left out stays in memory for undo.
      for (const hash of [...session.store.added.keys()]) if (used.has(hash)) session.store.added.delete(hash);
      session.handle = handle;
      session.name = handle.name;
      session.remote = false;
    } else {
      const { blob, result: r } = await timelineBlob(session.doc, session.store, session.archive, session.prefix);
      result = r;
      const name = session.remote ? fileNameFor(session.doc) : session.name.replace(/\.(zip|json)$/i, '.timeline');
      if (!(/iPhone|iPad/.test(navigator.userAgent) && (await shareFile(blob, name)))) download(blob, name);
    }
    session.history.markSaved();
    await dropDraft(oldDraft);
    await dropDraft(draftKey(session.doc, session.name));
    void rememberRecent(session);
    const size = result.bytes < 1 << 20 ? t('files', '{n} KB', { n: Math.max(1, Math.round(result.bytes / 1024)) }) : t('files', '{n} MB', { n: (result.bytes / 1024 / 1024).toFixed(1) });
    toast(
      result.dropped
        ? tn('files', 'Saved, {size}; {count} unused image removed', 'Saved, {size}; {count} unused images removed', result.dropped, { size })
        : t('files', 'Saved, {size}', { size }),
    );
    emit('saved');
    return true;
  } catch (error) {
    toast(t('files', 'Could not save: {error}', { error: String((error as Error).message ?? error) }), { kind: 'error', duration: 10000 });
    return false;
  } finally {
    app.busy = false;
  }
}

/** Closes the open file, asking first when it has unsaved changes. */
export async function closeSession(): Promise<boolean> {
  const session = app.session;
  if (!session) return true;
  if (session.history.dirty) {
    const choice = await dialog({
      title: t('files', 'Save changes to {name}?', { name: session.doc.title }),
      body: t('files', 'Your changes are lost if you do not save them.'),
      buttons: [
        { label: t('files', 'Cancel'), value: 'cancel' },
        { label: t('files', 'Don’t save'), value: 'discard', danger: true },
        { label: t('files', 'Save'), value: 'save', primary: true },
      ],
    });
    if (choice === 'save') {
      if (!(await save())) return false;
    } else if (choice !== 'discard') return false;
  }
  // Saved, discarded or undone back to clean: no draft is left to offer next time.
  await dropDraft(draftKey(session.doc, session.name));
  rememberPosition();
  session.store.dispose();
  app.session = null;
  app.strip.setDoc(null, null);
  emit('closed');
  return true;
}

export function rememberPosition(): void {
  const session = app.session;
  if (!session) return;
  const { center, pxPerDay } = app.strip.view;
  remember(`view.${session.doc.meta.id}`, { center, pxPerDay });
}

let draftTimer = 0;
/** After every change: the title's dot, and in 30 s an autosave or a recovery draft. */
function onDocChanged(): void {
  updateTitle();
  app.strip.changed();
  app.minimap.invalidate();
  emit('changed');
  clearTimeout(draftTimer);
  const session = app.session;
  if (!session) return;
  if (!session.history.dirty) {
    void dropDraft(draftKey(session.doc, session.name));
    return;
  }
  draftTimer = window.setTimeout(() => void autosave(), 30_000);
}

async function autosave(): Promise<void> {
  const session = app.session;
  if (!session?.history.dirty || app.busy) return;
  if (app.settings.autosave && session.handle && !session.remote) {
    const handle = session.handle as FileSystemFileHandle & { queryPermission?: (d: { mode: string }) => Promise<PermissionState> };
    if ((await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted') {
      await save();
      return;
    }
  }
  await saveDraft({
    key: draftKey(session.doc, session.name),
    name: session.name,
    json: serializeDoc(session.doc),
    images: [...session.store.added],
    audio: [...session.store.addedAudio],
    saved: Date.now(),
  });
}

