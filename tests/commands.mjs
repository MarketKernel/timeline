/** Undo and redo of every command restore the exact document (Task §6, §11). */
import { checker, load } from '../tools/load.mjs';

const { History, itemChange, imageChange, fieldChange, parseDoc, serializeDoc } = await load('core/commands', 'core/model');
const { check, done } = checker();

const { doc } = parseDoc({
  format: 'timeline',
  version: 1,
  meta: { id: 't', kind: 'history' },
  title: 'T',
  images: { aaaaaaaaaaaaaaaa: { ext: 'webp', w: 2, h: 1 } },
  items: [
    { id: 'a', kind: 'event', start: { y: 1 }, title: 'A' },
    { id: 'b', kind: 'event', start: { y: 2 }, title: 'B', image: 'aaaaaaaaaaaaaaaa' },
    { id: 'c', kind: 'period', start: { y: 3 }, end: { y: 9 }, title: 'C' },
  ],
});
// Exact: the in-memory document, item order and all — not only what a save would write.
const exact = (d) => JSON.stringify(d);
const history = new History(doc, 100);
const snapshots = [exact(doc)];
const run = (label, changes) => {
  history.run({ label, changes });
  snapshots.push(exact(doc));
};

run('Move A', [itemChange(doc, 'a', { ...doc.items[0], start: { y: 5 } })]);
run('Delete B', [itemChange(doc, 'b', undefined)]);
run('New D', [itemChange(doc, 'd', { id: 'd', kind: 'event', start: { y: 4 }, title: 'D' })]);
run('Image', [imageChange(doc, 'bbbbbbbbbbbbbbbb', { ext: 'png', w: 1, h: 1 }), itemChange(doc, 'd', { ...doc.items.find((i) => i.id === 'd'), image: 'bbbbbbbbbbbbbbbb' })]);
run('Remove image', [imageChange(doc, 'aaaaaaaaaaaaaaaa', undefined)]);
run('Rename', [fieldChange(doc, 'title', 'Renamed')]);
run('Blue paper', [fieldChange(doc, 'style', { paper: '#e7eef6', texture: 'grid' })]);
run('Colour', [itemChange(doc, 'c', { ...doc.items.find((i) => i.id === 'c'), color: '#123456' })]);
run('Delete first and last', [itemChange(doc, 'a', undefined), itemChange(doc, 'c', undefined)]);

check('dirty after edits', history.dirty, true);
for (let i = snapshots.length - 1; i > 0; i--) {
  history.undo();
  check(`undo to step ${i - 1}`, exact(doc) === snapshots[i - 1], true);
}
check('nothing more to undo', history.undo(), null);
check('clean at the start', history.dirty, false);
for (let i = 1; i < snapshots.length; i++) {
  history.redo();
  check(`redo to step ${i}`, exact(doc) === snapshots[i], true);
}
check('deleted items come back in their places', (history.undo(), doc.items.map((i) => i.id)), ['a', 'c', 'd']);
const heard = [];
const stop = history.onChange((edited) => heard.push(edited));
history.markSaved();
check('saved', history.dirty, false);
history.markDirty();
stop();
// A save leaves the document as it was: the strip and the open panel are not redrawn for it.
check('a save is heard as no edit, a restored draft as one', heard, [false, true]);
history.markSaved();
history.undo();
check('undo past a save is dirty', history.dirty, true);
history.redo();
check('redo back to the save is clean', history.dirty, false);
history.undo();
run('Branch', [fieldChange(doc, 'title', 'Branch')]);
check('a new branch cannot reach the save', [history.dirty, history.canRedo], [true, false]);

const limited = new History(structuredClone(doc), 3);
for (let i = 0; i < 5; i++) limited.run({ label: `t${i}`, changes: [fieldChange(limited.doc, 'title', `t${i}`)] });
let undos = 0;
while (limited.undo()) undos++;
check('the stack holds its limit', undos, 3);
check('serializable after all that', typeof serializeDoc(doc), 'string');

done('commands');
