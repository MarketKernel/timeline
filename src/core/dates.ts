/**
 * Dates on the axis.
 *
 * Every position is a day number: day 0 is 1 January AD 1 in the proleptic
 * Gregorian calendar, and years are astronomical — year 0 is 1 BC, year -3 is
 * 4 BC. Fractional days are positions inside a day. Calendars are not
 * converted: a date is drawn where its numbers fall on this one axis (Task §2.1).
 *
 * A date stores the precision its source gives: a year alone, a month, a day.
 * It is drawn in the middle of that span — "sometime in 1446 BC" sits inside
 * 1446 BC's cell — and never shown more precisely than stored.
 */

import { dateFormat, language, tn } from './i18n';

export interface When {
  /** Astronomical year: 0 = 1 BC. */
  y: number;
  /** 1–12; absent for a year-only date. */
  m?: number;
  /** 1–31; absent unless the month is given. */
  d?: number;
  /** "c." / «ок.» */
  approx?: boolean;
  /** Give or take this many years: a soft halo around the dot. */
  spread?: number;
}

/** The end of a period that runs on to today. */
export interface Now {
  now: true;
}

export type End = When | Now;

export const isNow = (end: End | undefined): end is Now => !!end && (end as Now).now === true;

/** The mean Gregorian year, for scales and spreads — not for calendar arithmetic. */
export const YEAR_DAYS = 365.2425;

/** Years the app accepts: far beyond any chronology, well inside a double's integers. */
const MIN_YEAR = -999_999;
const MAX_YEAR = 999_999;

const mod = (a: number, b: number) => ((a % b) + b) % b;

