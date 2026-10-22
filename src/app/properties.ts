/**
 * The chronology's own settings, and "New timeline", which is the same form
 * on an empty file: its title and description, a cover (any picture), where
 * it begins and ends, the second ruler (years from a date: an age, a city's
 * years), how it looks to whoever opens it (`style`: the paper,
 * its texture, the colour of items without one, the face of titles), the
 * scale it opens at and the language of its texts. Unlike Settings, which are
 * the reader's, all of this is in the file and travels with it; the pencil at
 * the start of the edit bar opens it. Saving is one command on the undo stack;
 * the look is previewed live and put back on Cancel.
 */

import { imageChange, fieldChange, type Change } from '../core/commands';
import { isNow, startOf, today, type End, type When } from '../core/dates';
import { language, t } from '../core/i18n';
import { AUDIO_EXTS, DEFAULT_COLOR, emptyDoc, LANG_PATTERN, TEXTURES, type Anchor, type AudioExt, type Author, type Music, type Doc, type ImageInfo, type Style, type Texture, type TitleFont, type ViewSpec } from '../core/model';
import { describeScale, PRESETS, presetsFor, specText, type ScaleSpec } from '../core/scale';
import { STOCK_PAPER } from '../core/style';
import { contentHash } from '../core/hash';
import { newDocId } from '../core/templates';
import { byId, h } from './dom';
import { setEditing } from './editing';
import { colorField, dateField, field, group, hint, section } from './forms';
import { AUDIO_MIME, encodeImage, type NewImage } from './images';
import { syncMusic } from './music';
import { pickFromLibrary } from './library';
import { applyStyle, canon } from './look';
import { openNew } from './session';
import { app, on } from './state';
import { dialog, toast } from './ui';

/** Papers offered first: white, linen, sand, rose, lavender, blue, sage, cool grey — all pale enough for the ink. */
const PAPERS = ['#fbfaf7', '#f1ebe1', '#f3e4c4', '#f5e8e4', '#eeeaf3', '#e7eef6', '#e9efe2', '#eceeef'];

/** Languages a file is most likely written in, each named in itself; the file's own is added when it is another. */
const TEXT_LANGUAGES = ['en', 'ru', 'uk', 'be', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'cs', 'nl', 'sv', 'fi', 'el', 'he', 'ar', 'tr', 'zh', 'ja', 'ko'];

function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}



/** A row of radio buttons drawn as one control. */
function segmented<T extends string>(name: string, label: string, options: [T, string, string?][], checked: T): { el: HTMLElement; value: () => T } {
  const row = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': label },
    ...options.map(([value, text, style]) => h('label', { class: 'segment' }, h('input', { type: 'radio', name, value, checked: value === checked }), h('span', { style }, text))),
  );
  return { el: row, value: () => (row.querySelector<HTMLInputElement>('input:checked')?.value ?? checked) as T };
}

/** The cover as picked in the form: a picture in the file, or one new to it. */
interface Cover {
  hash: string;
  info: ImageInfo;
  encoded?: NewImage;
}

/** What the form says the file's own fields are now. */
interface Fields {
  lang: string;
  title: string;
  description?: string;
  author?: Author;
  start?: When;
  end?: End;
  anchor?: Anchor;
  cover?: string;
  style?: Style;
  music?: Music;
  view?: ViewSpec;
}

/** The music as picked in the form: what the file will say, and the bytes when they are new to it. */
interface Tune {
  music: Music;
  blob?: Blob;
}

/** "3.2 MB", "40 kB" — in the interface's language, by the browser's own words for the units. */
function fileSize(bytes: number): string {
  const [n, unit] = bytes >= 1e6 ? [bytes / 1e6, 'megabyte'] : [Math.max(1, bytes / 1e3), 'kilobyte'];
  return new Intl.NumberFormat(language(), { style: 'unit', unit, maximumFractionDigits: n < 10 ? 1 : 0 }).format(n);
}

