/**
 * The zoom. `pxPerDay` is the one variable; everything a person reads about
 * it — "1 px = 1 year", the scale bar, the presets — is derived from it.
 * The view is a centre day plus pxPerDay over a width in pixels.
 */

import { YEAR_DAYS } from './dates';
import { t, tn } from './i18n';

export type Unit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'season' | 'year' | 'decade' | 'century' | 'millennium';

export const UNITS: readonly Unit[] = ['minute', 'hour', 'day', 'week', 'month', 'season', 'year', 'decade', 'century', 'millennium'];

export const UNIT_DAYS: Readonly<Record<Unit, number>> = {
  minute: 1 / 1440,
  hour: 1 / 24,
  day: 1,
  week: 7,
  month: YEAR_DAYS / 12,
  /** Three months: a quarter of a year. */
  season: YEAR_DAYS / 4,
  year: YEAR_DAYS,
  decade: YEAR_DAYS * 10,
  century: YEAR_DAYS * 100,
  millennium: YEAR_DAYS * 1000,
};

/** "N px = M units", as a map states its scale. */
export interface ScaleSpec {
  px: number;
  unit: Unit;
  count: number;
}

export const isUnit = (value: unknown): value is Unit => typeof value === 'string' && (UNITS as readonly string[]).includes(value);

export const pxPerDayOf = (spec: ScaleSpec): number => spec.px / (spec.count * UNIT_DAYS[spec.unit]);

/**
 * The finest zoom: a pixel a minute, a day 1440 px wide. Dates go no finer than
 * a day — an event stands in the middle of its day — but days that close
 * together pull apart, so a crowded week shows every card.
 */
export const MAX_PX_PER_DAY = 1440;

/**
 * The picker's presets, finest first, each a pixel for a unit of time — the
 * old LifeMap knew only 1 px = 1 day. A minute and an hour pull the days of a
 * crowded week apart (dates themselves go no finer than a day); a million
 * years is the coarsest, for the whole of the Earth in three screens.
 * Only those a file can be shown at are offered (`presetsFor`); the wheel and
 * the pinch zoom anywhere in between (and in to 40 px a day), the buttons step
 * from one to the next.
 */
export const PRESETS: readonly ScaleSpec[] = [
  { px: 1, unit: 'minute', count: 1 },
  { px: 1, unit: 'hour', count: 1 },
  { px: 1, unit: 'day', count: 1 },
  { px: 1, unit: 'week', count: 1 },
  { px: 1, unit: 'month', count: 1 },
  { px: 1, unit: 'season', count: 1 },
  { px: 1, unit: 'year', count: 1 },
  { px: 1, unit: 'year', count: 10 },
  { px: 1, unit: 'century', count: 1 },
  { px: 1, unit: 'year', count: 1_000 },
  { px: 1, unit: 'year', count: 10_000 },
  { px: 1, unit: 'year', count: 100_000 },
  { px: 1, unit: 'year', count: 1_000_000 },
];

/** How wide a chronology must be, at least, for a preset to be worth offering. */
const PRESET_MIN_PX = 100;

/** The presets a chronology of this many days can be shown at: those that leave it at least 100 px. */
export const presetsFor = (extentDays: number): ScaleSpec[] => PRESETS.filter((spec) => pxPerDayOf(spec) * Math.max(extentDays, 1) >= PRESET_MIN_PX);

/** The unit's name with a number: "1 year", "3 centuries". */
export function unitText(unit: Unit, count: number): string {
  switch (unit) {
    case 'minute':
      return tn('scale', '{count} minute', '{count} minutes', count);
    case 'hour':
      return tn('scale', '{count} hour', '{count} hours', count);
    case 'day':
      return tn('scale', '{count} day', '{count} days', count);
    case 'week':
      return tn('scale', '{count} week', '{count} weeks', count);
    case 'month':
      return tn('scale', '{count} month', '{count} months', count);
    case 'season':
      return tn('scale', '{count} season', '{count} seasons', count);
    case 'year':
      // Deep time in millions: "1 million years", not "1,000,000 years".
      if (count >= 1_000_000) return tn('scale', '{count} million years', '{count} million years', count / 1_000_000);
      return tn('scale', '{count} year', '{count} years', count);
    case 'decade':
      return tn('scale', '{count} decade', '{count} decades', count);
    case 'century':
      return tn('scale', '{count} century', '{count} centuries', count);
    case 'millennium':
      return tn('scale', '{count} millennium', '{count} millennia', count);
  }
}

