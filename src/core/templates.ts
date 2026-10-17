/**
 * What "New timeline" needs beyond the form (Task §4.2): an id for the file,
 * made from its title and kept ASCII whatever language the title is in.
 */

const slug = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9а-яё]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'timeline';

/**
 * The id of a new file, from its title: "The History of the USA" →
 * "the-history-of-the-usa". Cyrillic is transliterated: an id stays ASCII.
 */
export function newDocId(text: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  return slug(text).replace(/[а-яё]/g, (c) => map[c] ?? '').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'timeline';
}