/** An audio file's format, by its name or its type; null for what is not music this page keeps. */
function audioExtOf(file: File): AudioExt | null {
  const named = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  const byName = named === 'oga' ? 'ogg' : named === 'mpga' ? 'mp3' : named;
  if ((AUDIO_EXTS as readonly string[]).includes(byName ?? '')) return byName as AudioExt;
  const byType: Record<string, AudioExt> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/webm': 'webm',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
  };
  return byType[file.type] ?? null;
}

type Session = typeof app.session;

/**
 * The form, on a document open in a session or on a new, empty one. `read()`
 * gives the fields, or a message saying what is wrong.
 */
function settingsForm(doc: Doc, session: Session) {
  const lang = doc.lang;

  // What it is.
  const title = h('input', { class: 'field-input', type: 'text', id: 'timeline-title', lang, value: doc.title, autofocus: true, placeholder: t('properties', 'The history of …') });
  const description = h('textarea', { class: 'field-input', rows: '3', id: 'timeline-description', lang }, doc.description ?? '');
  // Who made it, all of it optional: a name (in the file's language), a website, a way to reach them.
  const authorName = h('input', { class: 'field-input', type: 'text', id: 'timeline-author-name', lang, value: doc.author?.name ?? '', 'aria-label': t('properties', 'Name'), placeholder: t('properties', 'Name') });
  const authorUrl = h('input', { class: 'field-input', type: 'url', id: 'timeline-author-url', value: doc.author?.url ?? '', 'aria-label': t('properties', 'Website'), placeholder: 'https://…' });
  const authorContact = h('input', { class: 'field-input', type: 'text', id: 'timeline-author-contact', value: doc.author?.contact ?? '', 'aria-label': t('properties', 'Contact'), placeholder: t('properties', 'E-mail, phone, …') });

  // The cover: any picture — from a file, a library file, or pasted.
  let cover: Cover | null = doc.cover && doc.images[doc.cover] ? { hash: doc.cover, info: doc.images[doc.cover]! } : null;
  const coverImage = h('img', { class: 'cover-tile-image', alt: '' });
  const coverEmpty = h('span', { class: 'cover-tile-empty' }, t('properties', 'No cover'));
  const removeCover = h('button', { class: 'text-button text-button--danger', type: 'button' }, t('properties', 'Remove'));
  let coverHeld: string | null = null;
  let coverUrl: string | null = null;
  /** Counts what the tile has shown: a thumb that arrives after the next one, or after the form closed, is given back. */
  let coverTurn = 0;
  const letGo = () => {
    coverTurn++;
    if (coverHeld) session?.store.release(coverHeld);
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    coverHeld = coverUrl = null;
  };
  const showCover = async () => {
    letGo();
    coverImage.hidden = !cover;
    coverEmpty.hidden = !!cover;
    removeCover.hidden = !cover;
    if (!cover) return coverImage.removeAttribute('src');
    if (cover.encoded) coverImage.src = coverUrl = URL.createObjectURL(cover.encoded.thumb);
    else if (session) {
      const { hash } = cover;
      const turn = coverTurn;
      const url = await session.store.thumb(hash);
      if (turn !== coverTurn) {
        if (url) session.store.release(hash);
        return;
      }
      coverHeld = url ? hash : null;
      coverImage.src = url ?? '';
    }
  };
  const inFile = (hash: string): Cover | null => (doc.images[hash] ? { hash, info: doc.images[hash]! } : null);
  const takeCover = async (blob: Blob) => {
    try {
      const encoded = await encodeImage(blob);
      cover = inFile(encoded.hash) ?? { hash: encoded.hash, info: { ext: encoded.ext, w: encoded.w, h: encoded.h }, encoded };
      await showCover();
    } catch (error) {
      toast(t('editor', 'This picture could not be read: {error}', { error: (error as Error).message }), { kind: 'error' });
    }
  };
  const coverInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  coverInput.addEventListener('change', () => {
    const file = coverInput.files?.[0];
    coverInput.value = '';
    if (file) void takeCover(file);
  });
  removeCover.addEventListener('click', () => {
    cover = null;
    void showCover();
  });
  const fromLibrary = async () => {
    const picked = await pickFromLibrary();
    if (!picked) return;
    // Its caption and credit come with it.
    cover = inFile(picked.hash) ?? { hash: picked.hash, info: picked.info, encoded: picked.image };
    await showCover();
  };
  const coverField = group(
    t('properties', 'Cover'),
    h(
      'div',
      { class: 'cover-field' },
      h('button', { class: 'cover-tile', type: 'button', id: 'timeline-cover', title: t('properties', 'Choose a picture…'), onclick: () => coverInput.click() }, coverImage, coverEmpty),
      h(
        'div',
        { class: 'cover-buttons' },
        h('button', { class: 'text-button', type: 'button', onclick: () => coverInput.click() }, t('properties', 'Choose a picture…')),
        h('button', { class: 'text-button', type: 'button', onclick: () => void fromLibrary() }, t('editor', 'From a library file…')),
        removeCover,
        coverInput,
      ),
    ),
    hint(t('properties', 'What the library shelf and the recent files show. A picture pasted or dropped on this form becomes the cover.')),
  );
  void showCover();

  // Where it begins and ends.
  const fallback: When = { y: today().y };
  type StartMode = 'auto' | 'date';
  type EndMode = 'auto' | 'date' | 'now';
  const startMode = h(
    'select',
    { class: 'field-input', id: 'timeline-start' },
    h('option', { value: 'auto', selected: !doc.start }, t('properties', 'From its first item')),
    h('option', { value: 'date', selected: !!doc.start }, t('properties', 'From a date')),
  );
  const startDate = dateField(t('properties', 'Begins on'), doc.start ?? fallback);
  const endMode = h(
    'select',
    { class: 'field-input', id: 'timeline-end' },
    h('option', { value: 'auto', selected: !doc.end }, t('properties', 'At its last item')),
    h('option', { value: 'date', selected: !!doc.end && !isNow(doc.end) }, t('properties', 'On a date')),
    h('option', { value: 'now', selected: !!doc.end && isNow(doc.end) }, t('properties', 'To the present day')),
  );
  const endDate = dateField(t('properties', 'Ends on'), doc.end && !isNow(doc.end) ? doc.end : fallback);
  const syncDates = () => {
    startDate.el.hidden = startMode.value !== 'date';
    endDate.el.hidden = endMode.value !== 'date';
  };
  startMode.addEventListener('change', syncDates);
  endMode.addEventListener('change', syncDates);
  syncDates();

  // The second ruler: years under the axis counted from a date — one's age from the birthday, a
  // city's years from its founding. A file that has none counts from where it begins, until
  // another date is typed in; a file counting from an item ("Count years from here") keeps
  // counting from it, and following it, while its date is left as it is.
  const anchorItem = doc.anchor?.item ? doc.items.find((i) => i.id === doc.anchor!.item) : undefined;
  const anchorOn = h('input', { type: 'checkbox', id: 'timeline-anchor', checked: !!doc.anchor });
  const anchorDate = dateField(t('properties', 'Count from'), doc.anchor?.at ?? anchorItem?.start ?? doc.start ?? fallback);
  const anchorLabel = h('input', { class: 'field-input', type: 'text', id: 'timeline-anchor-label', lang, value: doc.anchor?.label ?? '', placeholder: t('properties', 'Age') });
  let followStart = !doc.anchor;
  const fromStart = () => {
    const s = startMode.value === 'date' ? startDate.read() : null;
    if (followStart && s) anchorDate.set(s);
  };
  const anchorFields = h(
    'div',
    { class: 'anchor-fields' },
    anchorDate.el,
    anchorItem ? hint(t('properties', 'Counts from “{title}” and moves with it, unless another date is set here.', { title: anchorItem.title })) : null,
    field(t('properties', 'Name of the ruler'), anchorLabel, hint(t('properties', 'Left empty, it is called “Years”.'))),
  );
  const syncAnchor = () => {
    anchorFields.hidden = !anchorOn.checked;
    fromStart();
  };
  anchorOn.addEventListener('change', syncAnchor);
  startMode.addEventListener('change', fromStart);
  startDate.el.addEventListener('change', fromStart);
  anchorDate.el.addEventListener('change', () => (followStart = false));
  syncAnchor();
  const anchorField = group(
    t('properties', 'Second ruler'),
    h('label', { class: 'inline-check' }, anchorOn, h('span', {}, t('properties', 'Count the years from a date under the axis: an age, a city’s years'))),
    anchorFields,
  );

  // The scale it opens at.
  // The scales this chronology can be shown at; a new one, not yet any length, is offered them all.
  const [lo, hi] = app.strip.extentDays;
  const scales: [string, ScaleSpec][] = (session ? presetsFor(hi - lo) : PRESETS).map((spec) => [JSON.stringify(spec), spec]);
  const own = doc.view?.scale;
  if (own && !scales.some(([key]) => key === JSON.stringify(own))) scales.unshift([JSON.stringify(own), own]);
  const current = session ? describeScale(app.strip.view.pxPerDay) : null;
  const scale = h(
    'select',
    { class: 'field-input', id: 'timeline-scale' },
    h('option', { value: '', selected: !own }, t('properties', 'Everything at once')),
    current ? h('option', { value: JSON.stringify(current) }, t('properties', 'As on the screen now: {scale}', { scale: specText(current) })) : null,
    ...scales.map(([key, spec]) => h('option', { value: key, selected: !!own && key === JSON.stringify(own) }, specText(spec))),
  );

  // The look, previewed as it is picked.
  let ready = false;
  const preview = () => ready && applyStyle(readStyle());
  const paper = colorField({
    label: t('properties', 'Paper'),
    initial: doc.style?.paper,
    none: { label: t('properties', 'Parchment'), color: STOCK_PAPER },
    palette: PAPERS,
    onChange: preview,
  });
  const textureNames: Record<Texture, string> = {
    grain: t('properties', 'Grain'),
    plain: t('properties', 'Plain'),
    grid: t('properties', 'Squares'),
    lines: t('properties', 'Lines'),
    dots: t('properties', 'Dots'),
    graph: t('properties', 'Graph paper'),
  };
  const textures = h(
    'div',
    { class: 'texture-row', role: 'radiogroup', 'aria-label': t('properties', 'Texture') },
    ...TEXTURES.map((texture) =>
      h(
        'label',
        { class: 'texture-option' },
        h('input', { type: 'radio', name: 'timeline-texture', value: texture, checked: (doc.style?.texture ?? 'grain') === texture }),
        h('span', { class: `texture-tile texture-tile--${texture}`, 'aria-hidden': 'true' }),
        h('span', { class: 'texture-name' }, textureNames[texture]),
      ),
    ),
  );
  textures.addEventListener('change', preview);
  const texture = () => (textures.querySelector<HTMLInputElement>('input:checked')?.value ?? 'grain') as Texture;
  const itemColor = colorField({
    label: t('properties', 'Colour of items without their own'),
    initial: doc.style?.color,
    none: { label: t('properties', 'Warm grey'), color: DEFAULT_COLOR },
    onChange: preview,
  });
  const font = segmented<TitleFont>('timeline-font', t('properties', 'Titles'), [
    ['serif', t('properties', 'Serif'), 'font-family: var(--book)'],
    ['sans', t('properties', 'Sans-serif'), 'font-family: var(--sans)'],
  ], doc.style?.font ?? 'serif');
  font.el.addEventListener('change', preview);
  const readStyle = (): Style | undefined => {
    const style: Style = {};
    const p = paper.value();
    if (p) style.paper = p;
    // A file that names the default keeps naming it; the others only say what differs.
    if (texture() !== 'grain' || doc.style?.texture === 'grain') style.texture = texture();
    const c = itemColor.value();
    if (c) style.color = c;
    if (font.value() === 'sans' || doc.style?.font === 'serif') style.font = font.value();
    if (doc.style?.extra) style.extra = structuredClone(doc.style.extra);
    return Object.keys(style).length ? style : undefined;
  };

  // The language its texts are written in.
  const languages = TEXT_LANGUAGES.includes(lang) ? TEXT_LANGUAGES : [lang, ...TEXT_LANGUAGES];
  const languageSelect = h('select', { class: 'field-input', id: 'timeline-lang' }, ...languages.map((code) => h('option', { value: code, selected: code === lang, lang: code }, languageName(code))));

  // The background music: any audio file, kept as it is; its name says what it is.
  let tune: Tune | null = doc.music ? { music: structuredClone(doc.music) } : null;
  const tuneName = h('span', { class: 'music-name' });
  const tuneTitle = h('input', { class: 'field-input', type: 'text', id: 'timeline-music-title', lang, value: doc.music?.title ?? '', placeholder: t('properties', 'What it is: the composer, the piece') });
  const removeTune = h('button', { class: 'text-button text-button--danger', type: 'button' }, t('properties', 'Remove'));
  const tuneInput = h('input', { type: 'file', id: 'timeline-music-input', accept: 'audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.webm,.flac', hidden: true });
  const showTune = () => {
    tuneName.textContent = tune ? [tune.music.ext.toUpperCase(), tune.blob && fileSize(tune.blob.size)].filter(Boolean).join(' · ') : t('properties', 'No music');
    removeTune.hidden = !tune;
    tuneTitle.closest('.field')?.toggleAttribute('hidden', !tune);
  };
  tuneInput.addEventListener('change', async () => {
    const file = tuneInput.files?.[0];
    tuneInput.value = '';
    if (!file) return;
    const ext = audioExtOf(file);
    if (!ext || !new Audio().canPlayType(AUDIO_MIME[ext])) {
      toast(t('properties', 'This browser cannot play {name}: MP3, M4A and WAV play everywhere.', { name: file.name }), { kind: 'error' });
      return;
    }
    const hash = await contentHash(new Uint8Array(await file.arrayBuffer()));
    tune = { music: { file: hash, ext }, blob: file };
    if (!tuneTitle.value.trim()) tuneTitle.value = file.name.replace(/\.[^.]+$/, '');
    showTune();
  });
  removeTune.addEventListener('click', () => {
    tune = null;
    showTune();
  });
  const musicField = h(
    'div',
    { class: 'form-group' },
    group(
      t('properties', 'Background music'),
      h(
        'div',
        { class: 'music-row' },
        tuneName,
        h('button', { class: 'text-button', type: 'button', onclick: () => tuneInput.click() }, t('properties', 'Choose music…')),
        removeTune,
        tuneInput,
      ),
      hint(t('properties', 'Optional. It plays quietly, in a loop, while the timeline is open; a reader can turn it off in Settings or with the speaker in the toolbar. The file goes in as it is.')),
    ),
    field(t('properties', 'What it is'), tuneTitle),
  );

  const body = h(
    'div',
    { class: 'editor timeline-settings' },
    section(t('properties', 'About')),
    field(t('properties', 'Title'), title),
    field(t('properties', 'Description'), description, hint(t('properties', 'A paragraph for the library shelf.'))),
    group(
      t('properties', 'Author'),
      h('div', { class: 'author-fields' }, authorName, authorUrl, authorContact),
      hint(t('properties', 'Optional: who made the timeline, and how to reach them.')),
    ),
    coverField,
    field(t('properties', 'Language of its texts'), languageSelect, hint(t('properties', 'A translation is another file.'))),
    section(t('properties', 'Time')),
    h('div', { class: 'form-pair form-pair--even' }, field(t('properties', 'Begins'), startMode), field(t('properties', 'Ends'), endMode)),
    startDate.el,
    endDate.el,
    hint(t('properties', 'The strip begins and ends there; an item outside is never cut off — the strip widens to it.')),
    anchorField,
    field(t('properties', 'Opens at the scale'), scale, hint(t('properties', 'A reader who has opened it before comes back to where they left off.'))),
    section(t('properties', 'Look')),
    paper.el,
    hint(t('properties', 'In the dark theme the paper keeps its hue, darkened.')),
    group(t('properties', 'Texture'), textures),
    itemColor.el,
    group(t('properties', 'Titles'), font.el),
    section(t('properties', 'Music')),
    musicField,
  );
  ready = true;
  showTune();

  // A picture pasted or dropped anywhere on the form is the cover.
  body.addEventListener('paste', (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void takeCover(file);
  });
  body.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  body.addEventListener('drop', (event) => {
    const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    void takeCover(file);
  });

  const read = (): Fields | string => {
    const name = title.value.trim();
    if (!name) return t('properties', 'Give it a title.');
    const code = languageSelect.value;
    if (!LANG_PATTERN.test(code)) return t('properties', 'The language is a code like en, ru or pt-BR.');
    // Fields of an author that a newer version wrote are kept, whatever is typed here.
    const author: Author = doc.author?.extra ? { extra: doc.author.extra } : {};
    const who = authorName.value.trim();
    const site = authorUrl.value.trim();
    const contact = authorContact.value.trim();
    if (site && !/^https?:\/\/\S+$/i.test(site)) return t('properties', 'The website must start with https:// or http://');
    if (who) author.name = who;
    if (site) author.url = site;
    if (contact) author.contact = contact;
    const fields: Fields = {
      lang: code,
      title: name,
      description: description.value.trim() || undefined,
      author: Object.keys(author).length ? author : undefined,
      cover: cover?.hash,
      style: readStyle(),
    };
    if (tune) {
      const music: Music = { ...tune.music };
      const what = tuneTitle.value.trim();
      if (what) music.title = what;
      else delete music.title;
      fields.music = music;
    }
    if ((startMode.value as StartMode) === 'date') {
      const s = startDate.read();
      if (!s) return t('properties', 'The beginning is not a date.');
      fields.start = s;
    }
    const mode = endMode.value as EndMode;
    if (mode === 'now') fields.end = { now: true };
    else if (mode === 'date') {
      const e = endDate.read();
      if (!e) return t('properties', 'The end is not a date.');
      if (fields.start && startOf(e) <= startOf(fields.start)) return t('properties', 'The end comes before the beginning.');
      fields.end = e;
    }
    fields.anchor = undefined;
    if (anchorOn.checked) {
      const at = followStart && fields.start ? structuredClone(fields.start) : anchorDate.read();
      if (!at) return t('properties', 'The second ruler’s date is not a date.');
      // Its base and the fields a newer version wrote stay as they are.
      const anchor: Anchor = { ...structuredClone(doc.anchor ?? {}), label: anchorLabel.value.trim() };
      delete anchor.at;
      delete anchor.item;
      if (anchorItem && canon(at) === canon(anchorItem.start)) anchor.item = anchorItem.id;
      else anchor.at = at;
      fields.anchor = anchor;
    }
    // Only the scale is the form's: a centre the file names stays as it is.
    const view: ViewSpec = structuredClone(doc.view ?? {});
    delete view.scale;
    if (scale.value) view.scale = JSON.parse(scale.value) as ScaleSpec;
    fields.view = Object.keys(view).length ? view : undefined;
    return fields;
  };

  return { body, read, cover: () => cover, tune: () => tune, dispose: letGo };
}