/** "1 px = 1 century" */
export const specText = (spec: ScaleSpec): string => t('scale', '{px} px = {amount}', { px: spec.px, amount: unitText(spec.unit, spec.count) });

const round2 = (x: number): number => {
  if (x === 0) return 0;
  const p = 10 ** (Math.floor(Math.log10(Math.abs(x))) - 1);
  return Math.round(x / p) * p;
};

/**
 * The current zoom said plainly, as the presets are: "1 px = 3 days",
 * "1 px = 1 season", "1 px = 50 years", "1 px = 2.5 centuries", "1 px = 20,000
 * years", "1 px = 2.9 million years" — minutes and hours below a day; days,
 * weeks and months below a year; years up to a century, centuries below a
 * thousand years, years beyond.
 */
export function describeScale(pxPerDay: number): ScaleSpec {
  const days = 1 / pxPerDay;
  if (days < 0.999) {
    const unit: Unit = days >= 0.999 * UNIT_DAYS.hour ? 'hour' : 'minute';
    return { px: 1, unit, count: Math.max(1, round2(days / UNIT_DAYS[unit])) };
  }
  const years = days / YEAR_DAYS;
  if (years >= 0.999 * 1000 || (years >= 0.999 && years < 0.999 * 100)) return { px: 1, unit: 'year', count: round2(years) };
  if (years >= 0.999 * 100) return { px: 1, unit: 'century', count: round2(years / 100) };
  const unit: Unit = days >= 0.999 * UNIT_DAYS.month ? 'month' : days >= 0.999 * UNIT_DAYS.week ? 'week' : 'day';
  const count = round2(days / UNIT_DAYS[unit]);
  // Three months a pixel is said as the preset says it.
  if (unit === 'month' && count === 3) return { px: 1, unit: 'season', count: 1 };
  return { px: 1, unit, count };
}

/** The preset nearest to pxPerDay, measured as zoom steps (logarithmically). */
export function nearestPreset(pxPerDay: number): ScaleSpec {
  let best = PRESETS[0]!;
  for (const spec of PRESETS) {
    if (Math.abs(Math.log(pxPerDayOf(spec) / pxPerDay)) < Math.abs(Math.log(pxPerDayOf(best) / pxPerDay))) best = spec;
  }
  return best;
}

/** The next preset in the direction of `direction` (+1 finer, -1 coarser) from pxPerDay. */
export function stepPreset(pxPerDay: number, direction: 1 | -1): ScaleSpec | null {
  const sorted = PRESETS.map(pxPerDayOf);
  const eps = 1.02;
  if (direction > 0) {
    const finer = sorted.filter((p) => p > pxPerDay * eps).sort((a, b) => a - b)[0];
    return finer === undefined ? null : PRESETS[sorted.indexOf(finer)]!;
  }
  const coarser = sorted.filter((p) => p < pxPerDay / eps).sort((a, b) => b - a)[0];
  return coarser === undefined ? null : PRESETS[sorted.indexOf(coarser)]!;
}

/* ------------------------------------------------------------------ *
 * The scale bar: ├─ 100 years ─┤
 * ------------------------------------------------------------------ */

/** Lengths a scale bar may show, in days, with what it says. */
const BAR_STEPS: readonly [number, Unit, number][] = [
  ...[1, 2, 5, 10, 15, 30].map((n): [number, Unit, number] => [n * UNIT_DAYS.minute, 'minute', n]),
  ...[1, 2, 3, 6, 12].map((n): [number, Unit, number] => [n * UNIT_DAYS.hour, 'hour', n]),
  ...[1, 2, 5].map((n): [number, Unit, number] => [n, 'day', n]),
  [7, 'week', 1],
  [14, 'week', 2],
  ...[1, 3, 6].map((n): [number, Unit, number] => [n * UNIT_DAYS.month, 'month', n]),
  // 1, 2, 5 × 10ⁿ years, up to the billions.
  ...Array.from({ length: 10 }, (_, e) => [1, 2, 5].map((m) => m * 10 ** e))
    .flat()
    .map((n): [number, Unit, number] => [n * YEAR_DAYS, 'year', n]),
];

