/**
 * Export as a web page: the open timeline as a page anyone reads in a browser
 * and no one edits — this very page, its script and styles, with the timeline
 * put inside it. Opened, it shows that timeline at once, with no start screen,
 * no edit mode, nothing to save (main.ts); like this page, it never touches
 * the network.
 *
 * Its pictures and music go one of two ways, as the author chooses:
 * - inside the page: the .timeline itself, in base64, in a data block — one
 *   .html file to send or put anywhere, a third larger than the .timeline;
 * - in a folder beside it: a .zip of <name>/index.html and <name>/media/
 *   (thumbs/, images/, audio/ — the .timeline's own layout), the page holding
 *   only timeline.json and the list of those files. Unpacked, it opens from a
 *   disk or a website, and its policy lets pictures and sound come from the
 *   page's own place ('self') and from nowhere else.
 *
 * The data blocks go before the page's script, so they are there when it runs.
 * A data block is not a script: the policy's hash still pins the only one.
 */

import { t } from '../core/i18n';
import { parseDoc, serializeDoc } from '../core/model';
import { ZipWriter } from '../core/zip';
import { h } from './dom';
import { asWritten, canSaveInPlace, download, mediaWarnings, readTimeline, shareFile, sizeText, timelineBlob, type Opened } from './files';
import { PAGE_SOURCE } from './source';
import { app, type Session } from './state';
import { dialog, toast } from './ui';

/** What an exported page carries in #timeline-data. */
interface Embedded {
  /** 1: the one this version writes; a later one may add fields, never change these. */
  format: number;
  /** The .timeline's name, as the page reports it. */
  name: string;
  /** In a folder: where it is, relative to the page… */
  media?: string;
  /** …the zip paths it holds there (`images/….webp`)… */
  files?: string[];
  /** …and timeline.json. Inside the page, the whole .timeline is #timeline-zip instead. */
  timeline?: unknown;
}

const DATA = 'timeline-data';
const ZIP = 'timeline-zip';
const encoder = new TextEncoder();

/* ------------------------------------------------------------------ *
 * The exported page, opening
 * ------------------------------------------------------------------ */

/** The timeline this page carries, if it is an exported page. */
export function embeddedTimeline(): Embedded | null {
  const text = document.getElementById(DATA)?.textContent;
  return text ? (JSON.parse(text) as Embedded) : null;
}

/** Reads what the page carries, as a file would be read: the same checks, the same warnings. */
export async function readEmbedded(data: Embedded): Promise<Omit<Opened, 'file'>> {
  const zip = document.getElementById(ZIP)?.textContent;
  if (zip) return readTimeline(new File([fromBase64(zip) as Uint8Array<ArrayBuffer>], data.name));
  const { doc, warnings } = parseDoc(data.timeline);
  const files = new Set(data.files ?? []);
  warnings.push(...mediaWarnings(doc, (path) => files.has(path)));
  return { doc, warnings, archive: null, prefix: '', name: data.name, folder: { base: data.media ?? '', files } };
}

/* ------------------------------------------------------------------ *
 * Exporting
 * ------------------------------------------------------------------ */

type Where = 'inside' | 'folder';

async function askWhere(): Promise<Where | null> {
  const option = (value: Where, label: string, hint: string, checked: boolean) =>
    h(
      'label',
      { class: 'toggle' },
      h('input', { type: 'radio', name: 'export-where', value, checked }),
      h('span', {}, h('span', { class: 'toggle-label' }, label), h('span', { class: 'toggle-hint' }, hint)),
    );
  const body = h(
    'div',
    { class: 'export-choices' },
    h('p', { class: 'dialog-text' }, t('export', 'A page to read the timeline in any browser, from a disk or a website. It cannot be edited.')),
    h(
      'div',
      { class: 'export-options', role: 'radiogroup', 'aria-label': t('export', 'Pictures') },
      option('inside', t('export', 'Inside the page'), t('export', 'One .html file, easy to send. It is larger: the pictures are written into it.'), true),
      option('folder', t('export', 'In a folder beside it'), t('export', 'A .zip: the page and a folder with the pictures. Unpack it and open index.html.'), false),
    ),
  );
  const answer = await dialog({
    title: t('export', 'Export as a web page'),
    body,
    buttons: [
      { label: t('ui', 'Cancel'), value: 'cancel' },
      { label: t('export', 'Export'), value: 'export', primary: true },
    ],
  });
  if (answer !== 'export') return null;
  return body.querySelector<HTMLInputElement>('input[name="export-where"]:checked')?.value === 'folder' ? 'folder' : 'inside';
}

type PickerType = { description: string; accept: Record<string, `.${string}`[]> };

/**
 * Where to write: a handle from the save dialog, null for a download, false when cancelled.
 * Asked before anything is made — the browser lets a page open the dialog only just
 * after a click, and the pictures of a large timeline take a while to gather.
 */
