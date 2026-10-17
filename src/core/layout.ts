/**
 * Where cards and bars go (Task §5.4). Pure geometry in pixels: the view
 * measures, this decides.
 *
 * Cards stand above the axis in rows of one unit height; a card spans as
 * many rows as it is tall, row 0 being the one just above the axis. A card's
 * pointer runs straight down from near its left edge to its dot — or from its
 * middle, for a round card, which stands centred over it.
 *
 * What is shown is decided by the zoom alone: an event's rank (its size — a
 * large or huge card 1, normal 2, small 3) against the finest rank the zoom
 * shows. Every event shown is a card at its own size, never shrunk, never
 * hidden for want of room. Cards are placed in order of rank, then date: each
 * takes the lowest row where it overlaps nothing and its pointer crosses no
 * card; when there is none, it lies over the others where it covers least of
 * them — the view draws later events above earlier ones.
 */

export type CardMode = 'full' | 'dot';

export interface CardInput {
  id: string;
  /** The dot's x, px. */
  x: number;
  /** 1 (a large or huge card) … 3 (a small one). */
  rank: number;
  /** A tiebreak within a rank, usually the date. */
  order: number;
  /** The card's width in px and height in rows. */
  full: { width: number; rows: number };
  /** The row fixed by hand (a dragged card): placed first, and kept. */
  lane?: number;
  /** Stands centred over its dot (a round card), not `inset` to the right of its left edge. */
  centered?: boolean;
  /** Moved by hand: px to the right of where it would stand. Its pointer runs slanted from the dot up to it. */
  shift?: number;
}

export interface Placed {
  id: string;
  mode: CardMode;
  /** The lowest row the card occupies; -1 for a dot. */
  row: number;
  rows: number;
  left: number;
  width: number;
}

export interface CardOptions {
  /** Rows that fit the strip's height. */
  rows: number;
  /** Free space between cards, px. */
  gap?: number;
  /** How far left of its dot a card starts: the pointer sits this far inside it. */
  inset?: number;
  /** Events of a larger rank than this are dots (the coarsest zoom shows rank 1 only). */
  maxRank?: number;
}

/** The part of one row cards cover: [from, to) intervals, merged where they meet, kept sorted. */
class Row {
  private starts: number[] = [];
  private ends: number[] = [];

  /** The first interval that ends after `from`. */
  private after(from: number): number {
    let lo = 0;
    let hi = this.ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ends[mid]! <= from) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  free(from: number, to: number): boolean {
    const i = this.after(from);
    return i >= this.starts.length || this.starts[i]! >= to;
  }

  /** How many px of [from, to) are covered already. */
  covered(from: number, to: number): number {
    let sum = 0;
    for (let i = this.after(from); i < this.starts.length && this.starts[i]! < to; i++) sum += Math.min(to, this.ends[i]!) - Math.max(from, this.starts[i]!);
    return sum;
  }

  take(from: number, to: number): void {
    // Whatever it touches is merged into it: the intervals stay disjoint, however cards lie over each other.
    let i = this.after(from);
    let j = i;
    while (j < this.starts.length && this.starts[j]! <= to) {
      from = Math.min(from, this.starts[j]!);
      to = Math.max(to, this.ends[j]!);
      j++;
    }
    this.starts.splice(i, j - i, from);
    this.ends.splice(i, j - i, to);
  }
}

/** Half the width of the strip a pointer reserves in the rows below its card. */
const POINTER = 3;