/** Runs the form in a dialog; resolves with the fields and the cover, or null when cancelled. */
async function runForm(doc: Doc, session: Session, creating: boolean): Promise<{ fields: Fields; cover: Cover | null; tune: Tune | null } | null> {
  const form = settingsForm(doc, session);
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  form.body.prepend(
    hint(
      creating
        ? t('properties', 'All of it can be changed later: the pencil at the start of the edit bar.')
        : t('properties', 'Kept in the file: whoever opens it sees them. Your own choices are in Settings.'),
    ),
  );
  form.body.append(error);
  let fields: Fields | null = null;
  const answer = await dialog({
    title: creating ? t('properties', 'New timeline') : t('properties', 'Timeline settings'),
    body: form.body,
    buttons: [
      { label: t('ui', 'Cancel'), value: 'cancel' },
      { label: creating ? t('properties', 'Create') : t('properties', 'Save'), value: 'save', primary: true },
    ],
    className: 'dialog--editor',
    check: (value) => {
      if (value !== 'save') return true;
      const result = form.read();
      if (typeof result === 'string') {
        error.textContent = result;
        error.hidden = false;
        return false;
      }
      fields = result;
      return true;
    },
  });
  const cover = form.cover();
  const tune = form.tune();
  form.dispose();
  return answer === 'save' && fields ? { fields, cover, tune } : null;
}

