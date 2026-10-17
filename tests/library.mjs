/** A library's index.json: the rules the checker holds it to, and which language the shelf shows (docs/format.md, "A library"). */
import { checker, load } from '../tools/load.mjs';

const { indexProblems, shelfGroups } = await load('core/library');
const { check, done } = checker();

const entry = (group, lang, more = {}) => ({ id: `${group}-${lang}`, group, lang, file: `${group}.${lang}.timeline`, title: group, description: '', kind: 'history', span: '1900 – 2000', items: 1, images: 0, size: 10, cover: null, ...more });
const history = [entry('history', 'ru'), entry('history', 'en'), entry('history', 'de')];
const moon = [entry('moon', 'pt-BR'), entry('moon', 'fr')];
const shown = (lang) => shelfGroups([...history, ...moon], lang).map(({ shown: s, others }) => [s.id, others.map((o) => o.lang)]);

check('one entry a chronology, in the interface’s language', shown('fr'), [['history-en', ['ru', 'de']], ['moon-fr', ['pt-BR']]]);
check('…its Russian file for Russian', shown('ru')[0], ['history-ru', ['en', 'de']]);
check('…a regional file for the language itself', shown('pt'), [['history-en', ['ru', 'de']], ['moon-pt-BR', ['fr']]]);
check('…else English, else the first', shown('ja'), [['history-en', ['ru', 'de']], ['moon-pt-BR', ['fr']]]);

check('a good index has no problems', indexProblems({ format: 'timeline-library', version: 1, files: [...history, ...moon] }), []);
check('the format and the list are required', indexProblems({ format: 'x' }).map((p) => p.text), ['format must be "timeline-library"', 'files must be a list']);
check('not even an object', indexProblems(null).map((p) => p.where), ['index.json', 'index.json']);
check(
  'each entry: the fields, one id, one file a language',
  indexProblems({ format: 'timeline-library', files: [entry('a', 'en'), { ...entry('a', 'en'), items: -1, title: '' }] }),
  [
    { where: 'files[1]', text: 'title must be a non-empty string' },
    { where: 'files[1]', text: 'items must be a whole number' },
    { where: 'files[1]', text: 'a second id "a-en"' },
    { where: 'files[1]', text: 'a second "en" file of the group "a"' },
  ],
);

check('a broken entry is said once, not as a repeat too', indexProblems({ format: 'timeline-library', files: [null, null] }).filter((p) => p.text.startsWith('a second')), []);

done('library');