async function saveTarget(name: string, type: PickerType): Promise<FileSystemFileHandle | null | false> {
  if (!canSaveInPlace()) return null;
  try {
    return await (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({ suggestedName: name, types: [type] });
  } catch {
    return false;
  }
}

/** Exports the open timeline as a web page; asks where its pictures go, when it has any. */
export async function exportPage(): Promise<void> {
  const session = app.session;
  if (!session || app.busy || !PAGE_SOURCE) return;
  const { used } = asWritten(session.doc);
  const where = used.length || session.doc.music ? await askWhere() : 'inside';
  if (!where) return;
  const base = session.name.replace(/\.(timeline|zip|json)$/i, '') || 'timeline';
  const name = where === 'inside' ? `${base}.html` : `${base}.zip`;
  const target = await saveTarget(
    name,
    where === 'inside' ? { description: t('export', 'Web page'), accept: { 'text/html': ['.html'] } } : { description: t('export', 'Zip archive'), accept: { 'application/zip': ['.zip'] } },
  );
  if (target === false) return;
  app.busy = true;
  const working = toast(t('export', 'Exporting {name}…', { name }), { duration: 0 });
  try {
    const blob = where === 'inside' ? await insidePage(session, base) : await folderZip(session, base);
    if (target) {
      const writable = await target.createWritable();
      await writable.write(blob);
      await writable.close();
    } else if (!(/iPhone|iPad/.test(navigator.userAgent) && (await shareFile(blob, name)))) {
      download(blob, name);
    }
    toast(t('export', 'Exported {name}, {size}', { name: target ? target.name : name, size: sizeText(blob.size) }));
  } catch (error) {
    toast(t('export', 'Could not export: {error}', { error: String((error as Error).message ?? error) }), { kind: 'error', duration: 10000 });
  } finally {
    working();
    app.busy = false;
  }
}

/** One .html: the .timeline as it would be saved now, unsaved changes included, inside the page. */
async function insidePage(session: Session, base: string): Promise<Blob> {
  const { blob } = await timelineBlob(session.doc, session.store, session.archive, session.prefix);
  const zip = toBase64(new Uint8Array(await blob.arrayBuffer()));
  return new Blob([page(session, { format: 1, name: `${base}.timeline` }, zip)], { type: 'text/html' });
}

/** A .zip of <base>/index.html and <base>/media/. */
async function folderZip(session: Session, base: string): Promise<Blob> {
  const { doc, store } = session;
  const { written, used } = asWritten(doc);
  const parts: BlobPart[] = [];
  const writer = new ZipWriter((chunk) => void parts.push(chunk as Uint8Array<ArrayBuffer>));
  const files: string[] = [];
  const put = async (path: string, blob: Blob) => {
    files.push(path);
    // Photographs and compressed sound are stored as they are; an SVG or a WAV shrinks.
    await writer.add(`${base}/media/${path}`, new Uint8Array(await blob.arrayBuffer()), /\.(svg|wav)$/.test(path));
  };
  for (const hash of used) {
    const { thumb, image } = await store.bytes(hash);
    if (thumb) await put(`thumbs/${hash}.webp`, thumb);
    if (image) await put(`images/${hash}.${doc.images[hash]!.ext}`, image);
  }
  if (doc.music) {
    const audio = await store.audio(doc.music.file, doc.music.ext);
    if (audio) await put(`audio/${doc.music.file}.${doc.music.ext}`, audio);
  }
  const data: Embedded = { format: 1, name: `${base}.timeline`, media: 'media/', files, timeline: JSON.parse(serializeDoc(written)) };
  await writer.add(`${base}/index.html`, encoder.encode(page(session, data, null)));
  await writer.finish();
  return new Blob(parts, { type: 'application/zip' });
}

/** This page, as it was loaded, carrying `data` (and `zip`, base64) — the HTML of the exported page. */
function page(session: Session, data: Embedded, zip: string | null): string {
  const doc = new DOMParser().parseFromString(PAGE_SOURCE, 'text/html');
  // What makes the PWA the PWA stays with it: the exported page is a file of its own.
  for (const el of doc.head.querySelectorAll(
    'link[rel="manifest"], link[rel="apple-touch-icon"], meta[name="theme-color"], meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"], meta[name="service-worker"]',
  )) {
    el.remove();
  }
  const csp = doc.head.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]');
  const script = doc.body.querySelector('script');
  if (!csp || !script) throw new Error('This page cannot copy itself');
  csp.content = policy(csp.content, !zip);
  doc.title = session.doc.title;
  const block = (id: string, type: string, text: string) => {
    const el = doc.createElement('script');
    el.id = id;
    el.type = type;
    el.textContent = text;
    return el;
  };
  // "</script>" or "<!--" in a text would end the block early: no "<" is left in the JSON for them to start with.
  script.before(block(DATA, 'application/json', JSON.stringify(data).replace(/</g, '\\u003c')));
  if (zip) script.before(block(ZIP, 'text/plain', zip));
  return `<!doctype html>\n${doc.documentElement.outerHTML}\n`;
}

/**
 * The exported page's policy: this page's, but nothing fetched at all — the PWA's
 * 'self' for its manifest, worker and shelf goes — and, for a page with a folder,
 * pictures and sound from its own place.
 */
function policy(csp: string, folder: boolean): string {
  const directives = new Map(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name!, sources]),
  );
  directives.set('connect-src', ["'none'"]);
  directives.delete('manifest-src');
  directives.delete('worker-src');
  for (const name of ['img-src', 'media-src']) {
    const sources = (directives.get(name) ?? []).filter((source) => source !== "'self'");
    directives.set(name, folder ? [...sources, "'self'"] : sources);
  }
  return [...directives].map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
}

/* ------------------------------------------------------------------ *
 * Base64, without the network: a data: URL would have to be fetched
 * ------------------------------------------------------------------ */

function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (native) return native.call(bytes);
  // Pieces of a multiple of 3 bytes: their base64 joins with no padding in between.
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x6000) out += btoa(String.fromCharCode(...bytes.subarray(i, i + 0x6000)));
  return out;
}

function fromBase64(text: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array }).fromBase64;
  if (native) return native(text.trim());
  const binary = atob(text.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