/** A second ruler just set up, where the reader has turned the second ruler off, says why it is not there. */
function secondRulerOff(): void {
  if (!app.settings.secondRuler) toast(t('editor', 'The second ruler is off in Settings.'));
}

/** The settings of the open file. */
async function timelineSettings(): Promise<void> {
  const session = app.session;
  if (!session) return;
  const doc = session.doc;
  const result = await runForm(doc, session, false);
  if (result && app.session === session) {
    const changes: Change[] = [];
    if (result.fields.anchor && !doc.anchor) secondRulerOff();
    const { cover, tune } = result;
    // New music's bytes go to the store before the change: the player reads them when it comes.
    if (tune?.blob) session.store.addedAudio.set(tune.music.file, tune.blob);
    if (cover && !doc.images[cover.hash]) {
      if (cover.encoded) session.store.added.set(cover.hash, cover.encoded);
      changes.push(imageChange(doc, cover.hash, cover.info));
    }
    for (const [key, value] of Object.entries(result.fields) as [keyof Fields, unknown][]) {
      if (canon(doc[key]) !== canon(value)) changes.push(fieldChange(doc, key, value as never));
    }
    session.history.run({ label: t('properties', 'Change the timeline settings'), changes });
  }
  // Cancelled, or saved: the page wears what the file now says.
  applyStyle();
}

