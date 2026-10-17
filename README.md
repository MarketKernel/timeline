# Timeline

**English** · [Русский](docs/readme/README.ru.md)

A chronology viewer and editor in one HTML file. Time runs left to right, things
sit on it, you can grab them.

Timeline opens `.timeline` files — one per chronology: world history, the history of a
country, of science, of one's own life. A file is written in one language (a history of
flight in Russian is `flight.ru.timeline`, beside `flight.en.timeline`) and holds its own
texts and pictures; renamed to `.zip` it is a folder with a readable `timeline.json` and
ordinary images. The page holds no data at all, never touches the network, and works from a
disk.

- **The file**: `build/timeline.html` — download it, double-click it, open a `.timeline`.
- **The app**: the same page as a PWA on GitHub Pages, installable and offline.

## Using it

- **Open** a `.timeline` with the button, by dropping it on the page, or (in the installed
  app) by double-clicking it in the Finder or Explorer. Recent files are on the start
  screen; the browser remembers where they are, never what is in them.
- **Move**: drag to pan (with inertia), the wheel or the trackpad to pan, Ctrl/⌘ + wheel or
  a pinch to zoom around the pointer, a double click to zoom in (with Shift: out). The
  mini-map at the bottom shows everything; drag its frame or click anywhere on it.
- **Scale**: the button in the toolbar shows the current one ("1 px = 1 year") and offers a
  pixel for a unit: a minute, an hour, a day, a week, a month, a season (three months), a year, 10 years, a century,
  1,000, 10,000 and 100,000 years, a million years — only those that leave the file at least
  100 px wide (a life stops at a season, six thousand years of history at ten years). The wheel and the pinch zoom
  anywhere between; `−` and `+` step from one to the next; `0` fits everything. Dates go no
  finer than a day: a minute or an hour a pixel only pulls the days of a crowded week apart.
- **Read**: a click on a card, a bar or an era opens its details — the picture with its
  caption and credit, the date as precisely as the source gives it, references, the text,
  links, and previous/next in time. Search with `/` across titles, texts and references.
  The file's texts are shown in its own language whatever the interface speaks.
- **Second ruler**: years counted from the file's anchor (from a city's founding, from the
  first flight, the age in a life). Select a period and the ruler shows that person's age.
- **Measure**: hold Alt and drag along the ruler — "First flight → Moon landing: 66 years".
- **Edit**: the pencil (or `E`) turns edit mode on, and the edit bar appears under the
  toolbar. **Add** an event or a period there: pick one, then click on the strip where the
  event happened, or drag from where the period starts to where it ends; the editor opens
  with the dates filled in. **Eras** have their own editor, a list (the Eras button, or an
  era double-clicked): each row is a colour, a name and where the era begins — it ends
  where the next one begins, so eras never overlap; the last ends on a date or at the
  present day. Dates are typed as written ("c. 1446 BC", "14 Apr AD 30", "1517"), and each
  row shows the span and length it makes. A row splits in two, a deleted era's time goes
  to the one above, a row without a name is a gap; the pencil on a row opens the era's text
  and pictures. Drag a card anywhere to move it — its date stays, and a line joins the card
  to its dot; a date is changed only in the card's window. Drag a bar up or down into
  another row — its dates, too, are changed only in its window; drag the boundary between
  two eras (an edge alone stops at the next era). Drag a card's top right corner to make it **small, normal, large or huge** — a
  large card shows the large picture, not the thumb. `N` adds an event, `E` edits the
  focused one, Delete removes it (with undo). Drop photos on the strip: one event each, at
  the date the photo was taken; dropped on a card, they join its **gallery**. Every change
  can be undone (⌘/Ctrl Z, or the arrows in the edit bar).
- **Colours**: every era, period and event may have a colour of its own — the band, the
  bar, the dot and the mark on the card. The editor offers a palette of muted earth tones
  and any other colour; without one an item is a warm grey.
- **Events and periods** each have a window of their own, and one never turns into the
  other. An event's window adds its **size**, which is how much it matters — large and huge
  cards show even when the whole timeline is on the screen, normal ones from a little
  closer, small ones (footnotes) close up, each explained as it is picked — its pictures, a
  **card background** (the text turns dark or light to read on it), and its **shape**: a
  rectangle, or **round** — a medallion with its picture and the title under it, or a disc
  that holds the title, centred over its dot. A period has no pictures: photos dropped on
  its bar become events.
