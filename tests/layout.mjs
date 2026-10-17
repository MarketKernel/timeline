/** Cards: the zoom decides which are shown, by their size; every one shown is a card, over others when it must (Task §5.4, §11). */
import { checker, load } from '../tools/load.mjs';

const { layoutCards, layoutBars } = await load('core/layout');
const { check, done } = checker();

let seed = 11;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const make = (n, spanDays) =>
  Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    day: random() * spanDays,
    rank: 1 + Math.floor(random() * 3),
    full: { width: 180, rows: random() < 0.5 ? 4 : 2 },
  }));

const items = make(1000, 365 * 3000);
let hidden = 0;
let shownAboveRank = 0;
let outside = 0;
let overlapsWithRoom = 0;
for (let z = 0; z < 20; z++) {
  const pxPerDay = Math.exp(Math.log(0.0005) + random() * Math.log(4 / 0.0005));
  const cards = items.map((it) => ({ ...it, x: it.day * pxPerDay, order: it.day }));
  const rows = 4 + Math.floor(random() * 12);
  const maxRank = 1 + Math.floor(random() * 3);
  const placed = layoutCards(cards, { rows, gap: 12, maxRank });
  for (const c of cards) {
    const p = placed.get(c.id);
    if (c.rank <= maxRank && p.mode !== 'full') hidden++;
    if (c.rank > maxRank && p.mode !== 'dot') shownAboveRank++;
    if (p.mode === 'full' && (p.row < 0 || p.row + p.rows > rows)) outside++;
  }
}
check('every event the zoom shows is a card, however crowded (1000 items, 20 zooms)', hidden, 0);
check('…and only those: a rank the zoom does not show is a dot', shownAboveRank, 0);
check('…standing inside the strip', outside, 0);

{
  // With room, nothing overlaps; the pointer of a card crosses no card below it.
  const sparse = make(60, 365 * 3000).map((it) => ({ ...it, x: it.day * 0.003, order: it.day }));
  const placed = layoutCards(sparse, { rows: 40, gap: 12 });
  const boxes = [...placed.values()].filter((p) => p.mode === 'full');
  for (const a of boxes) for (const b of boxes) {
    if (a === b) continue;
    const apart = a.left + a.width + 12 <= b.left || b.left + b.width + 12 <= a.left || a.row + a.rows <= b.row || b.row + b.rows <= a.row;
    if (!apart) overlapsWithRoom++;
  }
  check('with room, no two cards overlap', overlapsWithRoom, 0);
}

{
  // No room: a card lies over the others where it covers least of them — never hidden, never shrunk.
  const card = (id, x, rank, rows = 3) => ({ id, x, rank, order: x, full: { width: 180, rows } });
  const placed = layoutCards([card('a', 0, 1), card('b', 30, 2), card('c', 60, 2)], { rows: 3 });
  check('three cards where one fits: all three are cards, at their size', ['a', 'b', 'c'].map((id) => [placed.get(id).mode, placed.get(id).width]), [['full', 180], ['full', 180], ['full', 180]]);
  const over = layoutCards([card('a', 0, 1, 2), card('wide', 400, 1, 2), card('b', 150, 2, 2)], { rows: 4 });
  check('…a card with no free row lies where it covers least', [over.get('a').row, over.get('wide').row, over.get('b').row], [0, 0, 2]);
  const coarse = layoutCards([card('a', 0, 1), card('b', 300, 2)], { rows: 8, maxRank: 1 });
  check('the coarsest zoom shows large and huge cards only', [coarse.get('a').mode, coarse.get('b').mode], ['full', 'dot']);
  const laned = layoutCards([{ ...card('b', 30, 2), lane: 0 }, card('a', 0, 1)], { rows: 8 });
  check('a card placed by hand keeps its row', [laned.get('b').row, laned.get('a').row > 0], [0, true]);
  const tall = layoutCards([card('tall', 0, 1, 12)], { rows: 5 });
  check('a card taller than the strip stands on the axis', [tall.get('tall').mode, tall.get('tall').row], ['full', 0]);
}

{
  const { row, rows } = layoutBars([
    { id: 'adam', start: 0, end: 930 },
    { id: 'seth', start: 130, end: 1042 },
    { id: 'enosh', start: 235, end: 1140 },
    { id: 'saul', start: 2000, end: 2040 },
    { id: 'david', start: 2040, end: 2080 },
    { id: 'solomon', start: 2080, end: 2120, visualEnd: 2300 },
    { id: 'rehoboam', start: 2120, end: 2137 },
  ], 0);
  check('overlapping lives stack', [row.get('adam'), row.get('seth'), row.get('enosh')], [0, 1, 2]);
  check('consecutive reigns share a line unless a label needs room', [row.get('saul'), row.get('david'), row.get('solomon'), row.get('rehoboam')], [0, 0, 0, 1]);
  check('as many rows as the most that overlap', rows, 3);
}

{
  // A bar dragged to a row keeps it; the others fit around it.
  const { row, rows } = layoutBars([
    { id: 'saul', start: 0, end: 40 },
    { id: 'david', start: 40, end: 80, lane: 2 },
    { id: 'solomon', start: 80, end: 120 },
    { id: 'samuel', start: 20, end: 60, lane: 0 },
    { id: 'clash', start: 30, end: 50, lane: 0 },
  ], 0);
  check('a bar placed by hand keeps its row', [row.get('david'), row.get('samuel')], [2, 0]);
  check('…the others fit around it', [row.get('clash'), row.get('saul'), row.get('solomon')], [1, 2, 0]);
  check('…a fixed row already taken is given up', row.get('clash') !== 0, true);
  check('…and the band is as tall as the lowest bar', rows, 3);
}

{
  // A round card stands centred over its dot; a rectangle starts `inset` to the left of it.
  const card = (id, x, centered) => ({ id, x, rank: 2, order: x, full: { width: 120, rows: 5 }, centered });
  const placed = layoutCards([card('round', 300, true), card('rect', 600, false)], { rows: 10, inset: 12 });
  check('a round card is centred over its dot', [placed.get('round').left, placed.get('rect').left], [240, 588]);
}

done('layout');
