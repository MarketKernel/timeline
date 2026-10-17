/**
 * The ruler's ticks for a visible range at a zoom.
 *
 * Major ticks carry labels and stay at least `minGap` px apart: the step is the
 * finest of days, weeks, months (1, 3, 6) and years (1, 2, 5 × 10ⁿ) that keeps
 * them so. Minor ticks are unlabelled marks of a finer step that divides it.
 *
 * A tick marks the start of what its label names: "1517" at 1 January 1517,
 * "100 BC" at 1 January of 100 BC. There is no year 0 on the ruler — 1 BC is
 * followed by AD 1 — so at a step of k > 1 years the BC ticks fall on k, 2k …
 * BC and the AD ticks on AD k, 2k …; the boundary itself, day 0, is labelled
 * "1 BC | AD 1" and pushes away whatever is too close to it.
 */

import { dayOf, formatYear, monthName, weekday, dateOf, YEAR_DAYS } from './dates';
import { language } from './i18n';

export interface Tick {
  day: number;
  label?: string;
}

export interface Step {
  kind: 'hour' | 'day' | 'week' | 'month' | 'year';
  n: number;
  /** The shortest such step in days: the gap is checked against this. */
  minDays: number;
}

/** 1, 2, 5 × 10ⁿ years, up to the billions a pixel a million years needs (the age of the Earth in three screens). */
const YEAR_MULTIPLES = Array.from({ length: 10 }, (_, e) => [1, 2, 5].map((m) => m * 10 ** e)).flat();

export const STEPS: readonly Step[] = [
  { kind: 'day', n: 1, minDays: 1 },
  // At the finest zoom a day is 40 px: labels go every other day, each day still marked.
  { kind: 'day', n: 2, minDays: 2 },
  { kind: 'week', n: 1, minDays: 7 },
  { kind: 'month', n: 1, minDays: 28 },
  { kind: 'month', n: 3, minDays: 90 },
  { kind: 'month', n: 6, minDays: 181 },
  ...YEAR_MULTIPLES.map((n): Step => ({ kind: 'year', n, minDays: n * 365 })),
];

/**
 * Hours, as unlabelled marks between the days only: dates go no finer than a
 * day, but at a pixel an hour or a minute a day is long, and the marks say how far.
 */
const HOUR_STEPS: readonly Step[] = [1, 3, 6, 12].map((n): Step => ({ kind: 'hour', n, minDays: n / 24 }));

/** The finest step whose ticks stay `minGap` px apart. */
export function majorStep(pxPerDay: number, minGap = 80): Step {
  return STEPS.find((step) => step.minDays * pxPerDay >= minGap) ?? STEPS[STEPS.length - 1]!;
}

/** The finest step that divides `major` and still leaves `minGap` px between marks; null if none. */
export function minorStep(major: Step, pxPerDay: number, minGap = 6): Step | null {
  const divides = (step: Step): boolean => {
    if (step === major) return false;
    if (major.kind === 'year') return (step.kind === 'year' && major.n % step.n === 0) || (major.n === 1 && step.kind === 'month');
    if (major.kind === 'month') return (step.kind === 'month' && major.n % step.n === 0 && step.n < major.n) || (major.n === 1 && step.kind === 'day');
    return (major.kind === 'week' || major.n === 2) && step.kind === 'day' && step.n === 1;
  };
  const found = STEPS.find((step) => divides(step) && step.minDays * pxPerDay >= minGap);
  if (found) return found;
  return major.kind === 'day' && major.n === 1 ? (HOUR_STEPS.find((step) => step.minDays * pxPerDay >= minGap) ?? null) : null;
}

function hourTicks(from: number, to: number, every: number): Tick[] {
  const ticks: Tick[] = [];
  for (let day = Math.floor(from); day <= to; day++) for (let hour = every; hour < 24; hour += every) ticks.push({ day: day + hour / 24 });
  return ticks;
}

/** "1 BC | AD 1", "1 до н. э. | 1 г. н. э." */
export const eraBoundaryLabel = (lang: string = language()): string => `${formatYear(0, lang)} | ${formatYear(1, lang)}`;

function yearTicks(from: number, to: number, k: number, lang: string, labelled: boolean): Tick[] {
  const ticks: Tick[] = [];
  const y0 = dateOf(from).y - 1;
  const y1 = dateOf(to).y + 1;
  // AD k, 2k, …
  for (let j = Math.max(1, Math.ceil(y0 / k)); j * k <= y1; j++) {
    const y = j * k;
    ticks.push({ day: dayOf(y, 1, 1), label: labelled ? formatYear(y, lang) : undefined });
  }
  // k, 2k, … BC: astronomical 1 − k·j.
  for (let j = Math.max(1, Math.ceil((1 - y1) / k)); 1 - j * k >= y0; j++) {
    const y = 1 - j * k;
    ticks.push({ day: dayOf(y, 1, 1), label: labelled ? formatYear(y, lang) : undefined });
  }
  return ticks.sort((a, b) => a.day - b.day);
}

