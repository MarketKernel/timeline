/**
 * The eras as a list (Task §6): they tile the axis one after another, so the
 * list says where each begins, and the end of the last. An era ends the day
 * before the next one begins — eras never overlap, and a boundary moved is
 * moved for both. A row without a name is a gap: no era there.
 *
 * `readEras` turns the file's eras into rows; `writeEras` turns rows back into
 * eras, keeping everything else an era has (its text, pictures, unknown
 * fields) and every date that did not move, approximations and all.
 */

import { endDay, isNow, snapTo, startOf, type End, type When } from './dates';
import type { Item } from './model';

export interface EraRow {
  /** The era's id; a gap has none. */
  id?: string;
  /** Empty: a gap. */
  title: string;
  color?: string;
  start: When;
}

export interface EraList {
  rows: EraRow[];
  /** Where the last era ends: a date, or today. */
  end: End;
}

const byStart = (a: Item, b: Item) => startOf(a.start) - startOf(b.start);

/** The file's eras as a list; a gap between two of them is a row of its own. */
export function readEras(items: readonly Item[]): EraList | null {
  const eras = items.filter((i) => i.kind === 'era' && i.end).sort(byStart);
  if (!eras.length) return null;
  const rows: EraRow[] = [];
  eras.forEach((era, i) => {
    const before = eras[i - 1];
    if (before?.end && !isNow(before.end) && endDay(before.end) < startOf(era.start)) {
      rows.push({ title: '', start: snapTo(endDay(before.end), before.end) });
    }
    const row: EraRow = { id: era.id, title: era.title, start: era.start };
    if (era.color) row.color = era.color;
    rows.push(row);
  });
  return { rows, end: eras.at(-1)!.end! };
}

/**
 * The last day before `next` begins, as precise as `next` says it — or the
 * end it had, when that already meets it ("c. 2091 BC" before "c. 2090 BC").
 */
function endBefore(next: When, had: End | undefined): When {
  if (had && !isNow(had) && endDay(had) === startOf(next)) return had;
  return snapTo(startOf(next) - 1, next);
}

/** What is wrong with a list, per row: a beginning not after the one above, an end not after the last beginning. */
export function checkEras(list: EraList): { row: number; problem: 'order' | 'end' }[] {
  const problems: { row: number; problem: 'order' | 'end' }[] = [];
  list.rows.forEach((row, i) => {
    const above = list.rows[i - 1];
    if (above && startOf(row.start) <= startOf(above.start)) problems.push({ row: i, problem: 'order' });
  });
  const last = list.rows.length - 1;
  if (last >= 0 && !isNow(list.end) && endDay(list.end) <= startOf(list.rows[last]!.start)) problems.push({ row: last, problem: 'end' });
  return problems;
}

/**
 * The eras the list makes, in order. `existing` gives each era's other fields;
 * a row whose id is not among them is a new era. A gap row makes nothing; the
 * era before it ends where the gap begins.
 */
export function writeEras(list: EraList, existing: readonly Item[]): Item[] {
  const had = new Map(existing.filter((i) => i.kind === 'era').map((i) => [i.id, i]));
  const out: Item[] = [];
  list.rows.forEach((row, i) => {
    if (!row.title || !row.id) return;
    const next = list.rows[i + 1];
    const old = had.get(row.id);
    const end: End = next ? endBefore(next.start, old?.end) : list.end;
    const era: Item = old ? { ...structuredClone(old), title: row.title, start: row.start, end } : { id: row.id, kind: 'era', start: row.start, end, title: row.title };
    if (row.color) era.color = row.color;
    else delete era.color;
    out.push(era);
  });
  return out;
}