export function layoutCards(cards: readonly CardInput[], options: CardOptions): Map<string, Placed> {
  const { rows: rowCount, gap = 12, inset = 12, maxRank = 3 } = options;
  const rows = Array.from({ length: Math.max(1, rowCount) }, () => new Row());
  const placed = new Map<string, Placed>();

  /** Whether the card's own rows are free at `row`; the rows its pointer crosses below are the caller's to check. */
  const fits = (left: number, width: number, row: number, span: number): boolean => {
    if (row + span > rows.length) return false;
    for (let r = row; r < row + span; r++) if (!rows[r]!.free(left - gap / 2, left + width + gap / 2)) return false;
    return true;
  };
  /** How much of the cards already placed a card at `row` would cover. */
  const covers = (left: number, width: number, row: number, span: number): number => {
    let sum = 0;
    for (let r = row; r < Math.min(row + span, rows.length); r++) sum += rows[r]!.covered(left - gap / 2, left + width + gap / 2);
    return sum;
  };
  /** Where a pointer crosses row r below a card at `row`: straight up from the dot, or slanted towards a card moved by hand. */
  const pointerAt = (x: number, shift: number, row: number, r: number): number => (shift ? x + (shift * (r + 0.5)) / row : x);
  const pointerFree = (x: number, shift: number, row: number): boolean => {
    for (let r = 0; r < row; r++) {
      const at = pointerAt(x, shift, row, r);
      if (!rows[r]!.free(at - POINTER, at + POINTER)) return false;
    }
    return true;
  };
  const take = (x: number, shift: number, left: number, width: number, row: number, span: number) => {
    for (let r = row; r < Math.min(row + span, rows.length); r++) rows[r]!.take(left - gap / 2, left + width + gap / 2);
    for (let r = 0; r < row; r++) {
      const at = pointerAt(x, shift, row, r);
      rows[r]!.take(at - POINTER, at + POINTER);
    }
  };

  const sorted = [...cards].sort(
    (a, b) => (a.lane === undefined ? 1 : 0) - (b.lane === undefined ? 1 : 0) || a.rank - b.rank || a.order - b.order || (a.id < b.id ? -1 : 1),
  );

  for (const card of sorted) {
    if (card.rank > maxRank) {
      placed.set(card.id, { id: card.id, mode: 'dot', row: -1, rows: 0, left: card.x, width: 0 });
      continue;
    }
    const { width, rows: span } = card.full;
    const shift = card.shift ?? 0;
    const left = (card.centered ? card.x - width / 2 : card.x - inset) + shift;
    // The highest row it may start at and still stand inside the strip (row 0 for one taller than it).
    const top = Math.max(0, rows.length - span);
    let row: number;
    if (card.lane !== undefined && card.lane >= 0) row = Math.min(card.lane, top);
    else {
      row = -1;
      for (let r = 0; r <= top; r++) {
        if (shift) {
          // A slanted pointer crosses each row below at a place that depends on the card's row: every row is tried.
          if (fits(left, width, r, span) && pointerFree(card.x, shift, r)) {
            row = r;
            break;
          }
          continue;
        }
        if (fits(left, width, r, span)) {
          row = r;
          break;
        }
        // The pointer runs down through every row below the card: once one of them is taken, no higher row will do.
        if (!rows[r]!.free(card.x - POINTER, card.x + POINTER)) break;
      }
      if (row < 0) {
        // No room: over the others, where it hides least of them.
        let least = Infinity;
        for (let r = 0; r <= top; r++) {
          const cost = covers(left, width, r, span);
          if (cost < least) [least, row] = [cost, r];
        }
      }
    }
    take(card.x, shift, left, width, row, span);
    placed.set(card.id, { id: card.id, mode: 'full', row, rows: span, left, width });
  }
  return placed;
}

/* ------------------------------------------------------------------ *
 * Period bars
 * ------------------------------------------------------------------ */

export interface BarInput {
  id: string;
  /** px */
  start: number;
  end: number;
  /** Where the bar's label ends when it runs past a short bar: packed as if the bar reached there. */
  visualEnd?: number;
  /** The row fixed by hand (a dragged bar): placed first, kept while it is free. */
  lane?: number;
}

/**
 * Bars packed into the fewest rows (first fit, by start), so overlapping
 * lives stack and consecutive reigns share a line. A bar with a row fixed by
 * hand takes it first; the others fit around it.
 */
export function layoutBars(bars: readonly BarInput[], gap = 6): { row: Map<string, number>; rows: number } {
  const row = new Map<string, number>();
  const list = [...bars].sort((a, b) => (a.lane === undefined ? 1 : 0) - (b.lane === undefined ? 1 : 0) || a.start - b.start || b.end - a.end || (a.id < b.id ? -1 : 1));
  const rows: Row[] = [];
  const rowAt = (r: number) => {
    while (rows.length <= r) rows.push(new Row());
    return rows[r]!;
  };
  let rowCount = 0;
  for (const bar of list) {
    const to = Math.max(bar.end, bar.visualEnd ?? bar.end) + gap;
    let r = bar.lane !== undefined && bar.lane >= 0 && rowAt(bar.lane).free(bar.start, to) ? bar.lane : -1;
    for (let i = 0; r < 0; i++) if (rowAt(i).free(bar.start, to)) r = i;
    rowAt(r).take(bar.start, to);
    row.set(bar.id, r);
    rowCount = Math.max(rowCount, r + 1);
  }
  // A row left empty below a bar dragged down stays: the bar keeps the place it was put in.
  return { row, rows: rowCount };
}