export function isLeap(y: number): boolean {
  return (mod(y, 4) === 0 && mod(y, 100) !== 0) || mod(y, 400) === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(y: number, m: number): number {
  return m === 2 && isLeap(y) ? 29 : (MONTH_DAYS[m - 1] ?? 30);
}

/**
 * The day number of y-m-d. Howard Hinnant's days_from_civil, counted from
 * 1 March of year 0 so the leap day falls at the end of the cycle; exact for
 * every integer year, negative ones included. Out-of-range months and days roll over.
 */
export function dayOf(y: number, m = 1, d = 1): number {
  // Normalise the month first, so dayOf(y, 13, 1) is 1 January of y + 1.
  y += Math.floor((m - 1) / 12);
  m = mod(m - 1, 12) + 1;
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 306;
}

/** The calendar date of a day number; a fraction is the position inside that day. */
export function dateOf(n: number): { y: number; m: number; d: number } {
  const z = Math.floor(n) + 306;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return { y, m, d };
}

/** 0 = Monday … 6 = Sunday; 1 January AD 1 was a Monday. */
export const weekday = (n: number): number => mod(Math.floor(n), 7);

/** The first day of the span the date names. */
export function startOf(w: When): number {
  return dayOf(w.y, w.m ?? 1, w.d ?? 1);
}

/** The day after the span the date names: a period's end date is inclusive. */
export function endOf(w: When): number {
  if (w.m === undefined) return dayOf(w.y + 1, 1, 1);
  if (w.d === undefined) return dayOf(w.y, w.m + 1, 1);
  return dayOf(w.y, w.m, w.d) + 1;
}

/** Where an event is drawn: the middle of its span. */
export const midOf = (w: When): number => (startOf(w) + endOf(w)) / 2;

/** Today, by the device's clock, at day precision. Recomputed on every call. */
export function today(now = new Date()): When {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

export const todayDay = (now = new Date()): number => startOf(today(now));

/** The day after a period's last day; "now" is the end of today. */
export const endDay = (end: End, now = new Date()): number => (isNow(end) ? todayDay(now) + 1 : endOf(end));

/** The date with the precision of `like` whose span holds `day`, keeping like's approx and spread. */
export function snapTo(day: number, like: When): When {
  const { y, m, d } = dateOf(day);
  const out: When = { y };
  if (like.m !== undefined) out.m = m;
  if (like.d !== undefined) out.d = d;
  if (like.approx) out.approx = true;
  if (like.spread) out.spread = like.spread;
  return out;
}

/** The date moved by `days`, at the precision it already has. */
export const shiftWhen = (w: When, days: number): When => snapTo(midOf(w) + days, w);

export function isValidWhen(w: unknown): w is When {
  if (!w || typeof w !== 'object') return false;
  const { y, m, d, approx, spread } = w as Record<string, unknown>;
  if (!Number.isInteger(y) || (y as number) < MIN_YEAR || (y as number) > MAX_YEAR) return false;
  if (m !== undefined && (!Number.isInteger(m) || (m as number) < 1 || (m as number) > 12)) return false;
  if (d !== undefined && (m === undefined || !Number.isInteger(d) || (d as number) < 1 || (d as number) > daysInMonth(y as number, m as number))) return false;
  if (approx !== undefined && typeof approx !== 'boolean') return false;
  if (spread !== undefined && (typeof spread !== 'number' || !(spread > 0) || spread > 100_000)) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

const NB = ' ';

/** `4004 BC`, `AD 30`, `1517`; ru `4004 до н. э.`, `30 г. н. э.`, `1517`. */
export function formatYear(y: number, lang: string = language()): string {
  if (lang === 'ru') {
    if (y <= 0) return `${1 - y}${NB}до${NB}н.${NB}э.`;
    return y < 1000 ? `${y}${NB}г.${NB}н.${NB}э.` : String(y);
  }
  if (y <= 0) return `${1 - y}${NB}BC`;
  return y < 1000 ? `AD${NB}${y}` : String(y);
}

/** Month names made: every tick of a month or a day on the ruler asks for one. */
const shortMonths = new Map<string, string>();

/** The short month name: alone (`Apr`, `апр.`) or after a day (`14 мая`, genitive in Russian). */
export function monthName(m: number, lang: string = language(), withDay = false): string {
  const key = `${lang}|${m}|${withDay}`;
  let name = shortMonths.get(key);
  if (name === undefined) {
    const date = new Date(Date.UTC(2001, m - 1, 15));
    name = withDay
      ? (dateFormat({ day: 'numeric', month: 'short' }, lang).formatToParts(date).find((part) => part.type === 'month')?.value ?? String(m))
      : dateFormat({ month: 'short' }, lang).format(date);
    shortMonths.set(key, name);
  }
  return name;
}

const approxMark = (lang: string) => (lang === 'ru' ? `ок.${NB}` : `c.${NB}`);

/** The date as precise as it is stored: `c. 1446 BC`, `Oct 1517`, `14 Apr AD 30`. */
export function formatWhen(w: When, lang: string = language()): string {
  let text = formatYear(w.y, lang);
  if (w.m !== undefined) {
    text = w.d !== undefined ? `${w.d}${NB}${monthName(w.m, lang, true)}${NB}${text}` : `${monthName(w.m, lang)}${NB}${text}`;
  }
  return w.approx ? approxMark(lang) + text : text;
}

/** The date as text to edit, which `parseWhen` reads back: `c. 4174 BC ± 250`, `14 Apr AD 30`. */
export function whenText(w: When, lang: string = language()): string {
  return `${formatWhen(w, lang)}${w.spread ? ` ± ${w.spread}` : ''}`.replace(/\u00a0/g, ' ');
}

/** `± 100 years` for a date with a spread, else empty. */
export function formatSpread(w: When, lang: string = language()): string {
  return w.spread ? `±${NB}${tn('dates', '{count} year', '{count} years', w.spread)}` : '';
}

/**
 * A period: `1010–970 BC`, `1914–1918`, `5 BC – AD 30`, `1517 – present`.
 * Two year-only dates on the same side of the era share its mark.
 */
export function formatRange(start: When, end: End | undefined, lang: string = language()): string {
  if (!end) return formatWhen(start, lang);
  if (isNow(end)) return `${formatWhen(start, lang)} – ${lang === 'ru' ? 'н. вр.' : 'present'}`;
  const yearsOnly = start.m === undefined && end.m === undefined && !!start.approx === !!end.approx;
  if (yearsOnly && start.y === end.y) return formatWhen(start, lang);
  if (yearsOnly) {
    const mark = start.approx ? approxMark(lang) : '';
    if (start.y <= 0 && end.y <= 0) return `${mark}${1 - start.y}–${formatYear(end.y, lang)}`;
    if (start.y >= 1000) return `${mark}${start.y}–${end.y}`;
    if (start.y > 0 && end.y > 0) {
      return lang === 'ru' ? `${mark}${start.y}–${end.y}${NB}гг.${NB}н.${NB}э.` : `${mark}AD${NB}${start.y}–${end.y}`;
    }
  }
  return `${formatWhen(start, lang)} – ${formatWhen(end, lang)}`;
}

/** A length of time for the measure tool and the details: `480 years`, `3 months`, `12 days`. */
export function formatDuration(days: number): string {
  const abs = Math.abs(days);
  if (abs >= 2 * YEAR_DAYS) return tn('dates', '{count} year', '{count} years', Math.round(abs / YEAR_DAYS));
  if (abs >= 60) return tn('dates', '{count} month', '{count} months', Math.round(abs / (YEAR_DAYS / 12)));
  if (abs >= 14) return tn('dates', '{count} week', '{count} weeks', Math.round(abs / 7));
  return tn('dates', '{count} day', '{count} days', Math.round(abs));
}

/* ------------------------------------------------------------------ *
 * Parsing — the author's sources write dates as text (Task §4.1)
 * ------------------------------------------------------------------ */

/** Month names in English and Russian — short, long, and as they stand after a day ("мая") — to their numbers. */
let monthNames: Map<string, number> | null = null;
const plainWord = (word: string) => word.toLowerCase().replace(/\.$/, '');
function monthOf(word: string): number | undefined {
  if (!monthNames) {
    monthNames = new Map();
    for (const lang of ['en', 'ru']) {
      for (let m = 1; m <= 12; m++) {
        const date = new Date(Date.UTC(2001, m - 1, 15));
        for (const month of ['short', 'long'] as const) {
          monthNames.set(plainWord(dateFormat({ month }, lang).format(date)), m);
          const after = dateFormat({ day: 'numeric', month }, lang).formatToParts(date).find((part) => part.type === 'month')?.value;
          if (after) monthNames.set(plainWord(after), m);
        }
      }
    }
  }
  return monthNames.get(plainWord(word));
}

/** A year alone: `2166 BC`, `AD 30`, `30 AD`, `1517`, `-2166` (astronomical), `до н. э.`, `г. н. э.`. */
function parseYear(s: string): number | null {
  let match: RegExpExecArray | null;
  if ((match = /^(\d+) ?(BC|BCE|до н\. ?э\.?)$/i.exec(s))) return 1 - Number(match[1]);
  if ((match = /^(?:AD|CE) ?(\d+)$/i.exec(s) ?? /^(\d+) ?(?:AD|CE|г\. ?н\. ?э\.?|н\. ?э\.?)$/i.exec(s))) return Number(match[1]);
  if ((match = /^-?\d+$/.exec(s))) return Number(match[0]);
  return null;
}

/**
 * `"2166 BC"`, `"c. 1446 BC"`, `"AD 30"`, `"30 AD"`, `"1517-10-31"`, `"1517-10"`,
 * `"-2166"` (astronomical), `"2518 BC ± 100"`; also `"до н. э."` and «ок.»; and
 * with a month by name, as `formatWhen` writes it: `"Oct 1517"`, `"14 Apr AD 30"`,
 * `"14 апр. 30 г. н. э."`. Returns null for anything else, or for a date that
 * does not exist.
 */
export function parseWhen(source: string): When | null {
  let s = source.trim().replace(/\s+/g, ' ');
  let approx = false;
  let spread: number | undefined;
  const lead = /^(c\.|ca\.|circa|~|ок\.|около)\s*/i.exec(s);
  if (lead) {
    approx = true;
    s = s.slice(lead[0].length);
  }
  const tail = /\s*(±|\+-|\+\/-)\s*(\d+)$/.exec(s);
  if (tail) {
    spread = Number(tail[2]);
    s = s.slice(0, tail.index);
  }
  let w: When | null = null;
  let match: RegExpExecArray | null;
  if ((match = /^(-?\d+)-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s))) {
    w = { y: Number(match[1]), m: Number(match[2]) };
    if (match[3] !== undefined) w.d = Number(match[3]);
  } else if ((match = /^(?:(\d{1,2}) )?([\p{L}]+\.?) (.+)$/u.exec(s)) && monthOf(match[2]!) && parseYear(match[3]!) !== null) {
    w = { y: parseYear(match[3]!)!, m: monthOf(match[2]!) };
    if (match[1] !== undefined) w.d = Number(match[1]);
  } else {
    const y = parseYear(s);
    if (y !== null) w = { y };
  }
  if (!w) return null;
  if (approx) w.approx = true;
  if (spread) w.spread = spread;
  return isValidWhen(w) ? w : null;
}
