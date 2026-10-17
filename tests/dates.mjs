/** Day numbers, calendars, display and the source date strings (Task §11). */
import { checker, load } from '../tools/load.mjs';

const { dayOf, dateOf, isLeap, daysInMonth, startOf, endOf, midOf, formatWhen, formatYear, formatRange, formatDuration, parseWhen, whenText, snapTo, shiftWhen, weekday, isValidWhen } = await load('core/dates');
const { setLanguage } = await load('core/i18n');
const { check, done } = checker();
const NB = ' ';
const nb = (s) => s.replaceAll(' ', NB);

// The round trip for every day from 5000 BC to AD 3000, and that consecutive days are consecutive dates.
{
  const from = dayOf(-4999, 1, 1);
  const to = dayOf(3000, 12, 31);
  let bad = 0;
  let prev = dateOf(from - 1);
  const started = performance.now();
  for (let n = from; n <= to; n++) {
    const date = dateOf(n);
    if (dayOf(date.y, date.m, date.d) !== n) bad++;
    const next = prev.d < daysInMonth(prev.y, prev.m) ? { y: prev.y, m: prev.m, d: prev.d + 1 } : prev.m < 12 ? { y: prev.y, m: prev.m + 1, d: 1 } : { y: prev.y + 1, m: 1, d: 1 };
    if (next.y !== date.y || next.m !== date.m || next.d !== date.d) bad++;
    prev = date;
  }
  check(`round trip over ${to - from + 1} days`, bad, 0);
  check('round trip is fast', performance.now() - started < 3000, true);
}

check('day 0 is 1 Jan AD 1', dayOf(1, 1, 1), 0);
check('dateOf(0)', dateOf(0), { y: 1, m: 1, d: 1 });
check('the day before is 31 Dec 1 BC', dateOf(-1), { y: 0, m: 12, d: 31 });
check('1970-01-01', dayOf(1970, 1, 1), 719162);
check('fractions sit in their day', dateOf(10.9), dateOf(10));
check('1 Jan AD 1 was a Monday', weekday(0), 0);
check('2026-10-13 is a Tuesday', weekday(dayOf(2026, 10, 13)), 1);
check('month 13 rolls over', dayOf(2000, 13, 1), dayOf(2001, 1, 1));

for (const [y, leap] of [[1900, false], [2000, true], [2024, true], [2023, false], [0, true], [-1, false], [-4, true], [-100, false], [-400, true]]) {
  check(`leap ${y}`, isLeap(y), leap);
}
check('Feb 1900', daysInMonth(1900, 2), 28);
check('Feb 2000', daysInMonth(2000, 2), 29);
check('Feb 1 BC (year 0)', daysInMonth(0, 2), 29);
check('Feb 5 BC (year -4)', daysInMonth(-4, 2), 29);

// Spans and positions.
check('a year spans the year', [startOf({ y: 2000 }), endOf({ y: 2000 })], [dayOf(2000, 1, 1), dayOf(2001, 1, 1)]);
check('a month spans the month', endOf({ y: 2000, m: 2 }) - startOf({ y: 2000, m: 2 }), 29);
check('a day spans a day', endOf({ y: 30, m: 4, d: 14 }) - startOf({ y: 30, m: 4, d: 14 }), 1);
check('a year-only date sits mid-year', midOf({ y: 2001 }), dayOf(2001, 1, 1) + 182.5);
check('snapping keeps precision', snapTo(dayOf(1517, 10, 31) + 0.4, { y: 1, approx: true }), { y: 1517, approx: true });
check('snapping to a day', snapTo(dayOf(1517, 10, 31) + 0.4, { y: 1, m: 1, d: 1 }), { y: 1517, m: 10, d: 31 });
check('a year-only date moves by years', shiftWhen({ y: -1446 }, 365.2425 * 3), { y: -1443 });

// Validity.
check('valid', isValidWhen({ y: -2166, approx: true, spread: 100 }), true);
check('30 February is not', isValidWhen({ y: 2000, m: 2, d: 30 }), false);
check('a day without a month is not', isValidWhen({ y: 2000, d: 3 }), false);
check('a fractional year is not', isValidWhen({ y: 1.5 }), false);

