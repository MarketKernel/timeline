# Making chronologies and libraries

How to write `.timeline` files and a library of them for Timeline's shelf, whether you are
a person with a text editor and a zip tool or an agent generating them. Everything here is
what the app actually reads: `src/core/model.ts` validates a file, `src/core/zip.ts`
unpacks it, `src/core/archive.ts` puts the two together and finds what is missing,
`src/core/library.ts` and `src/app/shelf.ts` read a library. When this page and the code
disagree, the code is right and this page is a bug.

**Contents:** [In short](#in-short) · [A first file](#a-first-file-step-by-step) ·
[The container](#the-container) · [timeline.json](#timelinejson) · [Dates](#dates) ·
[Items](#items) · [Pictures](#pictures) · [Music](#music) · [The rest of the file](#the-rest-of-the-file) ·
[Languages](#languages) · [Limits](#limits) · [A library](#a-library) ·
[Checking](#checking) · [For agents](#for-agents)

## In short

- A **chronology** is one `.timeline` file: a zip holding `timeline.json` and, beside it,
  the pictures and the music it uses.
- A file is written in **one language**. The same chronology in Russian is another file.
- A **library** is a folder `library/` next to the PWA's `index.html` on a website:
  `.timeline` files, their covers and `index.json`, which lists them — or lists files kept
  on another site, by address. The PWA's start screen shows it as a shelf, as at
  [time.marketkernel.com](https://time.marketkernel.com/). The single-file `timeline.html` has no shelf: it opens files
  from the disk.
- Timeline itself contains no chronologies. Files are made elsewhere: by hand, by a
  script or by an agent, or in the app ("New timeline", then Save).
- Check what you made with `node tools/check.mjs` (see [Checking](#checking)). It reads
  files exactly as the app does.

## A first file, step by step

1. Make a folder, `moon/`, and in it a `timeline.json`:

   ```json
   {
     "format": "timeline",
     "version": 1,
     "lang": "en",
     "meta": { "id": "moon-en", "kind": "history" },
     "title": "To the Moon",
     "images": {},
     "items": [
       { "id": "sputnik", "kind": "event", "start": { "y": 1957, "m": 10, "d": 4 }, "title": "Sputnik", "size": "large" },
       { "id": "apollo-11", "kind": "event", "start": { "y": 1969, "m": 7, "d": 20 }, "title": "Apollo 11", "text": "*One small step.*" },
       { "id": "space-race", "kind": "period", "start": { "y": 1957 }, "end": { "y": 1975 }, "title": "The space race" }
     ]
   }
   ```

2. Add pictures, if you want any: see [Pictures](#pictures).
3. Zip the folder's contents, not the folder (the folder is accepted too, see below):

   ```sh
   cd moon && zip -qrX ../moon.en.timeline . && cd ..
   ```

4. Check it: `node tools/check.mjs moon.en.timeline`.
5. Open it in `timeline.html`, or drop it on the page.

## The container

A `.timeline` is an ordinary zip:

```text
timeline.json            the chronology (required)
images/<hash>.<ext>      a picture, as large as the details panel shows it (webp, png, jpg, svg)
thumbs/<hash>.webp       the same picture small, for cards (optional, recommended)
audio/<hash>.<ext>       the background music (optional)
```

- **Compression:** an entry may be deflated or stored, nothing else. No encryption and no
  ZIP64, so the whole file must stay under 4 GB and 65,535 entries. File names are UTF-8.
- **One top folder is allowed:** if `timeline.json` is not at the top but is in exactly one
  folder (`moon/timeline.json`), that folder is the root. This is what zipping a folder in
  Finder or Explorer produces.
- **Junk is ignored:** `__MACOSX/`, `._*`, `.DS_Store`, `Thumbs.db`, `desktop.ini` and
  directory entries.
- **Other entries are kept:** anything else in the zip (`README.txt`, `sources/…`) opens
  fine and survives a save in the app untouched.
- **Order:** any. The app writes `timeline.json` first; you do not have to.
- **Name:** `<chronology>.<lang>.timeline` by convention (`moon.en.timeline`,
  `moon.ru.timeline`). The app does not care about the name.

`.timeline` is only a name: rename the file to `.zip` and any tool opens it. The app also
opens a bare `timeline.json` (no pictures). This is meant for authors working on a draft.

## timeline.json

UTF-8 JSON, one object. Only `format` is strictly required. Without a `title`, an `id` or
`items` the file still opens, with a warning and defaults. A field the app does not
understand is **left out with a warning**. One bad item is skipped and the rest open. The
app never shows a blank screen for one mistake.

| Field | Type | |
| --- | --- | --- |
| `format` | `"timeline"` | **Required.** Anything else is refused: "This is not a timeline". |
| `version` | integer ≥ 1 | `1` today. A larger number opens with a "made by a newer version" warning. |
| `lang` | BCP 47 code | The language of every text in the file: `en`, `ru`, `pt-BR`. English when left out. |
| `meta` | object | `id`, `kind`, `created`, `modified`, `generator`: see below. |
| `title` | string | The chronology's name. "Untitled" when left out. |
| `description` | string | What it is about, a sentence or two. Kept in the file and edited in Timeline settings. |
| `sources` | string | Where the dates come from. Kept with the file; the app does not show it. |
| `author` | object | Who made the chronology, every part optional: `name`, `url` (their website, `https://…` or `http://…`), `contact` (an e-mail, a phone, a handle — as written). Edited in Timeline settings; a reader sees it under ⓘ beside the title. |
| `start`, `end` | [date](#dates) | Where the chronology begins and ends, if not at its first and last item. `end` may be `{ "now": true }`. |
| `cover` | image hash | The picture that stands for the file in Recent. It must be in `images`. |
| `anchor` | object | The second ruler: years counted from a date or an item. See below. |
| `style` | object | The look: paper, texture, default colour, title font. See below. |
| `music` | object | Background music. See [Music](#music). |
| `images` | object | One entry per picture, keyed by hash. See [Pictures](#pictures). |
| `items` | array | Events, periods and eras. See [Items](#items). |
| `view` | object | What a reader sees first: a centre date and a scale. See below. |

### meta

| Field | | |
| --- | --- | --- |
| `id` | `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$` | The file's identity. Make it unique per file **and per language** (`moon-en`, `moon-ru`). The app remembers a reader's position and unsaved drafts by it. |
| `kind` | `"history"` \| `"life"` | `history` (the default) opens on the whole chronology. `life` opens at today, with weeks on the ruler. |
| `created`, `modified` | string | Dates, `"2026-10-17"`. The app sets `created` when it makes a file and `modified` on save; ⓘ beside the title shows `created`. |
| `generator` | string | What wrote the file: `"timeline 0.1.0"`, `"my-script 2"`. |

## Dates

A date is an object with the precision its source has. **Never make a date more precise
than you know it to be:** a year alone is a valid date.

```jsonc
{ "y": 1969 }                       // sometime in 1969
{ "y": 1969, "m": 7 }               // July 1969
{ "y": 1969, "m": 7, "d": 20 }      // 20 July 1969
{ "y": -1445, "approx": true }      // c. 1446 BC
{ "y": 2040, "approx": true, "spread": 5 }  // c. 2040, give or take 5 years
```

| Field | | |
| --- | --- | --- |
| `y` | integer, −999,999 … 999,999 | **Astronomical year:** year `0` is 1 BC, `-1` is 2 BC. **A year N BC is written `1 − N`:** 4004 BC → `-4003`, 1446 BC → `-1445`, AD 30 → `30`. |
| `m` | 1–12 | The month; leave it out for a year-only date. |
| `d` | 1 … days in that month | The day. Only with `m`. 29 February only in a leap year (proleptic Gregorian). |
| `approx` | `true` | Shown as "c." (Russian «ок.»). Leave it out rather than writing `false`. |
| `spread` | number, > 0, ≤ 100,000 | Give or take this many **years**: a soft halo around the dot. |

- **Calendar:** there is one axis, the proleptic Gregorian calendar. Dates are not
  converted from Julian or other calendars. Write a date's numbers as your source gives
  them.
- **Where it is drawn:** an event sits in the middle of the span its date names. A
  year-only event sits in mid-year, a month-only event in mid-month.
- **An end is inclusive:** a period `{ "y": 1957 } → { "y": 1975 }` runs to the last day
  of 1975. `{ "y": 1975, "m": 7 }` as an end means to the end of July.
- **The present:** an end may be `{ "now": true }`. It moves with today's date.
- **End before start:** in a period or an era, the two dates are swapped, with a warning.

## Items

Every item has an `id`, a `kind`, a `start` and a `title`. Items may come in any order:
the app sorts them by date when it saves.

| Field | Kinds | |
| --- | --- | --- |
| `id` | all | **Required.** Same pattern as `meta.id`, unique in the file. A second item with the same id is dropped. Readable slugs are best: `nicaea-325`. |
| `kind` | all | **Required.** `"event"`, `"period"` or `"era"`. |
| `start` | all | **Required.** A [date](#dates). |
| `end` | period, era | **Required for these two**, forbidden for an event (dropped). A date or `{ "now": true }`. |
| `title` | all | Short: it is what a card or a bar shows. The id is used when it is missing. |
| `text` | all | The details panel's text, in [markdown-lite](#texts). |
| `refs` | all | References, a plain string: `"Gen 6–9"`, `"Smithsonian"`. Shown under the text, searched. |
| `links` | all | Array of URLs, `http(s)://` or `mailto:` only. Others are dropped. |
| `tags` | all | Array of strings, shown as `#tag`, searched. |
| `color` | all | `"#rrggbb"` or `"#rgb"`: the card's mark, the dot, the bar, the era's band. A warm grey (or `style.color`) when left out. |
| `image` | all | An image hash from `images`: the card's picture. |
| `gallery` | all | More image hashes, in order, after `image`. |
| `size` | event | `"small"`, `"large"` or `"huge"`; normal when left out. See below. |
| `shape` | event | `"round"`: a medallion with the picture, or a disc that holds the title. A rectangle when left out. |
| `background` | event | `"#rrggbb"`: the card's own fill. The text turns light or dark to stay readable. |
| `lane` | event, period | 0–99: a row fixed by hand. Normally left out: the app lays rows out itself. |
| `shift` | event | An integer, −5,000 … 5,000: px the card was moved by hand to the right of where it would stand (negative: to the left). The date and its dot stay; a line joins the card to them. Normally left out. |

**The three kinds:**

- **event**: something that happened on a date. A card above the axis with a dot on it.
- **period**: something that lasted, such as a life, a reign or a war. A bar in the rows
  under the axis. Periods may overlap freely. A period can have pictures in the file, but
  the app's editor offers none for it.
- **era**: a stretch of the whole chronology. A coloured band along the axis. Eras should
  **follow one another without overlapping**: each one begins after the previous one ends.
  The app's Eras editor treats them as a list where each era ends the day before the next
  begins. A gap between two eras is allowed.

**Size is importance.** It decides when a card appears:

| `size` | Shown | Use for |
| --- | --- | --- |
| `huge`, `large` | at every zoom, even the whole chronology at once | what a one-page summary would mention |
| *(normal)* | from a little closer | what a chapter would mention |
| `small` | only close up (and only with "Show small events" on) | footnotes |

A dense century still reads if most of its events are normal or small. If every event is
large, the cards pile on top of each other: cards are never shrunk. Where they do not fit,
later ones lie over earlier ones.

### Texts

Plain strings in the file's `lang`. In `text` (and only there), a markdown-lite is
understood: paragraphs (a blank line, `\n\n`), line breaks (`\n`), `*em*` or `_em_`,
`**strong**`, `[label](https://…)` and bare `https://…` addresses. Nothing else, and **no
HTML**: tags are shown as text.

## Pictures

A picture is a file in the zip **and** an entry in `images`. The JSON never holds image
bytes:

```jsonc
"images": {
  "253f677cad51408c": {
    "ext": "webp", "w": 1280, "h": 853,
    "caption": "Earthrise, 24 December 1968",
    "credit": { "author": "William Anders", "source": "NASA", "license": "Public domain", "url": "https://…" }
  }
}
```

| Field | | |
| --- | --- | --- |
| *(key)* | 8–64 lowercase hex characters | The picture's **hash**, which is also its file name. |
| `ext` | `"webp"`, `"png"`, `"jpg"`, `"svg"` | The large file's extension: `images/<hash>.<ext>`. **`jpg`, never `jpeg`.** |
| `w`, `h` | integers, 1 … 100,000 | The large image's size in pixels. Cards are laid out from these before any picture loads; without them a picture is laid out as a square until it loads. |
| `caption` | string | Shown under the picture in the details panel. |
| `credit` | object | `author`, `source`, `license` (strings), `url` (`http(s)` or `mailto`). |

**Files.** For each entry:

- `images/<hash>.<ext>` (required): the large picture for the details panel and full
  screen. Up to **1280 px** on the longer side is what the app makes itself, and is
  plenty. WebP at quality ~0.82 is the best size for the quality. PNG, JPEG and SVG are
  shown as they are. An SVG is shown only through `<img>`, so its scripts never run.
- `thumbs/<hash>.webp` (optional, recommended): **192 px** on the longer side, **WebP
  only**. Cards show it. Without it a card loads the large image instead: this works, but
  is slower in a file with hundreds of pictures.

**The hash.** Any lowercase hex string of 8 to 64 characters works. The app's convention,
which keeps duplicates from piling up, is the **first 16 hex characters of the SHA-256 of
the large image's bytes**:

```sh
shasum -a 256 images/photo.webp | cut -c1-16      # macOS; sha256sum on Linux
magick in.jpg -resize '1280x1280>' -quality 82 large.webp          # the large image
magick in.jpg -resize '192x192>'   -quality 80 thumb.webp          # the thumb
```

Hash the large file, then name both `images/<hash>.webp` and `thumbs/<hash>.webp`.

**Using a picture:** set an item's `image` (and `gallery`) or the file's `cover` to the
hash. An entry in `images` that no item uses is allowed. The app drops it, and its files,
on its next save. A hash an item names that is not in `images` is a "missing image"
warning, and the card shows no picture.

## Music

Optional background music, played quietly in a loop while the file is open. The reader can
turn it off.

```json
"music": { "file": "9c1e0b7d2a4f6e83", "ext": "mp3", "title": "Bach, Air on the G string",
           "credit": { "author": "…", "license": "CC BY 4.0", "url": "https://…" } }
```

- The bytes go in `audio/<file>.<ext>`. `file` is a hash like a picture's (SHA-256 of the
  audio file, first 16 hex characters, by convention).
- `ext`: `mp3`, `m4a`, `aac`, `ogg`, `opus`, `wav`, `webm` or `flac`. Stored as given and
  never re-encoded, so mind the size: a few MB of MP3 or M4A is right.
- Only one piece of music per file.

## The rest of the file

### anchor: the second ruler

A second row of numbers under the axis, counting years from a moment: the years of a city
since its founding, the years of flight, a person's age.

```jsonc
"anchor": { "at": { "y": 1703, "m": 5, "d": 27 }, "label": "Year of the city", "base": 1 }   // from a date
"anchor": { "item": "birth", "label": "Age" }                     // from an item's start
```

`at` (a date) or `item` (an item's id). `label` names the ruler. `base` (integer, `0` by
default) is the number of the anchor's own year: `1` for a count whose first year is year 1
(the founding year is the city's first), `0` for an age.

### style: the look

Every field is optional, and a file without `style` looks like the app.

| Field | | |
| --- | --- | --- |
| `paper` | `"#rrggbb"` | The paper's colour. It keeps its hue; its lightness is adjusted so that text reads, and it is darkened in the dark theme. |
| `texture` | `grain` (default), `plain`, `grid`, `lines`, `dots`, `graph` | What is printed on the paper. |
| `color` | `"#rrggbb"` | The colour of items without one of their own. |
| `font` | `serif` (default), `sans` | The face of titles. |

### view: the opening view

```json
"view": { "center": { "y": 1960 }, "scale": { "px": 1, "unit": "month", "count": 1 } }
```

- `scale` is "`px` pixels = `count` `unit`s". `unit` is one of `minute`, `hour`, `day`,
  `week`, `month`, `season`, `year`, `decade`, `century`, `millennium`. The scale menu's
  presets are 1 px per minute, hour, day, week, month, season, year, 10 years
  (`year` × 10), century, and 1,000, 10,000, 100,000 and 1,000,000 years (`year` ×
  that many).
- Without `center` the view opens at the start, or at today for a chronology that ends
  `now`. Without `view` the whole chronology is fitted on the screen (`history`) or the
  view opens at today (`life`).
- A reader who has opened the file before returns to where they were. `view` is only the
  first time.

### Unknown fields: forward compatibility

A field this version does not know is **kept** on the file itself and on `meta`, items,
`images` entries, credits, `anchor`, `style`, `music` and `view`: the app carries it
through an edit and a save unchanged. Inside a date only `y`, `m`, `d`, `approx` and
`spread` survive. Unknown zip entries are kept too. You may add your own fields (`"wikidata": "Q43653"`
on an item), and a newer Timeline may add fields an older one keeps without understanding.
Do not rely on unknown fields being shown.

## Languages

- **One language per file.** `lang` names it, and every text is a plain string in it. No
  `{ "en": …, "ru": … }` objects: they are not understood, and the field is dropped.
- **A translation is a copy** of the file with the texts translated, its own `lang` and
  its own `meta.id` (`moon-en`, `moon-ru`). Keep item ids, dates, pictures and hashes the
  same, so the two files stay comparable.
- Dates, rulers and buttons follow the reader's interface language. The texts are shown
  as written, whatever the interface speaks.
- On a shelf, the files of one chronology share a `group` (see below). The reader sees one
  cover, in their language when there is a file in it, with the others listed under it.

## Limits

| What | Limit |
| --- | --- |
| A year | −999,999 … 999,999 |
| `spread` | > 0, ≤ 100,000 years |
| An id (`meta.id`, item `id`) | `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$` |
| A hash (pictures, music) | `^[0-9a-f]{8,64}$` |
| A picture's `w`, `h` | 1 … 100,000 |
| `lane` | 0 … 99 |
| `shift` | −5,000 … 5,000, an integer |
| A colour | `#rgb` or `#rrggbb` (stored lowercase, six digits) |
| A URL (`links`, `credit.url`) | `http://`, `https://` or `mailto:`, no spaces |
| The zip | < 4 GB, < 65,535 entries, deflate or store, no encryption |

Practical sizes: the app opens a file with a thousand items and five hundred pictures in
a fraction of a second, because it reads a picture only when its card comes into view.
About 60 MB per 500 pictures (both sizes, WebP) is normal.

## A library

A library is a **folder named `library/` next to the PWA's `index.html`**, on the same
site:

```text
index.html, sw.js, manifest.webmanifest …     the PWA (build/pages/)
library/
  index.json                                  the list (required)
  moon.en.timeline                            the files
  moon.ru.timeline
  flight.en.timeline
  covers/moon.webp                            covers (optional)
```

### index.json

```json
{
  "format": "timeline-library",
  "version": 1,
  "files": [
    {
      "id": "moon-en", "group": "moon", "lang": "en",
      "file": "moon.en.timeline",
      "title": "To the Moon", "description": "The space race, from Sputnik to Apollo 17.",
      "kind": "history", "span": "1957 – 1975",
      "items": 42, "images": 12, "size": 5242880,
      "cover": "covers/moon.webp"
    },
    {
      "id": "moon-ru", "group": "moon", "lang": "ru",
      "file": "moon.ru.timeline",
      "title": "К Луне", "description": "Космическая гонка от спутника до «Аполлона-17».",
      "kind": "history", "span": "1957 – 1975",
      "items": 42, "images": 12, "size": 5243112,
      "cover": "covers/moon.webp"
    }
  ]
}
```

| Field | | |
| --- | --- | --- |
| `format`, `version` | `"timeline-library"`, `1` | What the list is. |
| `id` | string | Unique in the list. Use the file's `meta.id`. |
| `group` | string | The chronology this file is one language of: the same for `moon.en` and `moon.ru`. One cover per group on the shelf. |
| `lang` | string | The file's `lang`. Which file a reader sees: their interface's language, else English, else the first in the list. |
| `file` | path or address | The `.timeline`, relative to `library/`, or an `https://` address on another site (see [Files on another site](#files-on-another-site)). |
| `title` | string | Under the cover, in the file's language. |
| `description` | string | The cover's tooltip. May be empty. |
| `kind` | `history` \| `life` | The file's `meta.kind`. |
| `span` | string | Shown under the title as it is: write it in the file's language (`"1957 – now"`, `"1957 – сейчас"`). May be empty when `items` is `0`: such a file shows its picture count instead. |
| `items` | integer | The number of items, shown as "42 items". If `0`, the shelf shows `images` as "12 pictures" instead, which suits a file that is a collection of pictures. |
| `images` | integer | The number of entries in the file's `images`. |
| `size` | integer | The file's size in bytes, shown beside "Keep offline". |
| `cover` | path, address or `null` | A picture relative to `library/`, or an `https://` address (WebP, PNG, JPEG or SVG). The shelf shows it 3 : 2, cropped to fill; 480 × 320 px is plenty. `null` shows a plain cover. |

The shelf shows the chronologies in the order of `files`, each where its first file is.

### Files on another site

`index.json` itself is always `library/index.json` beside the PWA, but the files and covers
it lists may be on another site, by full address:

```json
"file": "https://timelines.example.org/moon.en.timeline",
"cover": "https://timelines.example.org/covers/moon-en.webp"
```

- **https:// only**, and the other site must allow it: every file and cover needs the
  header `Access-Control-Allow-Origin: *` (or the PWA's own origin). Without it the shelf
  cannot open the file or keep it offline.
- **The PWA is built for those sites.** It may fetch only what its policy names, so the build
  reads the library's `index.json` and adds every site it finds there to `connect-src` and
  `img-src` (`npm run build -- --library library/`). A site added to `index.json` later,
  without a new build, is not reachable.
- "Keep offline" works the same way: the file is stored in the browser and read from there
  first.
- `tools/check.mjs` does not fetch them: check the files where they are made.

### Publishing and updating

- **Same site, or a site the build was told about.** The PWA fetches from its own origin,
  and from the other sites its library's `index.json` lists files on (above). `index.json`
  itself must be beside the PWA.
- **This repository's GitHub Pages:** `npm run build` empties `build/pages/`, and the
  Pages workflow (`.github/workflows/pages.yml`) uploads that folder as it is. It builds with
  `--library library`, which copies this repository's `library/` into
  `build/pages/library/` and lets the page reach the sites its `index.json` names. Your own
  server: put `library/` beside `index.html`, or build with `--library` as well.
- **"Keep offline"** stores a file in the browser, and the stored copy is used first
  after that. `index.json` is always fetched fresh when online. **To publish a changed
  file, give it a new name** (`moon.en.2.timeline`) and point `index.json` at it, or
  readers who kept the old one keep seeing it.
- A shelf file opens read-only from the server. The reader's "Save" makes their own copy.

## Checking

```sh
node tools/check.mjs moon.en.timeline        # one file, or several
node tools/check.mjs library/                # index.json and every file it lists
```

Run it from this repository (`npm install` first). It uses the app's own zip reader and
model, and reports:

- **✗ problems** (the run fails): a file that does not open; a field the app would drop;
  a skipped item; a picture or the music named but not in the zip; `index.json` entries
  whose `lang`, `items`, `images` or `size` disagree with the file, or whose file or cover
  is missing; duplicate ids, or two files of one group in one language.
- **· notes** (the run passes): pictures without a thumb.

A file that passes opens in the app with no warning. Look at it in the app anyway: the
checker cannot tell you that every card is `large`.

## For agents

To make a chronology:

1. Collect the facts with their real precision: a year when only the year is known,
   `approx` when the source says "about", `spread` when it gives a range of years.
2. Convert BC years: **`y = 1 − N`** for N BC. Check two or three by hand.
3. Write the items. Give each a readable `id` (`kebab-case`, unique), the right `kind`
   (an `end` for every period and era, none for events), a short `title`, and a `text`
   of a few sentences in markdown-lite. Grade the `size`: about one event in ten `large`,
   most normal, the details `small`.
4. Make eras a tidy sequence: sorted, each starting after the previous ends, ending at
   `{ "now": true }` if the chronology reaches today.
5. Pictures: for each, make `images/<hash>.webp` (≤ 1280 px) and `thumbs/<hash>.webp`
   (192 px), hash the large file, add the `images` entry with `ext`, the real `w` and `h`,
   a `caption` and a `credit` with the license. Never write image bytes into the JSON.
6. Set `meta.id` (unique, with the language: `moon-en`), `meta.kind`, `lang`, `title`,
   `description`, and a `cover`.
7. Zip the contents (`zip -qrX ../name.lang.timeline .` inside the folder), then run
   `node tools/check.mjs` and fix every ✗.
8. For another language, copy the folder, translate the texts (titles, `text`, captions,
   `description`, era names, `anchor.label`), change `lang` and `meta.id`, and keep
   everything else.

To make a library: write the files, put them in `library/` with their covers, write
`index.json` from the files themselves (count `items` and `images`, take `size` from
the file on disk, `lang` and `kind` from the file), then run
`node tools/check.mjs library/`.

Common mistakes, and what the app does with them:

| Mistake | What happens |
| --- | --- |
| `"y": -4004` for 4004 BC | Off by a year: that is 4005 BC. |
| A period or era without `end` | The item is skipped. |
| An event with `end` | `end` is dropped. Use a period. |
| `"ext": "jpeg"` | The picture is dropped. Write `jpg`. |
| A thumb as `.jpg` or `.png` | Not found. Thumbs are `thumbs/<hash>.webp` only. |
| Texts as `{ "en": …, "ru": … }` | The field is dropped. One language per file. |
| HTML in `text` | Shown as literal text. Use markdown-lite. |
| Every event `large` | Cards pile up. Grade the sizes. |
| `d` without `m`, or 30 February | The date is invalid and the item is skipped. |
| Two files with the same `meta.id` | They share the reader's remembered position and drafts. |
| An `index.json` written by hand and not re-checked | The shelf shows wrong counts and sizes. |
