/**
 * The page: the start screen, the open timeline, and what joins them — opening,
 * saving, the toolbar, the keyboard, settings and themes.
 *
 * One document is open at a time, as a Session: the parsed document, its undo
 * history, the zip it came from (read lazily), the images added since, and
 * where it is saved back to.
 */

import { detectLanguage, setLanguage, t, tn, translatePage } from '../core/i18n';
import { describeScale, nearestPreset, presetsFor, pxPerDayOf, specText, stepPreset, type ScaleSpec } from '../core/scale';
import { byId, h, isMac } from './dom';
import { PICKER_TYPES } from './files';
import { Minimap } from './minimap';
import { setupEditing } from './editor';
import { setupEras } from './eras';
import { setupMusic, syncMusic } from './music';
import { applyStyle, newTimeline, setupProperties } from './properties';
import { setupReading } from './reading';
import { renderShelf } from './shelf';
import { applyUpdate, canUpdate, checkForUpdate, isPwa, justUpdated, startUpdates, updateState, type UpdateState } from './update';
import { listRecent, permitted, removeRecent, type RecentFile } from './recent';
import { closeSession, openFile, rememberPosition, save, showStart, updateTitle } from './session';
import { saveSettings, settingsSheet, type Settings } from './settings';
import { app, emit, on } from './state';
import { closeMenus, menu, toast, type MenuItem } from './ui';
import { Strip } from './view';

/* ------------------------------------------------------------------ *
 * Settings: language and theme
 * ------------------------------------------------------------------ */

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(): void {
  const choice = app.settings.theme;
  const dark = choice === 'dark' || (choice === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // The file's paper has a light and a dark version; applyStyle also redraws the mini-map.
  applyStyle();
}
darkQuery.addEventListener('change', applyTheme);

export function applyLanguage(): void {
  setLanguage(app.settings.language === 'system' ? detectLanguage() : app.settings.language);
  translatePage();
  if (app.session) {
    updateTitle();
    app.strip.changed();
    updateScaleLabel();
  }
  emit('language');
}

export function updateSettings(change: Partial<Settings>): void {
  app.settings = { ...app.settings, ...change };
  saveSettings(app.settings);
  if ('theme' in change) applyTheme();
  if ('music' in change) void syncMusic();
  if ('language' in change) applyLanguage();
  const strip = app.strip;
  strip.showMinor = app.settings.showMinor;
  strip.secondRuler = app.settings.secondRuler;
  strip.reduceMotion = app.settings.reduceMotion;
  if (app.session) strip.refresh();
}

/* ------------------------------------------------------------------ *
 * The start screen
 * ------------------------------------------------------------------ */

async function pickFile(): Promise<void> {
  const picker = (window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
  if (picker) {
    try {
      const [handle] = await picker({ types: PICKER_TYPES, excludeAcceptAllOption: false });
      if (handle) await openFile(await handle.getFile(), handle);
    } catch {
      /* cancelled */
    }
    return;
  }
  byId<HTMLInputElement>('file-input').click();
}

async function renderRecent(): Promise<void> {
  const list = await listRecent();
  const box = byId('recent-list');
  const urls: string[] = [];
  box.replaceChildren(
    ...list.map((file) => {
      const url = file.cover ? URL.createObjectURL(file.cover) : '';
      if (url) urls.push(url);
      return coverCard(file, url);
    }),
  );
  byId('recent').hidden = list.length === 0;
}

function coverCard(file: RecentFile, url: string): HTMLElement {
  const open = async () => {
    if (!file.handle) {
      toast(t('start', 'This browser cannot reopen files by itself — use Open.'));
      return;
    }
    if (!(await permitted(file.handle))) return;
    try {
      await openFile(await file.handle.getFile(), file.handle);
    } catch {
      toast(t('start', '{name} is no longer where it was.', { name: file.name }), { kind: 'error' });
      await removeRecent(file.key);
      void renderRecent();
    }
  };
  return h(
    'div',
    { class: 'cover' },
    h(
      'button',
      { class: 'cover-open', type: 'button', onclick: () => void open(), 'aria-label': `${file.title}, ${file.name}` },
      url ? h('img', { class: 'cover-image', src: url, alt: '' }) : h('span', { class: 'cover-image cover-image--empty' }),
      h('span', { class: 'cover-title' }, file.title),
      h('span', { class: 'cover-meta' }, [file.kind === 'life' ? t('start', 'Life') : t('start', 'History'), file.span, tn('start', '{count} item', '{count} items', file.items)].filter(Boolean).join(' · ')),
      h('span', { class: 'cover-name' }, file.name),
    ),
    h('button', {
      class: 'cover-remove icon-button',
      type: 'button',
      title: t('start', 'Forget'),
      'aria-label': t('start', 'Forget {name}', { name: file.name }),
      onclick: async () => {
        await removeRecent(file.key);
        void renderRecent();
      },
      text: '×',
    }),
  );
}

/* ------------------------------------------------------------------ *
 * The toolbar
 * ------------------------------------------------------------------ */

export function updateScaleLabel(): void {
  const spec = describeScale(app.strip.view.pxPerDay);
  byId('scale').textContent = specText(spec);
}

/** The presets, and nothing else — only those the open file can be shown at: a century a pixel is not offered to two centuries of flight. */
function scaleMenu(): void {
  const current = app.strip.view.pxPerDay;
  const [lo, hi] = app.strip.extentDays;
  const nearest = nearestPreset(current);
  const items: MenuItem[] = presetsFor(hi - lo).map((spec) => ({
    label: specText(spec),
    checked: spec === nearest && Math.abs(Math.log(pxPerDayOf(spec) / current)) < 0.02,
    run: () => setScale(spec),
  }));
  menu(byId('scale'), items, 'menu--scale');
}

function setScale(spec: ScaleSpec): void {
  app.strip.go({ ...app.strip.view, pxPerDay: pxPerDayOf(spec) });
}

function zoomStep(direction: 1 | -1): void {
  // Continuous zoom in between; the buttons and keys snap to the presets.
  const next = stepPreset(app.strip.view.pxPerDay, direction);
  if (next) setScale(next);
  else app.strip.zoomBy(direction > 0 ? 2 : 0.5, undefined, true);
}

function moreMenu(): void {
  const session = app.session;
  if (!session) return;
  const mod = isMac() ? '⌘' : 'Ctrl+';
  menu(byId('more'), [
    { label: t('menu', 'Save'), hint: `${mod}S`, run: () => void save() },
    { label: t('menu', 'Save as…'), run: () => void save(true) },
    { label: t('menu', 'Open…'), run: () => void pickFile(), separator: true },
    { label: t('menu', 'New timeline…'), run: () => void newTimeline() },
    { label: t('menu', 'Print or save as PDF'), run: () => window.print() },
    { label: t('menu', 'Settings'), run: () => emit('settings'), separator: true },
    { label: t('menu', 'Close'), run: () => void closeSession().then((ok) => ok && showStart()), separator: true },
  ]);
}

/* ------------------------------------------------------------------ *
 * Keyboard (Task §5.3) — the parts that are the strip's
 * ------------------------------------------------------------------ */

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function onKey(event: KeyboardEvent): void {
  const session = app.session;
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (session) void save(event.shiftKey);
    return;
  }
  if (!session || byId('app').hidden || typing(event.target) || document.querySelector('dialog[open]')) return;
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) session.history.redo();
    else session.history.undo();
    return;
  }
  if (mod && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    session.history.redo();
    return;
  }
  if (mod || event.altKey) return;
  const strip = app.strip;
  const w = strip.view.width;
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      const sign = event.key === 'ArrowLeft' ? -1 : 1;
      strip.panBy(sign * (event.shiftKey ? w : w / 4), true);
      break;
    }
    case '+':
    case '=':
      zoomStep(1);
      break;
    case '-':
    case '_':
      zoomStep(-1);
      break;
    case '0':
      strip.fit();
      break;
    case 'Home':
      strip.goStart();
      break;
    case 'End':
      strip.goTo(strip.extentDays[1] - (w / 2 - 48) / strip.view.pxPerDay);
      break;
    case 't':
    case 'T':
      strip.goToday();
      break;
    default:
      return;
  }
  event.preventDefault();
}

