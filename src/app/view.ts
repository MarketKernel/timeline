/**
 * The strip: time left to right, things on it (Task §5.1, §5.4).
 *
 * Top to bottom: event cards in rows · the axis with dots · the era band ·
 * period bars in rows · the ruler, and the anchor ruler.
 *
 * Every layer is positioned in "layer pixels" relative to a reference day
 * fixed at the last render, and shifted by one transform. Panning changes only
 * that transform; the layers are rebuilt when panning stops, when the view
 * leaves what was built (the visible range ± one screen), or when the zoom
 * changes. The reference moves with every rebuild, so pixel values stay small
 * at any zoom — 40 px a day across six thousand years would overflow CSS.
 *
 * Only items within the built range exist in the DOM; elements are kept by id
 * between builds, so an image already decoded stays put.
 */

import { dateOf, dayOf, endDay, formatDuration, formatRange, formatWhen, formatYear, isNow, midOf, monthName, startOf, todayDay, YEAR_DAYS } from '../core/dates';
import { language, t, tn } from '../core/i18n';
import { layoutBars, layoutCards, type CardInput, type Placed } from '../core/layout';
import { plainText } from '../core/markdown';
import { colorOf, extentOf, picturesOf, rankOf, spanOf, type CardSize, type Doc, type ImageInfo, type Item } from '../core/model';
import { anchorRuler, ruler, type Tick } from '../core/ruler';
import { hexToOklch } from '../core/style';
import { clamp, clampCenter, dayAt, fitView, scaleBar, xOf, zoomAt, zoomLimits, type View } from '../core/scale';
import { h, icon, prefersReducedMotion, trackPointer } from './dom';
import { lineCount, textWidth } from './measure';

export interface ImageSource {
  /** A blob: URL of the image's thumb (with `large`, of the large image), or null when the file lacks it. */
  thumb(hash: string, large?: boolean): Promise<string | null>;
  /** The card that showed it is gone. */
  release(hash: string, large?: boolean): void;
}

export interface StripHandlers {
  /** A click on an item, or on empty space (null). */
  select(id: string | null): void;
  /** Double click or Enter on an item. */
  open(id: string): void;
  /** The view moved or zoomed (fired at most once a frame). */
  viewChanged(): void;
  /** The view came to rest after a pan, a zoom or a jump. */
  settled(): void;
}

/**
 * The strip starts at the first date: the screen's left edge stops this many
 * px before it — room for the first card's edge and its dot, no more.
 */
export const START_MARGIN = 40;
/** Paper beyond the card of the first or the last event, when it reaches past the margin. */
const CARD_ROOM = 8;

/** One card row; a compact card is two, a full card as many as its height needs. */
export const ROW = 24;
const ROW_GAP = 4;
const CARD_INSET = 12;

/**
 * Card sizes: the width, and how tall a picture may be as a share of it (a
 * landscape fills its natural height within that). Large and huge cards show
 * the large image, not the 192 px thumb, and a gallery as a mosaic.
 */
export const CARD_SIZES: Record<CardSize, { width: number; min: number; max: number; large: boolean }> = {
  small: { width: 132, min: 0.42, max: 0.75, large: false },
  normal: { width: 176, min: 0.41, max: 0.75, large: false },
  large: { width: 256, min: 0.5, max: 0.9, large: true },
  huge: { width: 360, min: 0.5, max: 1, large: true },
};
/** A round card's disc: a share of the width a rectangle of its size has. */
export const discOf = (size: CardSize): number => Math.round(CARD_SIZES[size].width * 0.72);
const sizeOfWidth = (width: number, round = false): CardSize =>
  (Object.keys(CARD_SIZES) as CardSize[]).find((size) => (round ? discOf(size) : CARD_SIZES[size].width) === width) ?? 'normal';

/** Ink that reads on a card's own fill: dark on a light one, light on a dark one, whatever the theme. */
const inkOn = (fill: string): [string, string] => (hexToOklch(fill)[0] > 0.62 ? ['#2a2420', '#574d44'] : ['#f6efe1', '#d9cfbf']);
const pictureHeight = (size: CardSize, info: ImageInfo): number => {
  const { width, min, max } = CARD_SIZES[size];
  return clamp(Math.round((width * info.h) / info.w), Math.round(width * min), Math.round(width * max));
};

interface CardEntry {
  card: HTMLElement;
  pointer: HTMLElement;
  /** The pictures it shows, by "t"/"l" + hash (thumb or large): each holds a reference in the image cache. */
  images: Map<string, HTMLImageElement>;
}
/** Between the axis and the lowest card row: room for the pointer. */
const AXIS_PAD = 8;
const BAR_ROW = 20;
/** The first row's top in the bars box. */
const BARS_TOP = 4;

const FONT_TITLE = '600 14px "Iowan Old Style", "Palatino Linotype", Charter, Georgia, serif';
/** Large and huge cards set their titles a size up (styles.css says the same). */
const FONT_TITLE_LARGE = '600 16px "Iowan Old Style", "Palatino Linotype", Charter, Georgia, serif';
const FONT_LINE = '400 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_BAR = '500 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_TODAY = '700 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Two pictures, one behind the other: the mark of a gallery. */
export const galleryIcon = (): SVGSVGElement =>
  icon('M8 7V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H17', 'M5.5 8h9A1.5 1.5 0 0 1 16 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 18.5v-9A1.5 1.5 0 0 1 5.5 8z');

