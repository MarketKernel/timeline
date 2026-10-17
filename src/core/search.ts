/**
 * Finding items by what they say: titles, texts, references, tags. Case, accents and ё/е do not matter. A title that
 * starts with the query ranks first, then a title that contains it, then the
 * rest; ties go in time order.
 */

import type { Item } from './model';
import { inTimeOrder } from './model';
import { plainText } from './markdown';

/** Lower case, without accents (ё loses its dots with them), every dash a hyphen. */
export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015]/g, '-');

/** What an item is searched by, normalized once: an edit replaces the item, so a stale entry is never read. */
interface Searchable {
  title: string;
  /** The title's words: a query matches the start of any. */
  words: string[];
  /** Its text, references and tags, as shown in a snippet and as matched. */
  rest: string[];
  restNorm: string[];
}

const searchable = new WeakMap<Item, Searchable>();

/**
 * Where in `text` the character at `at` of its normalized form comes from:
 * normalizing can change a text's length (an accent typed as a mark of its
 * own goes, Hangul comes apart), and the snippet is cut from the text itself.
 */
function sourceIndex(text: string, at: number): number {
  let length = 0;
  let index = 0;
  for (const char of text) {
    if (length >= at) break;
    length += normalize(char).length;
    index += char.length;
  }
  return index;
}

function searchableOf(item: Item): Searchable {
  let entry = searchable.get(item);
  if (!entry) {
    const title = normalize(item.title);
    const rest = [...(item.text ? [plainText(item.text)] : []), ...(item.refs ? [item.refs] : []), ...(item.tags ?? [])];
    entry = { title, words: title.split(/[\s\-–—,.:;«»"'()]+/), rest, restNorm: rest.map(normalize) };
    searchable.set(item, entry);
  }
  return entry;
}

export interface Hit {
  item: Item;
  score: number;
  /** A piece of text around the match, for the results list. */
  snippet: string;
}

export function search(items: readonly Item[], query: string, limit = 200): Hit[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: Hit[] = [];
  for (const item of items) {
    const { title, words: titleWords, rest, restNorm } = searchableOf(item);
    let score = 0;
    let ok = true;
    for (const word of words) {
      if (title.startsWith(word) || titleWords.some((part) => part.startsWith(word))) score += 3;
      else if (title.includes(word)) score += 2;
      else if (restNorm.some((text) => text.includes(word))) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    let snippet = '';
    const first = words[0]!;
    for (let i = 0; i < rest.length && !snippet; i++) {
      const found = restNorm[i]!.indexOf(first);
      if (found >= 0) {
        const text = rest[i]!;
        const at = sourceIndex(text, found);
        const from = Math.max(0, at - 30);
        snippet = (from > 0 ? '…' : '') + text.slice(from, at + 70).trim() + (at + 70 < text.length ? '…' : '');
      }
    }
    hits.push({ item, score, snippet });
  }
  // Ties in time order: inTimeOrder works out each hit's day once, the score then decides.
  const order = new Map(inTimeOrder(hits.map((hit) => hit.item)).map((item, i) => [item, i]));
  hits.sort((a, b) => b.score - a.score || order.get(a.item)! - order.get(b.item)!);
  return hits.slice(0, limit);
}
