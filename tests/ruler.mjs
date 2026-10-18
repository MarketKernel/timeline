/** Zoom arithmetic, the scale bar and the ruler's ticks (Task §2.2, §11). */
import { checker, load } from '../tools/load.mjs';

const m = await load('core/scale', 'core/ruler', 'core/dates', 'core/i18n');
const { PRESETS, presetsFor, pxPerDayOf, describeScale, specText, scaleBar, nearestPreset, stepPreset, zoomAt, dayAt, xOf, fitView, zoomLimits, clampCenter, MAX_PX_PER_DAY } = m;
const { ruler, anchorRuler, majorStep, eraBoundaryLabel, dayOf, YEAR_DAYS, setLanguage } = m;
const { check, done } = checker();
setLanguage('en');
const NB = ' ';

// Scale.
check('1 px = 1 year', pxPerDayOf({ px: 1, unit: 'year', count: 1 }), 1 / YEAR_DAYS);
check('the presets, a pixel for a unit each, from a day to a million years', PRESETS.map(specText), ['1 px = 1 minute', '1 px = 1 hour', '1 px = 1 day', '1 px = 3 days', '1 px = 1 week', '1 px = 1 month', '1 px = 1 season', '1 px = 1 year', '1 px = 10 years', '1 px = 1 century', '1 px = 1,000 years', '1 px = 10,000 years', '1 px = 100,000 years', '1 px = 1 million years']);
check('a pixel a minute is the finest zoom', pxPerDayOf(PRESETS[0]), MAX_PX_PER_DAY);
const offered = (years) => presetsFor(years * YEAR_DAYS).map(specText).at(-1);
check('only the presets that leave a chronology 100 px: a life, flight, six thousand years of history, the Earth', [offered(40), offered(250), offered(6000), offered(4.5e9)], ['1 px = 1 season', '1 px = 1 year', '1 px = 10 years', '1 px = 1 million years']);
check('describe 1 px/20,000 years, 1 px/2.9 million years', [describeScale(1 / (YEAR_DAYS * 20000)), describeScale(1 / (YEAR_DAYS * 2.9e6))], [{ px: 1, unit: 'year', count: 20000 }, { px: 1, unit: 'year', count: 2.9e6 }]);
check('describe 40 px/day, 24 px/day, 1440 px/day', [describeScale(40), describeScale(24), describeScale(1440)], [{ px: 1, unit: 'minute', count: 36 }, { px: 1, unit: 'hour', count: 1 }, { px: 1, unit: 'minute', count: 1 }]);
check('describe 1 px/3 hours', describeScale(8), { px: 1, unit: 'hour', count: 3 });
check('describe 1 px/season, as the preset says it, and 1 px/2 months', [describeScale(4 / YEAR_DAYS), describeScale(6 / YEAR_DAYS)], [{ px: 1, unit: 'season', count: 1 }, { px: 1, unit: 'month', count: 2 }]);
check('describe 1 px/day', describeScale(1), { px: 1, unit: 'day', count: 1 });
check('describe 1 px/10 years, as the preset says it', describeScale(1 / (YEAR_DAYS * 10)), { px: 1, unit: 'year', count: 10 });
check('describe 1 px/year', describeScale(1 / YEAR_DAYS), { px: 1, unit: 'year', count: 1 });
check('describe 1 px/3 days', describeScale(1 / 3), { px: 1, unit: 'day', count: 3 });
check('describe 1 px/century', describeScale(1 / (YEAR_DAYS * 100)), { px: 1, unit: 'century', count: 1 });
check('describe 1 px/2.5 centuries', describeScale(1 / (YEAR_DAYS * 250)), { px: 1, unit: 'century', count: 2.5 });
check('nearest preset to 0.9 px/day', nearestPreset(0.9), { px: 1, unit: 'day', count: 1 });
check('finer than a pixel a day: a pixel an hour', stepPreset(1, 1), { px: 1, unit: 'hour', count: 1 });
check('step coarser from 1 px/day: 3 days, then a week', [stepPreset(1, -1), stepPreset(1 / 3, -1)], [{ px: 1, unit: 'day', count: 3 }, { px: 1, unit: 'week', count: 1 }]);
check('step coarser from 1 px/year', stepPreset(1 / YEAR_DAYS, -1), { px: 1, unit: 'year', count: 10 });
check('no step finer than the finest', stepPreset(MAX_PX_PER_DAY, 1), null);
{
  const bar = scaleBar(1 / YEAR_DAYS);
  check('scale bar at 1 px/year', [bar.count, bar.unit, Math.round(bar.px)], [100, 'year', 100]);
  check('scale bar text', bar.text, '100 years');
  check('scale bar at 40 px/day', scaleBar(40).text, '2 days');
  check('scale bar at a pixel a minute', scaleBar(1440).text, '2 hours');
  check('scale bar at a million years a pixel', scaleBar(1 / (YEAR_DAYS * 1e6)).text, '100 million years');
}
{
  const view = { center: 1000, pxPerDay: 2, width: 800 };
  check('x of the centre', xOf(view, 1000), 400);
  const zoomed = zoomAt(view, 3, 100, { min: 0.001, max: 40 });
  check('zoom keeps the day under the cursor', Math.abs(dayAt(zoomed, 100) - dayAt(view, 100)) < 1e-9, true);
  check('zoom is clamped', zoomAt(view, 1000, 100, { min: 0.001, max: 40 }).pxPerDay, 40);
  const fit = fitView(0, 1000, 1096, { min: 0.001, max: 40 });
  check('fit shows the extent', [Math.round(xOf(fit, 0)), Math.round(xOf(fit, 1000))], [48, 1048]);
  const lopsided = fitView(0, 1000, 1096, { min: 0.001, max: 40 }, [40, 356]);
  check('fit with room for a large card after the end', [Math.round(xOf(lopsided, 0)), Math.round(xOf(lopsided, 1000))], [40, 740]);
  check('limits reach the whole extent in 600 px', zoomLimits(6000 * YEAR_DAYS).min, 600 / (6000 * YEAR_DAYS));
  check('panning stops a screen past the end', clampCenter({ center: 1e9, pxPerDay: 1, width: 800 }, 0, 1000).center, 1400);
  check('with a start margin, the left edge stops that far before the start', clampCenter({ center: -1e9, pxPerDay: 2, width: 800 }, 0, 1000, 40).center - 400 / 2, -20);
}

