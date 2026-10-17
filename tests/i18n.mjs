/**
 * The dictionaries in src/locales against the strings the interface shows:
 * no stale keys, one object per context, the same placeholders as the English
 * text, a form for every plural category — and the lookup itself. A string a
 * dictionary lacks fails the test (the page would show it in English); `--lenient` only reports it.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checker, load, root } from '../tools/load.mjs';
import { compare, dictionaries, extract } from '../tools/i18n.mjs';

const { check, done } = checker();
const I = await load('core/i18n');
const strings = await extract();
const all = await dictionaries();
const strict = !process.argv.includes('--lenient');
const placeholders = (text) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();

check('a dictionary per language', Object.keys(all).sort(), Object.keys(I.LANGUAGES).filter((code) => code !== 'en').sort());

for (const [language, dictionary] of Object.entries(all)) {
  // JSON.parse keeps the last of two equal keys and silently loses the first.
  const raw = await readFile(join(root, 'src', 'locales', `${language}.json`), 'utf8');
  const contexts = [...raw.matchAll(/^ {2}"([^"]+)": \{/gm)].map((m) => m[1]);
  check(`${language}: each context once`, contexts.filter((c, i) => contexts.indexOf(c) !== i), []);

  const { missing, unused } = compare(strings, dictionary);
  check(`${language}: no unused strings`, unused, []);
  const lacking = Object.entries(missing).flatMap(([context, texts]) => Object.keys(texts).map((text) => `${context} / ${text}`));
  if (strict) check(`${language}: nothing missing`, lacking, []);
  else if (lacking.length) console.log(`  ${language}: ${lacking.length} strings not translated (shown in English)`);

  const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories.slice().sort();
  const problems = [];
  for (const [context, texts] of Object.entries(dictionary)) {
    for (const [text, value] of Object.entries(texts)) {
      const forms = strings[context]?.[text];
      if (forms === undefined) continue;
      const expected = placeholders(text);
      if (forms === null || typeof value === 'string') {
        if (typeof value !== 'string' || !value.trim()) problems.push(`${context} / ${text}: not a text`);
        else if (JSON.stringify(placeholders(value)) !== JSON.stringify(expected)) problems.push(`${context} / ${text}: placeholders ${placeholders(value)}`);
        continue;
      }
      if (!value || typeof value !== 'object') {
        problems.push(`${context} / ${text}: neither a text nor plural forms`);
        continue;
      }
      if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(categories)) {
        problems.push(`${context} / ${text}: forms ${Object.keys(value)}, the language has ${categories}`);
      }
      for (const [category, form] of Object.entries(value)) {
        const needed = expected.filter((name) => name !== '{count}');
        const got = placeholders(form);
        if (!got.every((name) => expected.includes(name)) || !needed.every((name) => got.includes(name))) {
          problems.push(`${context} / ${text} [${category}]: placeholders ${got}`);
        }
      }
    }
  }
  check(`${language}: well-formed translations`, problems, []);
}

// The lookup.
check('english by default', I.t('x', 'Delete'), 'Delete');
check('placeholders filled', I.t('x', 'Open {name}', { name: 'bible.en.timeline' }), 'Open bible.en.timeline');
check('english plural: one', I.tn('x', '{count} item', '{count} items', 1), '1 item');
check('english plural: other', I.tn('x', '{count} item', '{count} items', 3), '3 items');
check('numbers are grouped', I.tn('x', '{count} item', '{count} items', 12000), '12,000 items');
I.setLanguage('ru');
check('unknown text stays english', I.t('x', 'No such thing'), 'No such thing');
const plural = Object.entries(all.ru).flatMap(([context, texts]) => Object.entries(texts).filter(([, v]) => typeof v === 'object').map(([k, v]) => [context, k, v]))[0];
if (plural) {
  const [context, key, forms] = plural;
  const one = strings[context]?.[key]?.[0] ?? key;
  check('russian plural: one', I.tn(context, one, key, 21), forms.one.replace('{count}', '21'));
  check('russian plural: few', I.tn(context, one, key, 3), forms.few.replace('{count}', '3'));
  check('russian plural: many', I.tn(context, one, key, 11), forms.many.replace('{count}', '11'));
}
I.setLanguage('en');
check('browser language', I.detectLanguage(['de-DE', 'ru-RU', 'en']), 'ru');
check('browser language: none known', I.detectLanguage(['nl', 'sv']), 'en');

done('i18n');
