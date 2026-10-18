/**
 * A library: library/index.json beside the PWA, listing .timeline files (docs/format.md,
 * "A library"). The shelf (shelf.ts) shows it; tools/check.mjs holds an index to the same
 * rules, and to the files it lists. A file or a cover is a path relative to library/, or an
 * https:// address on another site; build.mjs lets the PWA reach the sites an index names.
 */

export interface LibraryEntry {
  id: string;
  /** The chronology this file is one language of: one key for all its language files. */
  group: string;
  lang: string;
  /** Relative to library/, or an https:// address on another site — the same for `cover`. */
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

export const LIBRARY_FORMAT = 'timeline-library';

/** A `file` or a `cover` on another site rather than beside index.json: anything with a scheme, or `//host`. */
export const isElsewhere = (path: string): boolean => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(path);

/** What is wrong with a file's or a cover's address, if anything: another site must be reached over https. */
function addressProblem(path: string): string | null {
  if (!isElsewhere(path)) return null;
  try {
    return path.startsWith('https://') && new URL(path).host ? null : 'must be a path relative to library/ or an https:// address';
  } catch {
    return 'is not a valid address';
  }
}

/** What is wrong with an index.json, entry by entry (`files[2]`), in plain English for whoever made it. */
export function indexProblems(index: unknown): { where: string; text: string }[] {
  const problems: { where: string; text: string }[] = [];
  const problem = (where: string, text: string) => problems.push({ where, text });
  const json = (index && typeof index === 'object' ? index : {}) as { format?: unknown; files?: unknown };
  if (json.format !== LIBRARY_FORMAT) problem('index.json', `format must be "${LIBRARY_FORMAT}"`);
  if (!Array.isArray(json.files)) {
    problem('index.json', 'files must be a list');
    return problems;
  }
  const ids = new Set<unknown>();
  const languages = new Set<string>();
  for (const [i, value] of (json.files as unknown[]).entries()) {
    const where = `files[${i}]`;
    const entry = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    for (const key of ['id', 'group', 'lang', 'file', 'title', 'span']) {
      // A collection of pictures (no items) shows its picture count, not a span: it may leave span empty.
      if (key === 'span' && entry.items === 0 && typeof entry.span === 'string') continue;
      if (typeof entry[key] !== 'string' || !entry[key]) problem(where, `${key} must be a non-empty string`);
    }
    for (const key of ['items', 'images', 'size']) {
      if (!Number.isInteger(entry[key]) || (entry[key] as number) < 0) problem(where, `${key} must be a whole number`);
    }
    for (const key of ['file', 'cover']) {
      const wrong = typeof entry[key] === 'string' ? addressProblem(entry[key] as string) : null;
      if (wrong) problem(where, `${key} ${wrong}`);
    }
    // Repeats are looked for among the fields that are there: a missing one is said above, once.
    if (typeof entry.id === 'string') {
      if (ids.has(entry.id)) problem(where, `a second id "${entry.id}"`);
      ids.add(entry.id);
    }
    if (typeof entry.group === 'string' && typeof entry.lang === 'string') {
      const language = `${entry.group}|${entry.lang}`;
      if (languages.has(language)) problem(where, `a second "${entry.lang}" file of the group "${entry.group}"`);
      languages.add(language);
    }
  }
  return problems;
}

/**
 * The shelf's chronologies: a group's language files together, each shown
 * once — in `lang` where there is such a file, else in English, else the
 * first — with the other languages beside it.
 */
export function shelfGroups(entries: readonly LibraryEntry[], lang: string): { shown: LibraryEntry; others: LibraryEntry[] }[] {
  const groups = new Map<string, LibraryEntry[]>();
  for (const entry of entries) {
    const key = entry.group ?? entry.id;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()].map((files) => {
    const shown = files.find((f) => f.lang === lang) ?? files.find((f) => f.lang.split('-')[0] === lang) ?? files.find((f) => f.lang === 'en') ?? files[0]!;
    return { shown, others: files.filter((f) => f !== shown) };
  });
}