/** The bar nearest `target` px long, never longer than 2.5 × target. */
export function scaleBar(pxPerDay: number, target = 100): { px: number; unit: Unit; count: number; text: string } {
  let best = BAR_STEPS[0]!;
  for (const step of BAR_STEPS) {
    const px = step[0] * pxPerDay;
    if (px > target * 2.5) break;
    if (Math.abs(Math.log(px / target)) < Math.abs(Math.log((best[0] * pxPerDay) / target))) best = step;
  }
  return { px: best[0] * pxPerDay, unit: best[1], count: best[2], text: unitText(best[1], best[2]) };
}

/* ------------------------------------------------------------------ *
 * The view
 * ------------------------------------------------------------------ */

export interface View {
  /** The day at the middle of the strip. */
  center: number;
  pxPerDay: number;
  /** The strip's width in px. */
  width: number;
}

export const xOf = (view: View, day: number): number => (day - view.center) * view.pxPerDay + view.width / 2;

export const dayAt = (view: View, x: number): number => view.center + (x - view.width / 2) / view.pxPerDay;

/** The first and last day on screen. */
export const visibleRange = (view: View): [number, number] => [dayAt(view, 0), dayAt(view, view.width)];

/**
 * From the whole extent in 600 px — or further, to the coarsest preset that
 * still gives it 100 px (two centuries of flight at 1 px = 1 year) — to
 * 40 px a day.
 */
export function zoomLimits(extentDays: number): { min: number; max: number } {
  const span = Math.max(extentDays, 1);
  const preset = Math.min(...presetsFor(span).map(pxPerDayOf));
  const min = Math.min(600 / span, preset, MAX_PX_PER_DAY / 4);
  return { min, max: MAX_PX_PER_DAY };
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Zooms by `factor`, keeping the day under `x` where it is — zoom around the cursor. */
export function zoomAt(view: View, factor: number, x: number, limits: { min: number; max: number }): View {
  const anchor = dayAt(view, x);
  const pxPerDay = clamp(view.pxPerDay * factor, limits.min, limits.max);
  return { ...view, pxPerDay, center: anchor - (x - view.width / 2) / pxPerDay };
}

/** The view that shows [start, end] with `margin` px free on each side. */
/**
 * The view that shows [start, end] with `margin` px free on each side — or,
 * given [before, after], that much before the start and after the end, the
 * start standing `before` px from the left edge.
 */
export function fitView(start: number, end: number, width: number, limits: { min: number; max: number }, margin: number | [number, number] = 48): View {
  const span = Math.max(end - start, 1);
  if (typeof margin === 'number') {
    const pxPerDay = clamp((width - 2 * margin) / span, limits.min, limits.max);
    return { center: (start + end) / 2, pxPerDay, width };
  }
  const [before, after] = margin;
  const pxPerDay = clamp((width - before - after) / span, limits.min, limits.max);
  return { center: start + (width / 2 - before) / pxPerDay, pxPerDay, width };
}

/**
 * Keeps the centre within the extent ± one screen: a soft stop for panning.
 * With `startMargin` the beginning is a hard edge instead: the screen's left
 * side goes no further than that many px before the start; with `endMargin`
 * the end is one too, on the right.
 */
export function clampCenter(view: View, start: number, end: number, startMargin?: number, endMargin?: number): View {
  const screen = view.width / view.pxPerDay;
  const min = startMargin === undefined ? start - screen / 2 : start - startMargin / view.pxPerDay + screen / 2;
  const max = endMargin === undefined ? end + screen / 2 : end + endMargin / view.pxPerDay - screen / 2;
  return { ...view, center: clamp(view.center, min, Math.max(min, max)) };
}