// Display, pinned.
setLanguage('en');
const en = [
  [{ y: -4003 }, '4004 BC'],
  [{ y: 30 }, 'AD 30'],
  [{ y: 999 }, 'AD 999'],
  [{ y: 1000 }, '1000'],
  [{ y: 1517 }, '1517'],
  [{ y: 0 }, '1 BC'],
  [{ y: -1445, approx: true }, 'c. 1446 BC'],
  [{ y: 30, m: 4, d: 14 }, '14 Apr AD 30'],
  [{ y: 1517, m: 10, d: 31 }, '31 Oct 1517'],
  [{ y: 1517, m: 10 }, 'Oct 1517'],
  [{ y: -585, m: 7 }, 'Jul 586 BC'],
];
for (const [w, text] of en) check(`en ${JSON.stringify(w)}`, formatWhen(w, 'en'), nb(text));
const ru = [
  [{ y: -4003 }, '4004 до н. э.'],
  [{ y: 30 }, '30 г. н. э.'],
  [{ y: 1517 }, '1517'],
  [{ y: -1445, approx: true }, 'ок. 1446 до н. э.'],
  [{ y: 30, m: 4, d: 14 }, '14 апр. 30 г. н. э.'],
  [{ y: 1517, m: 10, d: 31 }, '31 окт. 1517'],
  [{ y: 1945, m: 5, d: 9 }, '9 мая 1945'],
  [{ y: 1945, m: 5 }, 'май 1945'],
];
for (const [w, text] of ru) check(`ru ${JSON.stringify(w)}`, formatWhen(w, 'ru'), nb(text));
check('en range BC', formatRange({ y: -1009 }, { y: -969 }, 'en'), nb('1010–970 BC'));
check('ru range BC', formatRange({ y: -1009 }, { y: -969 }, 'ru'), nb('1010–970 до н. э.'));
check('en range modern', formatRange({ y: 1914 }, { y: 1918 }, 'en'), '1914–1918');
check('en range across the era', formatRange({ y: -4 }, { y: 30 }, 'en'), `5${NB}BC – AD${NB}30`);
check('en range early AD', formatRange({ y: 30 }, { y: 33 }, 'en'), nb('AD 30–33'));
check('ru range early AD', formatRange({ y: 30 }, { y: 33 }, 'ru'), nb('30–33 гг. н. э.'));
check('en open range', formatRange({ y: 1517 }, { now: true }, 'en'), '1517 – present');
check('en approx range', formatRange({ y: -1009, approx: true }, { y: -969, approx: true }, 'en'), nb('c. 1010–970 BC'));
check('en a one-year range', formatRange({ y: 1914 }, { y: 1914 }, 'en'), '1914');
check('year label', formatYear(-2165, 'en'), nb('2166 BC'));
check('duration in years', formatDuration(480 * 365.2425), '480 years');
check('duration in days', formatDuration(1), '1 day');

// The source date strings of §4.1.
const parse = [
  ['2166 BC', { y: -2165 }],
  ['c. 1446 BC', { y: -1445, approx: true }],
  ['AD 30', { y: 30 }],
  ['30 AD', { y: 30 }],
  ['1517-10-31', { y: 1517, m: 10, d: 31 }],
  ['1517-10', { y: 1517, m: 10 }],
  ['-2166', { y: -2166 }],
  ['1517', { y: 1517 }],
  ['2518 BC ± 100', { y: -2517, spread: 100 }],
  ['c. 2166 BC ±50', { y: -2165, approx: true, spread: 50 }],
  ['4004 до н. э.', { y: -4003 }],
  ['ок. 30 г. н. э.', { y: 30, approx: true }],
  ['1 BC', { y: 0 }],
  ['-0029-04-14', { y: -29, m: 4, d: 14 }],
];
for (const [text, w] of parse) check(`parse "${text}"`, parseWhen(text), w);
for (const bad of ['', 'yesterday', '2000-02-30', '2000-13', 'BC 30']) check(`parse "${bad}" fails`, parseWhen(bad), null);

// Dates as text to edit (the eras' list): written by whenText, read back by parseWhen, in either language.
{
  const dates = [{ y: -4173, approx: true, spread: 250 }, { y: 30, m: 4 }, { y: 30, m: 5, d: 14 }, { y: 1517, m: 10, d: 31 }, { y: -585 }, { y: 101 }, { y: -4, m: 12, d: 25, approx: true }, { y: 2001, m: 9 }];
  for (const lang of ['en', 'ru']) check(`dates as text round-trip in ${lang}`, dates.map((w) => parseWhen(whenText(w, lang))), dates);
  check('month names, short and long, in either language', [parseWhen('Oct 1517'), parseWhen('31 October 1517'), parseWhen('31 октября 1517'), parseWhen('май 2001')], [{ y: 1517, m: 10 }, { y: 1517, m: 10, d: 31 }, { y: 1517, m: 10, d: 31 }, { y: 2001, m: 5 }]);
  check('not a month, not a date', [parseWhen('AD 30'), parseWhen('Foo 1517'), parseWhen('31 Feb 2001')], [{ y: 30 }, null, null]);
}

done('dates');
