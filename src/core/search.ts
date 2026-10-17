/**
 * Finding items by what they say: titles, texts, references, tags. Case, accents and ё/е do not matter. A title that
 * starts with the query ranks first, then a title that contains it, then the
 * rest; ties go in time order.
 */

import type { Item } from './model';
import { compareItems } from './model';
import { plainText } from './markdown';

export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[‐-―]/g, '-');

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
    const titles = [normalize(item.title)];
    const rest = [...(item.text ? [plainText(item.text)] : []), ...(item.refs ? [item.refs] : []), ...(item.tags ?? [])];
    const restNorm = rest.map(normalize);
    let score = 0;
    let ok = true;
    for (const word of words) {
      if (titles.some((title) => title.startsWith(word) || title.split(/[\s\-–—,.:;«»"'()]+/).some((part) => part.startsWith(word)))) score += 3;
      else if (titles.some((title) => title.includes(word))) score += 2;
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
      const at = restNorm[i]!.indexOf(first);
      if (at >= 0) {
        const from = Math.max(0, at - 30);
        snippet = (from > 0 ? '…' : '') + rest[i]!.slice(from, at + 70).trim() + (at + 70 < rest[i]!.length ? '…' : '');
      }
    }
    hits.push({ item, score, snippet });
  }
  hits.sort((a, b) => b.score - a.score || compareItems(a.item, b.item));
  return hits.slice(0, limit);
}