/** A card's pointer, from its dot up `height` px to the card: straight, or leaning to a card moved by hand `shift` px — the date stays where it is. */
function lean(pointer: HTMLElement, shift: number, height: number): void {
  pointer.style.height = `${shift ? Math.hypot(shift, height) : height}px`;
  pointer.style.transform = shift ? `rotate(${Math.atan2(shift, height)}rad)` : '';
}

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export class Strip {
  doc: Doc | null = null;
  view: View = { center: 0, pxPerDay: 1, width: 800 };
  showMinor = true;
  secondRuler = true;
  reduceMotion = false;
  selected: string | null = null;
  /** Search hits: everything else is faded. Null shows all. */
  highlight: Set<string> | null = null;
  images: ImageSource | null = null;
  /** A selected period counts the second ruler from its start: a person's age while their life is selected. */
  tempAnchor: { at: { y: number; m?: number; d?: number }; label: string } | null = null;

  private extent: [number, number] = [0, 1];
  /** How far each event's card stands out of its dot, left and right, px: room is left for it at the ends of the strip. */
  private reach: { day: number; left: number; right: number }[] = [];
  /** Where each period's bar runs and how wide its name is, px: a name that does not fit is written after the bar. */
  private labels: { start: number; end: number; width: number }[] = [];
  private limits = { min: 0.0001, max: 40 };
  private ref = 0;
  private builtCenter = 0;
  private builtPx = 0;
  private builtWidth = 0;
  private frame = 0;
  private needsBuild = false;
  private animation: { from: View; to: View; start: number; duration: number } | null = null;
  private inertia: { velocity: number; last: number } | null = null;
  private barCache: { key: string; row: Map<string, number>; rows: number } | null = null;
  private version = 0;

  private readonly cardsArea: HTMLElement;
  private readonly cardsLayer: HTMLElement;
  private readonly axisLayer: HTMLElement;
  private readonly erasLayer: HTMLElement;
  private readonly barsBox: HTMLElement;
  private readonly barsLayer: HTMLElement;
  private readonly rulerLayer: HTMLElement;
  private readonly anchorBox: HTMLElement;
  private readonly anchorLayer: HTMLElement;
  private readonly anchorLabel: HTMLElement;
  private readonly rulerContext: HTMLElement;
  private readonly overlayLayer: HTMLElement;
  private readonly scaleBarEl: HTMLElement;
  private readonly layers: HTMLElement[];

  private readonly cardEls = new Map<string, CardEntry>();
  private readonly dotEls = new Map<string, HTMLElement>();
  private readonly barEls = new Map<string, HTMLElement>();
  private readonly eraEls = new Map<string, HTMLElement>();
  /** The last layout, by id: for keyboard focus and the tests. */
  placed = new Map<string, Placed>();

  constructor(
    readonly root: HTMLElement,
    private readonly handlers: StripHandlers,
  ) {
    const layer = (name: string) => h('div', { class: `layer ${name}` });
    this.cardsLayer = layer('cards-layer');
    this.axisLayer = layer('axis-layer');
    this.erasLayer = layer('eras-layer');
    this.barsLayer = layer('bars-layer');
    this.rulerLayer = layer('ruler-layer');
    this.anchorLayer = layer('ruler-layer');
    this.overlayLayer = layer('overlay-layer');
    this.layers = [this.cardsLayer, this.axisLayer, this.erasLayer, this.barsLayer, this.rulerLayer, this.anchorLayer, this.overlayLayer];
    this.scaleBarEl = h('div', { class: 'scalebar', 'aria-hidden': 'true' });
    this.cardsArea = h('div', { class: 'cards-area' }, this.cardsLayer, this.scaleBarEl);
    this.barsBox = h('div', { class: 'bars' }, h('div', { class: 'bars-inner' }, this.barsLayer));
    this.anchorLabel = h('span', { class: 'ruler-name' });
    this.rulerContext = h('span', { class: 'ruler-name ruler-context' });
    this.anchorBox = h('div', { class: 'ruler ruler--anchor' }, this.anchorLayer, this.anchorLabel);
    root.replaceChildren(
      this.cardsArea,
      h('div', { class: 'axis' }, this.axisLayer),
      h('div', { class: 'eras' }, this.erasLayer),
      this.barsBox,
      h('div', { class: 'ruler' }, this.rulerLayer, this.rulerContext),
      this.anchorBox,
      h('div', { class: 'overlay' }, this.overlayLayer),
    );
    this.listen();
    new ResizeObserver(() => this.resize()).observe(root);
  }

  /* ---------------------------------------------------------------- *
   * Document and view
   * ---------------------------------------------------------------- */

  setDoc(doc: Doc | null, images: ImageSource | null = this.images): void {
    if (this.images && images !== this.images) for (const entry of this.cardEls.values()) this.releaseImages(entry);
    this.doc = doc;
    this.images = images;
    for (const map of [this.cardEls, this.dotEls, this.barEls, this.eraEls]) map.clear();
    for (const layer of this.layers) layer.replaceChildren();
    // The file's texts are in its own language, whatever the interface speaks: hyphenation and screen readers follow it.
    for (const layer of [this.cardsLayer, this.erasLayer, this.barsLayer]) {
      if (doc) layer.lang = doc.lang;
      else layer.removeAttribute('lang');
    }
    this.changed();
  }

  /** The document changed (an edit, an undo): recompute what depends on it and rebuild. */
  changed(): void {
    const doc = this.doc;
    this.version++;
    this.barCache = null;
    this.extent = doc ? extentOf(doc) : [0, 1];
    this.reach = (doc?.items ?? [])
      .filter((item) => item.kind === 'event' && this.visibleItem(item))
      .map((item) => {
        const size = item.size ?? 'normal';
        const day = midOf(item.start);
        // A card moved by hand reaches as far as it stands from its dot.
        const shift = item.shift ?? 0;
        if (item.shape === 'round') return { day, left: discOf(size) / 2 - shift, right: discOf(size) / 2 + shift };
        return { day, left: CARD_INSET - shift, right: CARD_SIZES[size].width - CARD_INSET + shift };
      });
    // The today label stands to the right of its line: at a strip that ends today it needs room after the end.
    const today = todayDay() + 0.5;
    if (doc && today >= this.extent[0] && today <= this.extent[1] + 1) {
      const label = t('strip', 'Today').toUpperCase();
      this.reach.push({ day: today, left: 0, right: 4 + textWidth(label, FONT_TODAY) + label.length + 24 });
    }
    // A period too short for its name has it written after its end: that needs room too, at a zoom.
    const now = new Date();
    this.labels = (doc?.items ?? [])
      .filter((item) => item.kind === 'period' && item.end)
      .map((item) => {
        const [start, end] = spanOf(item, now);
        return { start, end, width: textWidth(item.title, FONT_BAR) + 12 };
      });
    this.limits = zoomLimits(this.extent[1] - this.extent[0]);
    this.scheduleBuild();
  }

  /**
   * The paper before the start and after the end at a zoom: 40 px, or more
   * where the card of an event near an end reaches further — a huge card of
   * the last event needs its whole width after it — or the today label, or
   * the name written after a short bar.
   */
  margins(pxPerDay: number): [number, number] {
    // Asked at every frame of a pan, at the one zoom: worked out once for it.
    const cached = this.marginsAt;
    if (cached && cached.version === this.version && cached.px === pxPerDay) return [...cached.value];
    const [lo, hi] = this.extent;
    let before = START_MARGIN;
    let after = START_MARGIN;
    for (const r of this.reach) {
      before = Math.max(before, r.left + CARD_ROOM - (r.day - lo) * pxPerDay);
      after = Math.max(after, r.right + CARD_ROOM - (hi - r.day) * pxPerDay);
    }
    for (const l of this.labels) {
      const bar = (l.end - l.start) * pxPerDay;
      if (bar < l.width) after = Math.max(after, l.width + CARD_ROOM - (hi - l.end) * pxPerDay);
    }
    this.marginsAt = { version: this.version, px: pxPerDay, value: [before, after] };
    return [before, after];
  }
  private marginsAt: { version: number; px: number; value: [number, number] } | null = null;

  /** The view that shows the whole extent, with room for the cards at both ends. */
  private fitted(): View {
    // Every build asks (maxRank): it changes only with the document and the width.
    const key = `${this.version}|${this.view.width}`;
    if (this.fittedView?.key !== key) {
      const [lo, hi] = this.extent;
      // The margins depend on the zoom, the zoom on the margins: twice is close enough.
      let view = fitView(lo, hi, this.view.width, this.limits, [START_MARGIN, START_MARGIN]);
      for (let i = 0; i < 2; i++) view = fitView(lo, hi, this.view.width, this.limits, this.margins(view.pxPerDay));
      this.fittedView = { key, view };
    }
    return { ...this.fittedView.view };
  }
  private fittedView: { key: string; view: View } | null = null;

  /** The zoom that shows the whole extent. */
  get fitPx(): number {
    return this.fitted().pxPerDay;
  }

  /** The centre that puts the start at its margin from the left edge, at a zoom. */
  startCenter(pxPerDay: number): number {
    return this.extent[0] + (this.view.width / 2 - this.margins(pxPerDay)[0]) / pxPerDay;
  }

  get extentDays(): [number, number] {
    return this.extent;
  }

  get zoomRange(): { min: number; max: number } {
    return this.limits;
  }

  setView(next: View, settle = true): void {
    const width = this.view.width;
    let view: View = { ...next, width, pxPerDay: clamp(next.pxPerDay, this.limits.min, this.limits.max) };
    // The strip stops at its last date as it does at the first: a margin of paper for the cards, then nothing.
    const [before, after] = this.margins(view.pxPerDay);
    view = clampCenter(view, this.extent[0], this.extent[1], before, after);
    const zoomed = view.pxPerDay !== this.view.pxPerDay;
    this.view = view;
    if (zoomed || this.outsideBuilt()) this.scheduleBuild();
    else this.applyPan();
    this.handlers.viewChanged();
    if (settle && !this.animation && !this.inertia) this.settle();
  }

  private settleTimer = 0;
  private settling = false;
  /** Rebuilds with a fresh layout once the view rests. */
  private settle(): void {
    clearTimeout(this.settleTimer);
    this.settling = true;
    this.settleTimer = window.setTimeout(() => {
      this.settling = false;
      if (this.builtCenter !== this.view.center || this.builtPx !== this.view.pxPerDay) this.scheduleBuild();
      this.handlers.settled();
    }, 140);
  }

  /** At rest: no animation, no inertia, no build waiting — what the browser tests wait for instead of a fixed pause. */
  get idle(): boolean {
    return !this.animation && !this.inertia && !this.needsBuild && !this.settling;
  }

  fit(animate = true): void {
    this.go(this.fitted(), animate);
  }

  /** The beginning: the first date at the margin from the left edge. */
  goStart(animate = true): void {
    this.goTo(this.startCenter(this.view.pxPerDay), this.view.pxPerDay, animate);
  }

  /** Centres a day, optionally at a zoom. */
  goTo(day: number, pxPerDay = this.view.pxPerDay, animate = true): void {
    this.go({ center: day, pxPerDay, width: this.view.width }, animate);
  }

  goToday(animate = true): void {
    this.goTo(todayDay(), this.view.pxPerDay, animate);
  }

  /** Zooms by `factor` around `x` (the middle by default). */
  zoomBy(factor: number, x = this.view.width / 2, animate = false): void {
    const target = zoomAt(this.view, factor, x, this.limits);
    this.go(target, animate);
  }

  panBy(px: number, animate = false): void {
    this.go({ ...this.view, center: this.view.center + px / this.view.pxPerDay }, animate);
  }

  /** Moves to `target`, eased over 300 ms unless motion is reduced. */
  go(target: View, animate = true): void {
    this.inertia = null;
    if (!animate || this.reduceMotion || prefersReducedMotion()) {
      this.animation = null;
      this.setView(target);
      return;
    }
    this.animation = { from: { ...this.view }, to: { ...target, width: this.view.width }, start: performance.now(), duration: 300 };
    this.tick();
  }

  private tick(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame((now) => this.step(now));
  }

  private step(now: number): void {
    if (this.animation) {
      const { from, to, start, duration } = this.animation;
      const p = Math.min(1, (now - start) / duration);
      const e = easeInOut(p);
      // The zoom eases on a log scale, the centre in screen terms: the eye keeps its place.
      // The last frame lands exactly on the target: exp(log(x)) is not always x, and 39.999 px a day is a coarser ruler than 40.
      const pxPerDay = p >= 1 ? to.pxPerDay : Math.exp(Math.log(from.pxPerDay) + (Math.log(to.pxPerDay) - Math.log(from.pxPerDay)) * e);
      const center = p >= 1 ? to.center : from.center + (to.center - from.center) * e;
      if (p >= 1) this.animation = null;
      this.setView({ center, pxPerDay, width: this.view.width }, p >= 1);
    } else if (this.inertia) {
      const dt = Math.min(48, now - this.inertia.last);
      this.inertia.last = now;
      this.inertia.velocity *= Math.pow(0.94, dt / 16);
      const before = this.view.center;
      this.setView({ ...this.view, center: this.view.center - (this.inertia.velocity * dt) / this.view.pxPerDay }, false);
      // Stopped by friction, or by either end of the strip.
      if (Math.abs(this.inertia.velocity) < 0.02 || this.view.center === before) {
        this.inertia = null;
        this.settle();
      }
    }
    if (this.needsBuild) this.build();
    if (this.animation || this.inertia) this.tick();
  }

  private scheduleBuild(): void {
    this.needsBuild = true;
    this.tick();
  }

  private resize(): void {
    const width = this.root.clientWidth;
    if (!width) return;
    const first = this.view.width === 800 && this.builtWidth === 0;
    this.view = { ...this.view, width };
    if (!first) this.scheduleBuild();
  }

  private outsideBuilt(): boolean {
    const screen = this.view.width / this.view.pxPerDay;
    // Bars are packed for the visible screen ± a fifth of one: rebuild before the edge shows.
    return Math.abs(this.view.center - this.builtCenter) > screen * 0.18;
  }

  /**
   * Labels of long eras and bars stay at the left edge of the screen. They
   * are moved with every frame of a pan, against the layer's own shift, so
   * they stand still instead of riding along and jumping back at the next
   * rebuild: x0 is the element's left in layer px, max how far the label may go.
   */
  private readonly sticky = new Map<HTMLElement, { x0: number; max: number; shown: string }>();
  private startX = '';
  private endX = '';

  private applyPan(): void {
    // Rounded once, so the layer's shift and the labels' cancel out exactly.
    const offset = Math.round((this.view.width / 2 + (this.ref - this.view.center) * this.view.pxPerDay) * 100) / 100;
    const transform = `translate3d(${offset}px,0,0)`;
    for (const layer of this.layers) layer.style.transform = transform;
    // The left edge of the screen, in layer px.
    const left = -offset;
    // Where the first date is on screen: the axis, the era band and the rulers begin there.
    const startX = `${Math.max(0, Math.round(offset + this.lx(this.extent[0])))}px`;
    if (startX !== this.startX) {
      this.startX = startX;
      this.root.style.setProperty('--start-x', startX);
    }
    // And where it ends, counted from the right edge.
    const endX = `${Math.max(0, Math.round(this.view.width - offset - this.lx(this.extent[1])))}px`;
    if (endX !== this.endX) {
      this.endX = endX;
      this.root.style.setProperty('--end-x', endX);
    }
    for (const [label, s] of this.sticky) {
      const shown = `translateX(${clamp(left - s.x0, 0, s.max).toFixed(2)}px)`;
      if (shown === s.shown) continue;
      s.shown = shown;
      label.style.transform = shown;
    }
  }

  /** Layer x of a day at the current zoom. */
  private lx(day: number): number {
    return (day - this.ref) * this.view.pxPerDay;
  }

  /** Screen x of a day, relative to the strip. */
  xOf(day: number): number {
    return xOf(this.view, day);
  }

  dayAt(x: number): number {
    return dayAt(this.view, x);
  }

  /* ---------------------------------------------------------------- *
   * Building the layers
   * ---------------------------------------------------------------- */

  /** Whether the strip shows an item at all: small events go when Settings hides them. */
  visibleItem(item: Item): boolean {
    return !(item.kind === 'event' && rankOf(item) === 3 && !this.showMinor);
  }

  /** The largest rank shown as a card at this zoom: only the large and huge cards at the coarsest. */
  private maxRank(): number {
    const ratio = this.view.pxPerDay / this.fitPx;
    return ratio < 1.8 ? 1 : ratio < 6 ? 2 : 3;
  }

  build(): void {
    this.needsBuild = false;
    const doc = this.doc;
    const view = this.view;
    if (!doc || !view.width) return;
    this.ref = view.center;
    this.builtCenter = view.center;
    this.builtPx = view.pxPerDay;
    this.builtWidth = view.width;
    const screen = view.width / view.pxPerDay;
    const from = view.center - screen * 1.5;
    const to = view.center + screen * 1.5;
    this.builtRange = [from, to];
    const today = todayDay();
    const lang = language();

    this.sticky.clear();
    this.buildEras(doc, from, to, today);
    this.buildBars(doc, from, to, today, lang);
    this.buildCards(doc, from, to, today, lang);
    this.buildRulers(doc, from, to, today, lang);
    this.applyPan();
    const bar = scaleBar(view.pxPerDay, 110);
    this.scaleBarEl.style.width = `${Math.round(bar.px)}px`;
    this.scaleBarEl.textContent = bar.text;
    this.root.dataset.built = String(++this.builds);
  }
  private builds = 0;
  /** The days the last build covered: restyle() redraws the rulers over the same stretch. */
  private builtRange: [number, number] = [0, 0];
  /** The second ruler's temporary anchor the rulers were last drawn for. */
  private builtAnchor: Strip['tempAnchor'] = null;

  private keep<T extends HTMLElement>(map: Map<string, T>, alive: Set<string>, release?: (id: string, el: T) => void): void {
    for (const [id, el] of map) {
      if (alive.has(id)) continue;
      el.remove();
      release?.(id, el);
      map.delete(id);
    }
  }

  private classes(item: Item, base: string, today: number): string {
    const planned = item.kind === 'event' ? midOf(item.start) > today : startOf(item.start) > today;
    let cls = base;
    if (planned) cls += ' planned';
    if (item.id === this.selected) cls += ' selected';
    if (this.highlight && !this.highlight.has(item.id)) cls += ' faded';
    return cls;
  }

  private buildEras(doc: Doc, from: number, to: number, today: number): void {
    const alive = new Set<string>();
    (this.erasLayer.parentElement as HTMLElement).hidden = !doc.items.some((item) => item.kind === 'era');
    for (const item of doc.items) {
      if (item.kind !== 'era' || !item.end || !this.visibleItem(item)) continue;
      const s = startOf(item.start);
      const e = endDay(item.end, new Date());
      if (e < from || s > to) continue;
      alive.add(item.id);
      let el = this.eraEls.get(item.id);
      if (!el) {
        el = h('button', { class: 'era', type: 'button', 'data-id': item.id }, h('span', { class: 'era-label' }));
        this.eraEls.set(item.id, el);
        this.erasLayer.append(el);
      }
      const x0 = this.lx(Math.max(s, from - 10));
      const x1 = this.lx(Math.min(e, to + 10));
      const title = item.title;
      el.className = this.classes(item, isNow(item.end) ? 'era era--open' : 'era', today);
      el.style.left = `${x0}px`;
      el.style.width = `${Math.max(1, x1 - x0)}px`;
      el.style.setProperty('--cat', colorOf(item, doc));
      el.title = `${title} · ${formatRange(item.start, item.end)}`;
      el.setAttribute('aria-label', `${title}, ${formatRange(item.start, item.end)}`);
      const label = el.firstElementChild as HTMLElement;
      label.textContent = title;
      // The label keeps to the visible part of a long era.
      const width = x1 - x0;
      const textW = textWidth(title, FONT_BAR) + 16;
      label.hidden = width < Math.min(textW, 40);
      this.sticky.set(label, { x0, max: Math.max(0, width - textW), shown: label.style.transform });
    }
    this.keep(this.eraEls, alive);
  }

  private buildBars(doc: Doc, from: number, to: number, today: number, lang: string): void {
    const now = new Date();
    // Only the bars in the built range are packed: the rows are as few as this stretch of time needs.
    const screen = this.view.width / this.view.pxPerDay;
    const near: [number, number] = [this.view.center - screen * 0.7, this.view.center + screen * 0.7];
    const periods = doc.items.filter((item) => {
      if (item.kind !== 'period' || !item.end || !this.visibleItem(item)) return false;
      const [s, e] = spanOf(item, now);
      return e >= near[0] && s <= near[1];
    });
    const px = this.view.pxPerDay;
    const key = `${this.version}:${px}:${lang}:${this.showMinor}:${periods.map((p) => p.id).join()}`;
    if (!this.barCache || this.barCache.key !== key) {
      const bars = periods.map((item) => {
        const [s0, e0] = spanOf(item, now);
        const start = s0 * px;
        const end = e0 * px;
        const label = textWidth(item.title, FONT_BAR) + 12;
        // A label that does not fit runs on after the bar's end: the row is kept free for it.
        return { id: item.id, start, end, visualEnd: end - start < label ? end + label : end, lane: item.lane };
      });
      this.barCache = { key, ...layoutBars(bars, 4) };
    }
    const { row, rows } = this.barCache;
    (this.barsBox.firstElementChild as HTMLElement).style.height = `${rows * BAR_ROW + 8}px`;
    this.barsBox.hidden = rows === 0;

    const alive = new Set<string>();
    for (const item of periods) {
      const [s, e] = spanOf(item, now);
      if (e < from || s > to) continue;
      alive.add(item.id);
      let el = this.barEls.get(item.id);
      if (!el) {
        el = h('button', { class: 'bar', type: 'button', 'data-id': item.id }, h('span', { class: 'bar-label' }));
        this.barEls.set(item.id, el);
        this.barsLayer.append(el);
      }
      const x0 = this.lx(Math.max(s, from - 10));
      const x1 = this.lx(Math.min(e, to + 10));
      const title = item.title;
      const range = formatRange(item.start, item.end);
      const fits = this.lx(e) - this.lx(s) >= textWidth(title, FONT_BAR) + 12;
      el.className = this.classes(item, `bar${isNow(item.end!) ? ' bar--open' : ''}${fits ? '' : ' bar--outside'}${item.start.approx ? ' bar--approx' : ''}`, today);
      el.style.left = `${x0}px`;
      el.style.width = `${Math.max(2, x1 - x0)}px`;
      el.style.top = `${BARS_TOP + (row.get(item.id) ?? 0) * BAR_ROW}px`;
      el.style.setProperty('--cat', colorOf(item, doc));
      el.title = `${title} · ${range}`;
      el.setAttribute('aria-label', `${title}, ${range}`);
      const label = el.firstElementChild as HTMLElement;
      label.textContent = title;
      // A long bar keeps its name in view, like an era; a label outside a short bar stays put.
      if (fits) this.sticky.set(label, { x0, max: Math.max(0, x1 - x0 - textWidth(title, FONT_BAR) - 14), shown: label.style.transform });
      else label.style.transform = '';
    }
    this.keep(this.barEls, alive);
  }

  /**
   * Where a bar dragged to `clientY` would go: the row under it — one past
   * the last row makes a new one. Null with no bars.
   */
  barSlotAt(clientY: number): { row: number; y: number } | null {
    const rows = this.barCache?.rows ?? 0;
    if (!rows) return null;
    const y = clientY - (this.barsBox.firstElementChild as HTMLElement).getBoundingClientRect().top;
    const row = clamp(Math.floor((y - BARS_TOP) / BAR_ROW), 0, rows);
    return { row, y: BARS_TOP + row * BAR_ROW };
  }

  /** The row a bar was given at the last build. */
  barRowOf(id: string): number | undefined {
    return this.barCache?.row.get(id);
  }

  private buildCards(doc: Doc, from: number, to: number, today: number, lang: string): void {
    const events = doc.items.filter((item) => item.kind === 'event' && this.visibleItem(item));
    const inRange = events.filter((item) => {
      const mid = midOf(item.start);
      return mid >= from && mid <= to;
    });
    const height = this.cardsArea.clientHeight;
    // The top 26 px belong to the scale bar and the today label: cards stay below them.
    const rows = Math.max(0, Math.floor((height - AXIS_PAD - 26) / ROW));
    const inputs: CardInput[] = [];
    for (const item of inRange) {
      const title = item.title;
      const info = item.image ? doc.images[item.image] : undefined;
      // Two lines at most are shown: the first few hundred characters decide how many.
      const line = item.text ? plainText(item.text).slice(0, 240) : '';
      const round = item.shape === 'round';
      /**
       * A full card of a size, in rows: picture, date, up to two lines of title, two of text.
       * Round: a medallion with the date and title under it, or a disc with them inside.
       */
      const full = (size: CardSize) => {
        const { width, large } = CARD_SIZES[size];
        if (round) {
          const d = discOf(size);
          if (!info) return { width: d, rows: Math.ceil((d + ROW_GAP) / ROW) };
          const titleLines = Math.min(2, lineCount(title, large ? FONT_TITLE_LARGE : FONT_TITLE, d - 12));
          return { width: d, rows: Math.ceil((d + 4 + 15 + titleLines * (large ? 20 : 18) + 6 + ROW_GAP) / ROW) };
        }
        const titleLines = Math.min(2, lineCount(title, large ? FONT_TITLE_LARGE : FONT_TITLE, width - 16));
        const textLines = line ? Math.min(2, lineCount(line, FONT_LINE, width - 16)) : 0;
        const height = 10 + (info ? pictureHeight(size, info) + 6 : 0) + 15 + titleLines * (large ? 20 : 18) + (textLines ? textLines * 16 + 2 : 0);
        return { width, rows: Math.ceil((height + ROW_GAP) / ROW) };
      };
      inputs.push({
        id: item.id,
        x: this.lx(midOf(item.start)),
        rank: rankOf(item),
        order: midOf(item.start),
        full: full(item.size ?? 'normal'),
        lane: item.lane,
        centered: round,
        shift: item.shift,
      });
    }
    const placed = layoutCards(inputs, { rows, gap: 12, inset: CARD_INSET, maxRank: this.maxRank() });
    this.placed = placed;

    // Dots: every event in range has one on the axis.
    const aliveDots = new Set<string>();
    const aliveCards = new Set<string>();
    const byId = new Map(inRange.map((item) => [item.id, item]));
    for (const item of inRange) {
      const p = placed.get(item.id)!;
      const x = this.lx(midOf(item.start));
      const title = item.title;
      const date = formatWhen(item.start, lang);
      aliveDots.add(item.id);
      let dot = this.dotEls.get(item.id);
      if (!dot) {
        dot = h('button', { class: 'dot', type: 'button', 'data-id': item.id }, h('span', { class: 'halo' }));
        this.dotEls.set(item.id, dot);
        this.axisLayer.append(dot);
      }
      dot.className = this.classes(item, `dot dot--i${rankOf(item)}${item.start.approx ? ' dot--approx' : ''}${p.mode === 'dot' ? ' dot--alone' : ''}`, today);
      dot.style.left = `${x}px`;
      dot.style.setProperty('--cat', colorOf(item, doc));
      const halo = dot.firstElementChild as HTMLElement;
      if (item.start.spread) {
        const w = item.start.spread * YEAR_DAYS * this.view.pxPerDay;
        halo.hidden = w < 6;
        halo.style.width = `${2 * w}px`;
      } else halo.hidden = true;
      // A dot with a card above it is not a second stop for Tab.
      if (p.mode === 'dot') {
        dot.tabIndex = 0;
        dot.title = `${title} · ${date}`;
        dot.setAttribute('aria-label', `${title}, ${date}`);
        dot.removeAttribute('aria-hidden');
      } else {
        dot.tabIndex = -1;
        dot.removeAttribute('title');
        dot.setAttribute('aria-hidden', 'true');
      }
      if (p.mode === 'dot') continue;

      aliveCards.add(item.id);
      let entry = this.cardEls.get(item.id);
      if (!entry) {
        entry = { card: h('button', { class: 'card', type: 'button', 'data-id': item.id }), pointer: h('span', { class: 'pointer' }), images: new Map() };
        this.cardEls.set(item.id, entry);
        this.cardsLayer.append(entry.pointer, entry.card);
      }
      this.fillCard(entry, byId.get(item.id)!, p, title, date, lang, today);
      const bottom = AXIS_PAD + p.row * ROW;
      entry.card.style.left = `${p.left}px`;
      entry.card.style.bottom = `${bottom}px`;
      entry.card.style.width = `${p.width}px`;
      entry.card.style.height = `${p.rows * ROW - ROW_GAP}px`;
      entry.pointer.style.left = `${x}px`;
      lean(entry.pointer, item.shift ?? 0, bottom);
      entry.pointer.className = this.classes(byId.get(item.id)!, 'pointer', today);
    }
    // Cards may lie over each other: a later event over an earlier one (hover and selection lift any to the top).
    [...aliveCards]
      .map((id) => byId.get(id)!)
      .sort((a, b) => midOf(a.start) - midOf(b.start))
      .forEach((item, i) => this.cardEls.get(item.id)!.card.style.setProperty('--z', String(i)));
    this.keep(this.dotEls, aliveDots);
    for (const [id, entry] of this.cardEls) {
      if (aliveCards.has(id)) continue;
      entry.card.remove();
      entry.pointer.remove();
      this.releaseImages(entry);
      this.cardEls.delete(id);
    }
  }

  private releaseImages(entry: CardEntry, keep: Set<string> = new Set()): void {
    for (const [key, img] of entry.images) {
      if (keep.has(key)) continue;
      this.images?.release(key.slice(1), key[0] === 'l');
      entry.images.delete(key);
      img.removeAttribute('src');
    }
  }

  /** A picture on a card: the element already showing it, or a new one that asks the cache (one reference each). */
  private cardImage(entry: CardEntry, hash: string, large: boolean, className: string): HTMLImageElement {
    const key = (large ? 'l' : 't') + hash;
    const current = entry.images.get(key);
    if (current) {
      current.className = className;
      return current;
    }
    const img = h('img', { class: className, alt: '', draggable: 'false' });
    entry.images.set(key, img);
    void this.images?.thumb(hash, large).then((url) => {
      if (!url) img.classList.add('card-image--missing');
      else if (entry.images.get(key) === img) img.src = url;
      // The card let go of it while it was loading: give the reference back.
      else this.images?.release(hash, large);
    });
    return img;
  }

  private fillCard(entry: CardEntry, item: Item, p: Placed, title: string, date: string, lang: string, today: number): void {
    const card = entry.card;
    const round = item.shape === 'round';
    const size = p.mode === 'full' ? sizeOfWidth(p.width, round) : 'normal';
    const pictures = picturesOf(item).filter((hash) => this.doc?.images[hash]);
    const key = `${p.mode}|${size}|${title}|${date}|${pictures.join()}|${lang}|${this.version}`;
    card.className = this.classes(
      item,
      `card card--${p.mode} card--${size}${pictures.length > 1 ? ' card--gallery' : ''}${round ? ' card--round' : ''}${item.background ? ' card--filled' : ''}`,
      today,
    );
    card.style.setProperty('--cat', colorOf(item, this.doc ?? undefined));
    if (item.background) {
      const [ink, soft] = inkOn(item.background);
      card.style.setProperty('--card-bg', item.background);
      card.style.setProperty('--card-ink', ink);
      card.style.setProperty('--card-ink-soft', soft);
    } else for (const name of ['--card-bg', '--card-ink', '--card-ink-soft']) card.style.removeProperty(name);
    card.setAttribute('aria-label', pictures.length > 1 ? `${title}, ${date}, ${tn('strip', '{count} picture', '{count} pictures', pictures.length)}` : `${title}, ${date}`);
    if (card.dataset.key === key) return;
    card.dataset.key = key;
    const parts: Node[] = [];
    const wanted = new Set<string>();
    const info = p.mode === 'full' && pictures.length ? this.doc!.images[pictures[0]!] : undefined;
    if (round && p.mode === 'full') {
      // A medallion: the picture in a circle, the date and title under it; without a picture, a disc that holds them.
      const d = discOf(size);
      const dateEl = h('span', { class: 'card-date' }, h('span', { class: 'card-mark', 'aria-hidden': 'true' }), date);
      const titleEl = h('span', { class: 'card-title' }, title);
      if (info) {
        const large = CARD_SIZES[size].large;
        wanted.add((large ? 'l' : 't') + pictures[0]!);
        const disc = h('span', { class: 'card-disc', style: `width:${d}px;height:${d}px` }, this.cardImage(entry, pictures[0]!, large, 'card-image'));
        if (pictures.length > 1) disc.append(h('span', { class: 'card-count', 'aria-hidden': 'true' }, galleryIcon(), String(pictures.length)));
        parts.push(disc, h('span', { class: 'card-caption' }, dateEl, titleEl));
      } else parts.push(h('span', { class: 'card-disc card-disc--text', style: `width:${d}px;height:${d}px` }, dateEl, titleEl));
      this.releaseImages(entry, wanted);
      parts.push(h('span', { class: 'card-resize', 'aria-hidden': 'true' }));
      card.replaceChildren(...parts);
      return;
    }
    if (info) {
      const spec = CARD_SIZES[size];
      // A large card shows a gallery as a mosaic: the first picture, and up to two beside it.
      const tiles = spec.large ? pictures.slice(0, 3) : pictures.slice(0, 1);
      const figure = h('span', { class: `card-figure${tiles.length > 1 ? ` card-mosaic card-mosaic--${tiles.length}` : ''}`, style: `height:${pictureHeight(size, info)}px` });
      tiles.forEach((hash, i) => {
        const large = spec.large && i === 0;
        wanted.add((large ? 'l' : 't') + hash);
        figure.append(this.cardImage(entry, hash, large, i ? 'card-image card-tile' : 'card-image'));
      });
      const more = pictures.length - tiles.length;
      if (tiles.length > 1 && more > 0) figure.append(h('span', { class: 'card-more', 'aria-hidden': 'true' }, `+${more}`));
      else if (tiles.length === 1 && pictures.length > 1) {
        figure.append(h('span', { class: 'card-count', 'aria-hidden': 'true' }, galleryIcon(), String(pictures.length)));
      }
      parts.push(figure);
    }
    this.releaseImages(entry, wanted);
    parts.push(h('span', { class: 'card-date' }, h('span', { class: 'card-mark', 'aria-hidden': 'true' }), date));
    parts.push(h('span', { class: 'card-title' }, title));
    if (p.mode === 'full' && item.text) {
      const line = plainText(item.text);
      if (line) parts.push(h('span', { class: 'card-line' }, line));
    }
    // Edit mode shows it: drag the corner to make the card larger or smaller.
    if (p.mode === 'full') parts.push(h('span', { class: 'card-resize', 'aria-hidden': 'true' }));
    card.replaceChildren(...parts);
  }

  private buildRulers(doc: Doc, from: number, to: number, today: number, lang: string): void {
    const px = this.view.pxPerDay;
    const ticks = (r: { major: Tick[]; minor: Tick[] }) => [
      ...r.minor.map((tick) => h('span', { class: 'tick tick--minor', style: `left:${this.lx(tick.day)}px` })),
      ...r.major.map((tick) => h('span', { class: 'tick tick--major', style: `left:${this.lx(tick.day)}px` }, h('span', { class: 'tick-label' }, tick.label ?? ''))),
    ];
    const main = ruler(from, to, px, lang);
    this.rulerLayer.replaceChildren(...ticks(main));
    // Below a year a step, the left edge says which year (and month) one is in.
    const left = dateOf(this.dayAt(0));
    const context = main.step.kind === 'year' ? '' : main.step.kind === 'month' ? formatYear(left.y, lang) : `${monthName(left.m, lang)} ${formatYear(left.y, lang)}`;
    this.rulerContext.textContent = context;
    this.rulerContext.hidden = !context;

    const temp = this.tempAnchor;
    this.builtAnchor = temp;
    const anchor = temp?.at ?? this.anchorDate(doc);
    this.anchorBox.hidden = !anchor || !this.secondRuler;
    if (anchor && this.secondRuler) {
      const r = anchorRuler(from, to, px, anchor, temp ? 0 : (doc.anchor?.base ?? 0));
      this.anchorLayer.replaceChildren(...ticks(r));
      const name = temp?.label ?? (doc.anchor?.label || t('strip', 'Years'));
      // When no year boundary is on screen, say which year it is.
      const visible = r.major.some((tick) => tick.day >= this.dayAt(0) && tick.day <= this.dayAt(this.view.width));
      const startDay = dayOf(anchor.y, anchor.m ?? 1, anchor.d ?? 1);
      const n = Math.floor((this.view.center - startDay) / YEAR_DAYS) + (temp ? 0 : (doc.anchor?.base ?? 0));
      this.anchorLabel.textContent = visible ? name : `${name} ${n}`;
      this.anchorBox.classList.toggle('ruler--temporary', !!temp);
    }

    const marks: HTMLElement[] = [];
    if (today >= from && today <= to) {
      marks.push(h('div', { class: 'today', style: `left:${this.lx(today + 0.5)}px` }, h('span', { class: 'today-label' }, t('strip', 'Today'))));
    }
    this.overlayLayer.replaceChildren(...marks);
  }

  /** Where the anchor ruler counts from: a date, or an item's start. */
  anchorDate(doc: Doc): { y: number; m?: number; d?: number } | null {
    const a = doc.anchor;
    if (!a) return null;
    if (a.at) return a.at;
    const item = doc.items.find((i) => i.id === a.item);
    return item ? item.start : null;
  }

  /** Builds again with a fresh layout: a setting changed, or a drag let go of what it moved. */
  refresh(): void {
    this.scheduleBuild();
  }

  /**
   * The selection or the search's highlight changed: only the classes that
   * show them change, and the second ruler when a period now counts the years
   * — no new layout. A build already on its way applies them itself.
   */
  restyle(): void {
    const doc = this.doc;
    if (!doc || this.needsBuild || !this.builtWidth) return;
    const mark = (el: HTMLElement, id: string) => {
      el.classList.toggle('selected', id === this.selected);
      el.classList.toggle('faded', !!this.highlight && !this.highlight.has(id));
    };
    for (const [id, entry] of this.cardEls) {
      mark(entry.card, id);
      mark(entry.pointer, id);
    }
    for (const map of [this.dotEls, this.barEls, this.eraEls]) for (const [id, el] of map) mark(el, id);
    if (this.tempAnchor !== this.builtAnchor) this.buildRulers(doc, ...this.builtRange, todayDay(), language());
  }

  /** The element that shows an item now, if any: a card, a dot, a bar or an era. */
  elementOf(id: string): HTMLElement | null {
    return this.cardEls.get(id)?.card ?? this.barEls.get(id) ?? this.eraEls.get(id) ?? (this.dotEls.get(id)?.tabIndex === 0 ? this.dotEls.get(id)! : null);
  }

  /** Pixels on the right the details panel covers; reveal() keeps items out from under it. */
  coveredRight = 0;

  /** While a card is dragged: its pointer leans from the dot to where the card is being put, in row `row`. */
  leanPointer(id: string, shift: number, row: number): void {
    const pointer = this.cardEls.get(id)?.pointer;
    if (pointer) lean(pointer, shift, AXIS_PAD + row * ROW);
  }

  /** Brings an item on screen (centred in the free part, at a zoom where it reads). */
  reveal(item: Item, animate = true): void {
    const [s, e] = spanOf(item);
    const free = this.view.width - this.coveredRight;
    const x0 = this.xOf(s);
    const x1 = item.kind === 'event' ? x0 + 180 : this.xOf(e);
    if (x0 >= 40 && Math.min(x1, x0 + free * 0.5) <= free - 24) return;
    let px = this.view.pxPerDay;
    if (item.end && (e - s) * px > free * 0.8) px = (free * 0.6) / (e - s);
    // Centre the item in the part of the strip the panel leaves free.
    const middle = item.kind === 'event' ? s : (s + e) / 2;
    this.goTo(middle + (this.view.width / 2 - free / 2) / px, px, animate);
  }

  /* ---------------------------------------------------------------- *
   * Measure: hold Alt and drag on the ruler (Task §5.2)
   * ---------------------------------------------------------------- */

  private measureEl: HTMLElement | null = null;

  clearMeasure(): boolean {
    if (!this.measureEl) return false;
    this.measureEl.remove();
    this.measureEl = null;
    return true;
  }

  /** The item nearest to a day, within 8 px, for naming the ends: "First flight → Moon landing". */
  private itemNear(day: number): Item | null {
    let best: Item | null = null;
    let distance = 8 / this.view.pxPerDay;
    for (const item of this.doc?.items ?? []) {
      if (item.kind === 'era' || !this.visibleItem(item)) continue;
      const d = Math.abs(spanOf(item)[0] - day);
      if (d < distance) {
        distance = d;
        best = item;
      }
    }
    return best;
  }

  private startMeasure(event: PointerEvent): void {
    event.preventDefault();
    this.clearMeasure();
    const rect = this.root.getBoundingClientRect();
    const snap = (x: number) => {
      const day = this.dayAt(x);
      const near = this.itemNear(day);
      return { day: near ? spanOf(near)[0] : day, item: near };
    };
    const from = snap(event.clientX - rect.left);
    const label = h('span', { class: 'measure-label' });
    const el = h('div', { class: 'measure' }, label);
    this.measureEl = el;
    this.root.append(el);
    const update = (clientX: number) => {
      const to = snap(clientX - rect.left);
      const [a, b] = from.day <= to.day ? [from, to] : [to, from];
      const x0 = this.xOf(a.day);
      const x1 = this.xOf(b.day);
      el.style.left = `${x0}px`;
      el.style.width = `${Math.max(1, x1 - x0)}px`;
      const names = a.item && b.item && a.item !== b.item ? `${a.item.title} → ${b.item.title}: ` : '';
      label.textContent = names + formatDuration(b.day - a.day);
    };
    update(event.clientX);
    trackPointer(window, (e) => update(e.clientX), () => undefined);
  }

  /* ---------------------------------------------------------------- *
   * Pointer, wheel, touch
   * ---------------------------------------------------------------- */

  /** Set by the editor: a pointerdown it takes for itself (dragging a card) never pans. */
  claimPointer: ((event: PointerEvent) => boolean) | null = null;

  private listen(): void {
    const root = this.root;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { x: number; center: number; moved: boolean; samples: [number, number][] } | null = null;
    let pinch: { distance: number; mid: number; view: View } | null = null;
    let suppressClick = false;

    const local = (event: { clientX: number }) => event.clientX - root.getBoundingClientRect().left;

    root.addEventListener('pointerdown', (event) => {
      // A touch pan makes no click: the flag from it must not eat the next tap.
      suppressClick = false;
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      if (event.altKey && (event.target as HTMLElement).closest('.ruler')) {
        this.startMeasure(event);
        return;
      }
      if (this.claimPointer?.(event)) return;
      this.animation = null;
      this.inertia = null;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: (a.x + b.x) / 2 - root.getBoundingClientRect().left, view: { ...this.view } };
        drag = null;
      } else if (pointers.size === 1) {
        drag = { x: event.clientX, center: this.view.center, moved: false, samples: [[performance.now(), event.clientX]] };
      }
    });

    root.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = (a.x + b.x) / 2 - root.getBoundingClientRect().left;
        const anchor = dayAt(pinch.view, pinch.mid);
        const pxPerDay = clamp((pinch.view.pxPerDay * distance) / Math.max(pinch.distance, 1), this.limits.min, this.limits.max);
        this.setView({ center: anchor - (mid - this.view.width / 2) / pxPerDay, pxPerDay, width: this.view.width }, false);
        suppressClick = true;
        return;
      }
      if (!drag) return;
      const dx = event.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        root.setPointerCapture(event.pointerId);
        root.classList.add('panning');
      }
      drag.samples.push([performance.now(), event.clientX]);
      if (drag.samples.length > 8) drag.samples.shift();
      this.setView({ ...this.view, center: drag.center - dx / this.view.pxPerDay }, false);
    });

    const end = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (pinch) {
        if (pointers.size < 2) {
          pinch = null;
          drag = null;
          this.settle();
        }
        return;
      }
      if (drag?.moved) {
        suppressClick = true;
        root.classList.remove('panning');
        const now = performance.now();
        const recent = drag.samples.filter(([time]) => now - time < 100);
        if (recent.length >= 2) {
          const [t0, x0] = recent[0]!;
          const [t1, x1] = recent[recent.length - 1]!;
          const velocity = (x1 - x0) / Math.max(t1 - t0, 1);
          if (Math.abs(velocity) > 0.3 && !this.reduceMotion) {
            this.inertia = { velocity, last: now };
            this.tick();
          }
        }
        if (!this.inertia) this.settle();
      }
      drag = null;
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);

    root.addEventListener(
      'click',
      (event) => {
        if (suppressClick) {
          suppressClick = false;
          event.stopPropagation();
          event.preventDefault();
          return;
        }
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-id]');
        this.handlers.select(target?.dataset.id ?? null);
      },
      true,
    );

    root.addEventListener('dblclick', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (target?.dataset.id) {
        this.handlers.open(target.dataset.id);
        return;
      }
      this.zoomBy(event.shiftKey ? 0.5 : 2, local(event), true);
    });

    root.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        let dx = event.deltaX;
        let dy = event.deltaY;
        if (event.deltaMode === 1) {
          dx *= 16;
          dy *= 16;
        } else if (event.deltaMode === 2) {
          dx *= this.view.width;
          dy *= this.view.width;
        }
        this.animation = null;
        this.inertia = null;
        if (event.ctrlKey || event.metaKey) {
          // A pinch on a trackpad arrives as a wheel with ctrlKey.
          const target = zoomAt(this.view, Math.exp(-dy * 0.0025), local(event), this.limits);
          this.setView(target);
        } else {
          // Both directions pan along the one axis there is.
          const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
          this.setView({ ...this.view, center: this.view.center + delta / this.view.pxPerDay });
        }
      },
      { passive: false },
    );
  }
}