- **Crowded stretches**: a card is never shrunk or hidden for want of room. Where cards do
  not fit side by side, they lie over each other — a later event over an earlier one — and
  the one under the pointer comes to the top. Only zooming out hides cards, the smaller
  first.
- **Timeline settings** (the pencil at the start of the edit bar) belong to the file, not to
  the reader: its title, description and cover (any picture — chosen, from a library file,
  pasted or dropped); its **author**, if you like (a name, a website, a contact); the language
  of its texts; where it **begins and ends** (its first and
  last item, a date, or the present day — with an end the strip stops there, as it does at
  the start); the scale it opens at; and its **look** — the colour of the paper (kept in its
  hue and darkened in the dark theme), its texture (grain, plain, squares, lines, dots, graph
  paper), the colour of items without one of their own, serif or sans titles; and, if you
  like, **background music** (any MP3, M4A, WAV… file). Whoever opens the file sees the same;
  one undo takes it back.
- **Music**: a timeline's own music plays quietly, in a loop, while it is open — faded in,
  paused while the page is hidden. The speaker in the toolbar (shown only for a file with
  music) and Settings → "Play background music" turn it off for every file. Where the browser
  wants a click before any sound, the first click or key starts it.
- **Galleries**: an item has one picture or many. The first is on its card; a large card
  shows the next two beside it, a normal one a count. The details panel steps through them
  with arrows, thumbs or a swipe, and a click shows them full screen (← → to step, Esc to
  close). The editor orders them by drag, and each has its own caption and credit.
- **Save**: ⌘/Ctrl S writes back into the same file where the browser allows it (Chrome,
  Edge); elsewhere it downloads a copy, and on iOS the share sheet offers "Save to Files".
  Unsaved work is saved automatically every 30 seconds into the file, or kept as a recovery
  copy that is offered the next time the file is opened.
- **New timeline**: the same form as Timeline settings, on an empty file — a title, the
  dates it spans, a cover, the look, in the language you pick (the interface's unless you
  choose another). It opens in edit mode, ready for its first event.
- **Export as a web page** (in the ⋯ menu): the open timeline, unsaved changes included, as a
  page anyone reads in a browser and no one edits — it opens straight on the strip, with no
  start screen, no edit mode, nothing to save, and like the app it never touches the network.
  Its pictures and music go **inside the page** (one `.html`, a third larger than the
  `.timeline`) or **in a folder beside it**: a `.zip` of `<name>/index.html` and
  `<name>/media/`, to unpack and open from a disk or put on a website.
- **Print** ("Save as PDF") prints the visible range on one page — the poster export for now.
- **About** (the ⋯ menu, just before Close): the version and a link to the project's home,
  which is also on the start screen's last line.

### Keyboard

| Keys | Action |
| --- | --- |
| ← → | pan a quarter screen; with Shift a whole screen |
| + − 0 | zoom in, out, fit all |
| Home End T | start, end, today |
| / | search; ↑↓ walk the hits, Enter opens one |
| Tab, Shift+Tab | items in time order; Enter opens the details |
| E | edit the focused item (or toggle edit mode); N new event; Delete delete |
| Esc, Enter | while adding: put the kind down; fill in the form instead of clicking |
| ⌘/Ctrl Z, ⇧⌘Z | undo, redo |
| ⌘/Ctrl S | save |
| Esc | close the panel, the search, the measure |

### On a phone

One screen at a time: the details and the editor are bottom sheets (drag the handle down
to close). Pinch to zoom, double-tap to zoom in, long-press in edit mode to add an event
at that date.

## Privacy and security

- The single file's Content-Security-Policy is `default-src 'none'; connect-src 'none'`:
  the page cannot fetch anything, anywhere. Its one inline script is pinned by hash.
  Images and the background music are played from `blob:` URLs read out of the open file
  (`img-src blob: data:`, `media-src blob:`).