/* ------------------------------------------------------------------ *
 * Files from outside: drag and drop, the file input
 * ------------------------------------------------------------------ */

function listenForFiles(): void {
  byId<HTMLInputElement>('file-input').addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void openFile(file);
  });
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      document.body.classList.add('dropping');
    }
  });
  window.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) document.body.classList.remove('dropping');
  });
  window.addEventListener('drop', (event) => {
    document.body.classList.remove('dropping');
    const items = [...(event.dataTransfer?.items ?? [])].filter((item) => item.kind === 'file');
    if (!items.length) return;
    // Images dropped on the strip in edit mode are the editor's (it stops the event first).
    event.preventDefault();
    if (items.every((item) => item.type.startsWith('image/'))) {
      if (app.session) toast(t('files', 'To add photos, turn on edit mode and drop them on the strip.'));
      return;
    }
    // Handles must be asked for before the first await: after it the DataTransfer is empty.
    const withHandle = items[0] as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> };
    const handlePromise = withHandle.getAsFileSystemHandle?.() ?? Promise.resolve(null);
    const file = items[0]!.getAsFile();
    void (async () => {
      const handle = await handlePromise.catch(() => null);
      if (file) await openFile(file, handle && handle.kind === 'file' ? (handle as FileSystemFileHandle) : null);
    })();
  });
}

/* ------------------------------------------------------------------ *
 * The PWA: updates, files from the system
 * ------------------------------------------------------------------ */

