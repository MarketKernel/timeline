/** Search: titles first, accents and ё do not matter (Task §5.3). */
import { checker, load } from '../tools/load.mjs';

const { search, normalize, parseDoc } = await load('core/search', 'core/model');
const { check, done } = checker();
const { doc } = parseDoc({
  format: 'timeline',
  version: 1,
  meta: { id: 's', kind: 'history' },
  title: 'S',
  items: [
    { id: 'pentecost', kind: 'event', start: { y: 30 }, title: 'Pentecost', text: 'The Spirit comes upon the apostles.' },
    { id: 'peter', kind: 'period', start: { y: 1 }, end: { y: 64 }, title: 'Апостол Пётр', refs: 'Acts 2' },
    { id: 'nicaea', kind: 'event', start: { y: 325 }, title: 'Council of Nicaea', tags: ['creed'] },
    { id: 'creed', kind: 'event', start: { y: 381 }, title: 'The Creed completed' },
    { id: 'cafe', kind: 'event', start: { y: 1700 }, title: 'Café culture' },
  ],
});
const ids = (q) => search(doc.items, q).map((h) => h.item.id);
check('normalize', normalize('Ёлка Café'), 'елка cafe');
check('by title', ids('pente'), ['pentecost']);
check('in Russian', ids('апост'), ['peter']);
check('ё matches е', ids('петр'), ['peter']);
check('accents do not matter', ids('cafe'), ['cafe']);
check('titles before tags', ids('creed'), ['creed', 'nicaea']);
check('text and refs', [ids('apostles'), ids('acts')], [['pentecost'], ['peter']]);
check('every word must match', ids('council creed'), ['nicaea']);
check('a snippet', search(doc.items, 'spirit')[0].snippet, 'The Spirit comes upon the apostles.');
check('nothing for nothing', ids('  '), []);
{
  // Accents typed as marks of their own go when the text is normalized: the snippet is still cut around the match.
  const marked = 'e\u0301 '.repeat(150);
  const [hit] = search([{ id: 'm', kind: 'event', start: { y: 1 }, title: 'M', text: `${marked}the apostles met` }], 'apostles');
  check('a snippet where the text is longer than its normalized form', hit.snippet.includes('apostles'), true);
}
done('search');