- The PWA allows its own origin only (`connect-src 'self'`) — for the shelf's files.
- An SVG inside a file is shown only through `<img>`, where its scripts never run; links in
  texts open in a new tab and are never fetched by the page.
- Photos you add are re-encoded through a canvas: the EXIF date is read first (to place
  the event), everything else — location included — is dropped with the original.
- Music you add goes into the file as it is, its own tags (artist, title) with it.

## The `.timeline` file

A zip, written and read by Timeline's own ~400 lines (no ZIP64; a file re-zipped by hand
in Finder still opens):

```text
timeline.json          the chronology: deflated, pretty-printed, keys in a fixed order
thumbs/<hash>.webp     192 px, what cards show
images/<hash>.webp     ≤ 1280 px, what the details panel shows (.svg and .png allowed)
audio/<hash>.mp3       the background music, if any, as it was added (.m4a .ogg .wav … too)
```

Every text in `timeline.json` is a plain string in the language its `"lang"` names; a
translation is another file. Pictures are named by the hash of their content, so duplicates collapse and renames never
break. Opening reads the zip's directory and `timeline.json` only — a picture is read when
its card scrolls into view, so five hundred photos cost nothing until looked at. Saving
copies untouched pictures byte for byte. Fields a newer version adds survive an edit in
this one. Dates are day numbers on the proleptic Gregorian calendar with astronomical
years (year 0 is 1 BC); a date keeps the precision its source gives.
[docs/format.md](docs/format.md) describes the format in full, for people and for agents
making chronologies, and `node tools/check.mjs FILE.timeline` checks a file as the app
reads it.

## Build

```sh
./build.sh         # installs the dependencies if needed, then builds build/timeline.html and build/pages/
npm install
npm run check      # typecheck → unit tests → build → the page and the PWA in Chrome
npm run build      # -> build/timeline.html and build/pages/
npm run watch      # rebuild on every change
npm test           # unit tests in Node
node tests/app.mjs --shots shots/   # the page in headless Chrome, with screenshots
```

Node 22+ and a local Chrome (for the browser tests, the screenshots and the icons;
`CHROME=/path/to/chrome` picks one). No runtime dependencies; esbuild and TypeScript to
build, and Node's own types (`@types/node`) so that `npm run typecheck` checks `tools/` and
`tests/` too.

## Translations

The English text lives in the code: `t('context', 'English text')`,
`tn('context', '{count} item', '{count} items', n)`, `data-i18n` in the template. Other
languages are `src/locales/<code>.json`. `npm run i18n` prints what a dictionary lacks or
no longer needs; `tests/i18n.mjs` fails on either. A new language is one JSON file and one
line in `LANGUAGES` (`src/core/i18n.ts`). Content is not translated by the app: a `.timeline`
is written in one language, and another language is another file.

`.github/workflows/test.yml` builds and tests every push and pull request and keeps
`build/timeline.html` as an artifact; a push to `main` runs it through `pages.yml`.

## Versions and releases

The version is written in one place, `package.json`. The build puts it into the page (the
start screen, the settings, `meta.generator` of every file saved) and into the PWA's cache
name. A build of the commit tagged `v<version>` shows it as it is; any other adds its
commit, `0.1.0+1a2b3c4`, so a page from `main` on GitHub Pages is not taken for the release.

```sh
npm version minor           # 0.1.0 -> 0.2.0: package.json, package-lock.json, a commit and the tag v0.2.0
git push --follow-tags      # the tag starts .github/workflows/release.yml
```

The release workflow stops if the tag and `package.json` disagree, then attaches
`timeline-<tag>.html` and `SHA256SUMS.txt`.

## GitHub Pages

`.github/workflows/pages.yml` runs `test.yml` on every push to `main`, then builds and deploys
`build/pages/` to GitHub Pages (Settings → Pages → Source: GitHub Actions). Each deploy
changes the cache name in `sw.js`, so the browser picks up the new worker by itself; the
installed app downloads the new version and waits for Update. An installed PWA runs
whatever the last deploy put there, while a downloaded file stays the version it is: for a
version fixed on disk, take `timeline-<tag>.html` from a release and compare it with
`SHA256SUMS.txt`.