function updateText(state: UpdateState): string {
  switch (state.kind) {
    case 'checking':
      return t('update', 'Checking for a new version…');
    case 'latest':
      return t('update', 'This is the latest version.');
    case 'offline':
      return t('update', 'No connection — try again later.');
    case 'ready':
      return state.version ? t('update', 'Version {version} is ready.', { version: state.version }) : t('update', 'A new version is ready.');
    default:
      return '';
  }
}

/** Saves or closes what is open, then lets the new version in. */
async function update(): Promise<void> {
  if (!(await closeSession())) return;
  applyUpdate();
}

/** The settings' last lines: the version, and in the PWA the update button. */
function versionBlock(): Node {
  const line = h('p', { class: 'toggle-hint', id: 'settings-update' }, `${t('settings', 'Version')} ${__APP_VERSION__}`);
  if (!isPwa()) return line;
  const status = h('span', { class: 'update-status' }, updateText(updateState()));
  const button = h('button', { class: 'button', type: 'button', id: 'update-button' });
  const sync = () => {
    const state = updateState();
    status.textContent = updateText(state);
    button.textContent = state.kind === 'ready' ? t('update', 'Update') : t('update', 'Check for updates');
    button.disabled = !canUpdate() || state.kind === 'checking';
  };
  button.addEventListener('click', () => (updateState().kind === 'ready' ? void update() : void checkForUpdate()));
  sync();
  window.addEventListener('timeline:update', sync);
  return h('div', { class: 'settings-version' }, line, status, button);
}

function setupUpdates(): void {
  startUpdates((state) => {
    const note = byId('update-note');
    note.hidden = state.kind !== 'ready';
    if (state.kind === 'ready') {
      note.replaceChildren(updateText(state), ' ', h('button', { class: 'link-button', type: 'button', onclick: () => void update() }, t('update', 'Update')));
    }
    byId('more').classList.toggle('has-update', state.kind === 'ready');
    window.dispatchEvent(new CustomEvent('timeline:update'));
  });
  if (justUpdated()) toast(t('update', 'Updated to {version}', { version: __APP_VERSION__ }));
  if (isPwa()) void navigator.storage?.persist?.();
}

/**
 * A .timeline double-clicked in the Finder or Explorer opens in the installed app
 * (file_handlers in the manifest). Wired after the start screen is up, so nothing
 * that start-up opens lands on top of it.
 */
function listenForLaunches(): void {
  const queue = (window as unknown as { launchQueue?: { setConsumer(consumer: (params: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
  queue?.setConsumer(async ({ files }) => {
    const handle = files[0];
    if (!handle) return;
    if (app.busy || document.querySelector('dialog[open]')) {
      toast(t('files', 'Finish what is open, then open {name} again.', { name: handle.name }));
      return;
    }
    await openFile(await handle.getFile(), handle);
  });
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

function start(): void {
  applyTheme();
  applyLanguage();
  byId('version').textContent = __APP_VERSION__;

  app.strip = new Strip(byId('strip'), {
    select: (id) => emit('select', id),
    open: (id) => emit('open', id),
    viewChanged: () => {
      app.minimap.update();
      updateScaleLabel();
    },
    settled: () => rememberPosition(),
  });
  app.strip.showMinor = app.settings.showMinor;
  app.strip.secondRuler = app.settings.secondRuler;
  app.strip.reduceMotion = app.settings.reduceMotion;
  app.minimap = new Minimap(byId('minimap'), app.strip);

  byId('open-file').addEventListener('click', () => void pickFile());
  byId('new-timeline').addEventListener('click', () => void newTimeline());
  byId('home').addEventListener('click', () => void closeSession().then((ok) => ok && showStart()));
  byId('zoom-in').addEventListener('click', () => zoomStep(1));
  byId('zoom-out').addEventListener('click', () => zoomStep(-1));
  byId('scale').addEventListener('click', scaleMenu);
  byId('fit').addEventListener('click', () => app.strip.fit());
  byId('today').addEventListener('click', () => app.strip.goToday());
  byId('more').addEventListener('click', moreMenu);
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', (event) => {
    rememberPosition();
    if (app.session?.history.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  listenForFiles();
  setupReading();
  setupEditing();
  setupEras();
  setupMusic((on) => updateSettings({ music: on }));
  setupProperties();
  on('settings', () => void settingsSheet({ settings: app.settings, change: updateSettings, extra: versionBlock }));
  byId('start-settings').addEventListener('click', () => emit('settings'));
  window.addEventListener('timeline:start', () => {
    void renderRecent();
    void renderShelf();
  });
  // The shelf shows each chronology in the interface's language.
  on('language', () => void renderShelf());
  setupUpdates();
  on('opened', () => updateScaleLabel());
  showStart();
  listenForLaunches();
  // For the browser tests and the screenshot tool: the state, the views. Nothing secret lives here.
  (window as unknown as { timeline: typeof app }).timeline = app;
  document.documentElement.dataset.ready = 'true';
}

start();
