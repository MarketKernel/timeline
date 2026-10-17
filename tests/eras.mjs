/** Eras as a list: they tile, never overlap, and a list read and written back changes nothing (core/eras.ts). */
import { checker, load } from '../tools/load.mjs';

const { readEras, writeEras, checkEras, parseDoc } = await load('core/eras', 'core/model');
const { check, done } = checker();

const { doc } = parseDoc({
  format: 'timeline',
  version: 1,
  meta: { id: 't', kind: 'history' },
  title: 'T',
  items: [
    { id: 'primeval', kind: 'era', start: { y: -4173, approx: true, spread: 250 }, end: { y: -2091, approx: true }, title: 'Primeval', color: '#8a6a3c', text: 'From the creation.' },
    { id: 'patriarchs', kind: 'era', start: { y: -2090, approx: true }, end: { y: -1876, approx: true }, title: 'Patriarchs' },
    { id: 'christ', kind: 'era', start: { y: -4 }, end: { y: 30, m: 4 }, title: 'Life of Christ' },
    { id: 'apostles', kind: 'era', start: { y: 30, m: 5 }, end: { now: true }, title: 'Apostolic age' },
    { id: 'flood', kind: 'event', start: { y: -2517 }, title: 'Flood' },
  ],
});
const eras = doc.items.filter((i) => i.kind === 'era');

const list = readEras(doc.items);
check('a list in time order, with the gap as a row of its own', list.rows.map((r) => r.title), ['Primeval', 'Patriarchs', '', 'Life of Christ', 'Apostolic age']);
check('the gap begins the year after the era before it', list.rows[2].start, { y: -1875, approx: true });
check('the list ends where the last era does', list.end, { now: true });
check('nothing is wrong with it', checkEras(list), []);
check('read and written back, the eras are as they were', JSON.stringify(writeEras(list, doc.items)), JSON.stringify(eras.sort((a, b) => a.start.y - b.start.y)));

// A boundary moved is moved for both: the era above now ends the day before.
const moved = structuredClone(list);
moved.rows[1].start = { y: -2000 };
const afterMove = writeEras(moved, doc.items);
check('moving a beginning ends the era above the year before', [afterMove[0].end, afterMove[1].start], [{ y: -2001 }, { y: -2000 }]);
check('…and keeps everything else the era has', [afterMove[0].text, afterMove[0].start.spread, afterMove[0].color], ['From the creation.', 250, '#8a6a3c']);

// Deleting a row: the era above takes its time; a gap row deleted closes the gap.
const closed = structuredClone(list);
closed.rows.splice(2, 1);
check('without the gap row, the eras meet', writeEras(closed, doc.items)[1].end, { y: -5 });
const fewer = structuredClone(list);
fewer.rows.splice(4, 1);
check('without the last era, the one above runs to the list’s end', writeEras(fewer, doc.items).at(-1), { ...eras.find((e) => e.id === 'christ'), end: { now: true } });

// A new era, a renamed one, a colour taken off.
const edited = structuredClone(list);
edited.rows.splice(1, 0, { id: 'r_new', title: 'Before Abraham', start: { y: -2500 }, color: '#4f7f78' });
edited.rows[0].title = 'Primeval history';
delete edited.rows[0].color;
const written = writeEras(edited, doc.items);
check('a new row is a new era, ending where the next begins', written[1], { id: 'r_new', kind: 'era', start: { y: -2500 }, end: { y: -2091, approx: true }, title: 'Before Abraham', color: '#4f7f78' });
check('…the one above ends the year before, as exact as the new beginning', [written[0].title, written[0].end, 'color' in written[0]], ['Primeval history', { y: -2501 }, false]);

// What the list refuses.
const wrong = structuredClone(list);
wrong.rows[3].start = { y: -3000 };
wrong.end = { y: 10 };
check('a beginning before the one above, an end before the last beginning', checkEras(wrong), [{ row: 3, problem: 'order' }, { row: 4, problem: 'end' }]);
check('a file without eras has no list', readEras(doc.items.filter((i) => i.kind !== 'era')), null);

done('eras');