The PWA can show a shelf of chronologies put beside it on the site (`library/index.json`
and the files it lists); the build puts none there. [docs/format.md](docs/format.md#a-library)
describes a library, and `node tools/check.mjs library/` checks one.

## Layout

| Path | |
| --- | --- |
| `build.mjs` | bundles `src/` into `build/timeline.html` (CSP, hash-pinned script, self-containment checks) and `build/pages/` |
| `src/core/dates.ts` | day numbers, precision, display in en/ru, parsing of source dates |
| `src/core/scale.ts` | the zoom: the presets (those a file can be shown at), "1 px = 1 year", the scale bar, the view |
| `src/core/ruler.ts` | ticks at any zoom, no year 0, the anchor ruler |
| `src/core/layout.ts` | cards in rows, over each other where they must; bars packed into rows |
| `src/core/zip.ts` | the zip: lazy reader, streamed writer, byte-for-byte copies |
| `src/core/library.ts` | a library's `index.json`: its rules, and which language of a chronology the shelf shows |
| `src/core/archive.ts` | reading a `.timeline` as the page and `tools/check.mjs` both do: the zip, `timeline.json`, the missing pictures and music |
| `src/core/model.ts` | the file's types, field-by-field validation, deterministic output |
| `src/core/commands.ts` | the undo stack |
| `src/core/eras.ts` | eras as a list: each row where an era begins, the end the day before the next; read, checked, written back |
| `src/core/style.ts` | a file's paper colour → the paper tones of the light and the dark theme (OKLCH) |
| `src/core/search.ts`, `markdown.ts`, `exif.ts`, `hash.ts`, `templates.ts`, `i18n.ts` | search, text, photo dates, hashes, a new file's id, languages |
| `src/app/view.ts` | the strip: cards, dots, eras, bars, rulers, panning and zooming |
| `src/app/minimap.ts`, `details.ts`, `gallery.ts`, `search.ts`, `reading.ts` | the mini-map, the details panel, its pictures and full screen, search, keyboard |
| `src/app/editing.ts`, `editor.ts` | edit mode on the strip (the edit bar, adding, drags, resizing, dropped photos, the keys); an item's dialog |
| `src/app/eras.ts`, `library.ts`, `images.ts` | the eras' list, pictures from another file, photo encoding and the image cache |
| `src/app/forms.ts` | what the forms are made of: a labelled field, a date, a colour picker, texts in the file's language |
| `src/app/session.ts`, `files.ts`, `recent.ts` | opening, saving, drafts, recent files |
| `src/app/export.ts`, `source.ts` | Export as a web page: this page as it was loaded, with the timeline inside; opening it read-only |
| `src/app/shelf.ts`, `update.ts`, `src/pwa/sw.js` | the PWA: the shelf, updates, the service worker |
| `src/app/properties.ts`, `look.ts` | Timeline settings and New timeline: the file's texts, cover, dates, opening scale and look; the look on the page |
| `src/app/music.ts` | a timeline's background music: playing, fading, pausing, the toolbar's speaker |
| `src/app/main.ts`, `settings.ts`, `ui.ts` | start-up, toolbar, settings, toasts and dialogs |
| `assets/` | the icon and the PWA's icons (`tools/icons.mjs` renders them from `icon.svg`) |
| `tools/` | `check` (files and libraries, as the app reads them), `shots`, `icons`, `i18n`, `chrome` (DevTools protocol), `load` (src/ for Node), `sample` (test files) |
| `docs/format.md` | the `.timeline` file and a library, for whoever makes them |
| `tests/` | unit tests per module; `app.mjs` and `pwa.mjs` in headless Chrome |

## Limitations

- Calendars are not converted: a date is drawn where its numbers fall on the proleptic
  Gregorian axis (Julian dates before 1582 sit up to 13 days off — invisible above the day
  scale).
- One file on the strip at a time; no piecewise scale, no links drawn between items, no
  PNG export yet (Task.md §13 lists what is deliberately later).
- A card made large keeps the size only where there is room for it: in a crowded stretch it
  is drawn at the normal size (the editor says so when that happens right after a resize).
- Saving into the same file needs File System Access (Chrome, Edge); other browsers
  download a copy.