function monthTicks(from: number, to: number, n: number, lang: string, labelled: boolean): Tick[] {
  const ticks: Tick[] = [];
  const start = dateOf(from);
  let y = start.y;
  let m = start.m - ((start.m - 1) % n);
  for (;;) {
    const day = dayOf(y, m, 1);
    if (day > to) break;
    if (day >= from - 400) ticks.push({ day, label: labelled ? (m === 1 ? formatYear(y, lang) : monthName(m, lang)) : undefined });
    m += n;
    if (m > 12) {
      m -= 12;
      y += 1;
    }
  }
  return ticks;
}

function dayTicks(from: number, to: number, every: number, lang: string, labelled: boolean): Tick[] {
  const ticks: Tick[] = [];
  let day = Math.floor(from);
  if (every === 7) day -= weekday(day);
  else day -= ((day % every) + every) % every;
  for (; day <= to; day += every) {
    let label: string | undefined;
    if (labelled) {
      const { y, m, d } = dateOf(day);
      label = `${d} ${monthName(m, lang, true)}`;
      // The year once a month for days, once a year for weeks: enough to know where one is.
      if ((every <= 2 && d <= every) || (every === 7 && m === 1 && d <= 7)) label += `\u00a0${formatYear(y, lang)}`;
    }
    ticks.push({ day, label });
  }
  return ticks;
}

function ticksOf(step: Step, from: number, to: number, lang: string, labelled: boolean): Tick[] {
  switch (step.kind) {
    case 'hour':
      return hourTicks(from, to, step.n);
    case 'year':
      return yearTicks(from, to, step.n, lang, labelled);
    case 'month':
      return monthTicks(from, to, step.n, lang, labelled);
    case 'week':
      return dayTicks(from, to, 7, lang, labelled);
    case 'day':
      return dayTicks(from, to, step.n, lang, labelled);
  }
}

export interface Ruler {
  step: Step;
  major: Tick[];
  minor: Tick[];
}

/** Ticks for the days [from, to] at pxPerDay. */
export function ruler(from: number, to: number, pxPerDay: number, lang: string = language(), minGap = 80): Ruler {
  const step = majorStep(pxPerDay, minGap);
  let major = ticksOf(step, from, to, lang, true).filter((tick) => tick.day >= from && tick.day <= to);
  if (step.kind === 'year' && step.n > 1 && from <= 0 && to >= 0) {
    const room = minGap / pxPerDay;
    major = major.filter((tick) => Math.abs(tick.day) >= room);
    major.push({ day: 0, label: eraBoundaryLabel(lang) });
    major.sort((a, b) => a.day - b.day);
  }
  const fine = minorStep(step, pxPerDay);
  const majorDays = new Set(major.map((tick) => tick.day));
  const minor = fine ? ticksOf(fine, from, to, lang, false).filter((tick) => tick.day >= from && tick.day <= to && !majorDays.has(tick.day)) : [];
  return { step, major, minor };
}

/**
 * The second ruler: years counted from an anchor — Anno Mundi, years since
 * the Exodus, one's age. Year n starts on the anchor's n-th anniversary;
 * `base` is what the anchor's own year is called (1 for AM, 0 for an age).
 */
export function anchorRuler(from: number, to: number, pxPerDay: number, anchor: { y: number; m?: number; d?: number }, base = 0, minGap = 80): Ruler {
  const multiples = YEAR_MULTIPLES;
  const k = multiples.find((n) => n * 365 * pxPerDay >= minGap) ?? multiples[multiples.length - 1]!;
  const fine = multiples.filter((n) => n < k && k % n === 0 && n * 365 * pxPerDay >= 6)[0];
  const at = (n: number) => dayOf(anchor.y + n, anchor.m ?? 1, anchor.d ?? 1);
  const start = dayOf(anchor.y, anchor.m ?? 1, anchor.d ?? 1);
  const n0 = Math.floor((from - start) / YEAR_DAYS) - 1;
  const n1 = Math.ceil((to - start) / YEAR_DAYS) + 1;
  const make = (every: number, labelled: boolean): Tick[] => {
    const ticks: Tick[] = [];
    for (let n = Math.ceil(n0 / every) * every; n <= n1; n += every) {
      const day = at(n);
      if (day >= from && day <= to) ticks.push({ day, label: labelled ? String(n + base) : undefined });
    }
    return ticks;
  };
  const major = make(k, true);
  const majorDays = new Set(major.map((tick) => tick.day));
  return {
    step: { kind: 'year', n: k, minDays: k * 365 },
    major,
    minor: fine ? make(fine, false).filter((tick) => !majorDays.has(tick.day)) : [],
  };
}