/** "New timeline": the same form on an empty file, which then opens in edit mode. */
export async function newTimeline(): Promise<void> {
  const doc = emptyDoc('history', 'untitled', '', language(), `timeline ${__APP_VERSION__}`);
  const result = await runForm(doc, null, true);
  applyStyle();
  if (!result) return;
  const { fields, cover, tune } = result;
  for (const [key, value] of Object.entries(fields) as [keyof Fields, unknown][]) {
    if (value !== undefined) (doc as unknown as Record<string, unknown>)[key] = value;
  }
  doc.meta.id = newDocId(fields.title);
  if (cover) doc.images[cover.hash] = cover.info;
  if (!(await openNew(doc))) return;
  if (doc.anchor) secondRulerOff();
  if (cover?.encoded) app.session?.store.added.set(cover.hash, cover.encoded);
  if (tune?.blob) {
    app.session?.store.addedAudio.set(tune.music.file, tune.blob);
    void syncMusic();
  }
  setEditing(true);
}

/**
 * The pencil at the start of the edit bar opens the settings — they are an
 * edit like any other. The look follows the open file as it is edited, undone
 * and closed (session.ts puts it on when it opens).
 */
export function setupProperties(): void {
  byId('timeline-settings').addEventListener('click', () => void timelineSettings());
  on('changed', () => applyStyle());
  on('closed', () => applyStyle(undefined));
}