// Ruler: labels ≥ 80 px apart at every preset and 50 random zooms, BC/AD handled.
const zooms = [...PRESETS.map(pxPerDayOf)];
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 50; i++) zooms.push(Math.exp(Math.log(1 / (YEAR_DAYS * 10000)) + random() * Math.log(1440 * YEAR_DAYS * 10000)));
let tooClose = 0;
let boundaryMissing = 0;
let yearZero = 0;
for (const pxPerDay of zooms) {
  for (const centre of [0, dayOf(-1446, 1, 1), dayOf(2026, 6, 1), dayOf(30, 4, 14)]) {
    const half = 900 / pxPerDay;
    const r = ruler(centre - half, centre + half, pxPerDay, 'en');
    for (let i = 1; i < r.major.length; i++) if ((r.major[i].day - r.major[i - 1].day) * pxPerDay < 80 - 1e-6) tooClose++;
    if (r.major.some((t) => /^0( |$)/.test(t.label ?? '') || t.label === `AD${NB}0`)) yearZero++;
    if (centre === 0 && r.step.kind === 'year') {
      const labels = r.major.map((t) => t.label);
      if (r.step.n > 1 && !labels.includes(eraBoundaryLabel('en'))) boundaryMissing++;
      if (r.step.n === 1) {
        const i = labels.indexOf(`1${NB}BC`);
        if (i < 0 || labels[i + 1] !== `AD${NB}1`) boundaryMissing++;
      }
    }
  }
}
check('major labels are ≥ 80 px apart', tooClose, 0);
check('the era boundary is labelled 1 BC | AD 1', boundaryMissing, 0);
check('no year 0 on the ruler', yearZero, 0);
check('the boundary label', eraBoundaryLabel('en'), `1${NB}BC | AD${NB}1`);
check('ru boundary label', eraBoundaryLabel('ru'), `1${NB}до${NB}н.${NB}э. | 1${NB}г.${NB}н.${NB}э.`);

{
  const r = ruler(dayOf(1500, 1, 1), dayOf(1800, 1, 1), 100 / (YEAR_DAYS * 100), 'en');
  check('centuries labelled at a century per 100 px', r.major.map((t) => t.label), ['1500', '1600', '1700', '1800']);
  check('decades are minor marks', r.minor.length, 27);
  const months = ruler(dayOf(1517, 1, 1), dayOf(1517, 12, 31), 10 / (YEAR_DAYS / 12) * 1.5 * 8, 'en');
  check('months: January shows the year', months.major[0].label, '1517');
  check('step at 1 px/day is a quarter', [majorStep(1).kind, majorStep(1).n], ['month', 3]);
  check('at a pixel an hour the weeks are labelled, the days marked', (() => { const r = ruler(dayOf(30, 4, 1), dayOf(30, 5, 1), 24, 'en'); return [r.step.kind, r.minor.every((t) => t.day % 1 === 0)]; })(), ['week', true]);
  check('at a pixel a minute the days are labelled, the hours marked but not named', (() => { const r = ruler(dayOf(30, 4, 1), dayOf(30, 4, 3), 1440, 'en'); return [r.step.kind, r.step.n, r.minor.length, r.minor.every((t) => t.label === undefined && t.day % 1 !== 0)]; })(), ['day', 1, 46, true]);
  check('step at 40 px/day is two days', [majorStep(40).kind, majorStep(40).n], ['day', 2]);
  check('step at 80 px/day is a day', [majorStep(80).kind, majorStep(80).n], ['day', 1]);
  const days = ruler(dayOf(30, 3, 30), dayOf(30, 4, 3), 40, 'en');
  check('days: the first label of a month shows the year', days.major.some((t) => t.label.endsWith(`Apr${NB}AD${NB}30`)), true);
  check('days: every day is marked', days.minor.length + days.major.length, 5);
}
{
  // A count from a founding in 4174 BC, year 1 at the anchor.
  const anchor = { y: -4173 };
  const r = anchorRuler(dayOf(-4173, 1, 1) - 10, dayOf(-3173, 1, 1) + 10, 100 / (YEAR_DAYS * 100), anchor, 1);
  check('years counted from 1', r.major.map((t) => t.label), ['1', '101', '201', '301', '401', '501', '601', '701', '801', '901', '1001']);
  const age = anchorRuler(dayOf(1980, 5, 17), dayOf(1990, 5, 18), 100 / YEAR_DAYS, { y: 1980, m: 5, d: 17 }, 0);
  check('ages fall on birthdays', age.major.slice(0, 3).map((t) => t.day), [dayOf(1980, 5, 17), dayOf(1981, 5, 17), dayOf(1982, 5, 17)]);
}

done('ruler');
