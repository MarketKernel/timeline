/**
 * What "New timeline" needs beyond the form (Task §4.2): an id for the file,
 * made from its title and kept ASCII whatever language the title is in.
 */

const CYRILLIC: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

/**
 * The id of a new file, from its title: "The History of the USA" →
 * "the-history-of-the-usa". Cyrillic is transliterated before accents are
 * stripped — stripping first would make й an и and ё an е — and the id is cut
 * last, once a letter has become the two or three it is spelled with, so it
 * stays within what a file's id may be.
 */
export function newDocId(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[а-яё]/g, (c) => CYRILLIC[c] ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'timeline'
  );
}
