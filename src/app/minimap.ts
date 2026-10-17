/**
 * The mini-map (Task §5.2): the whole extent as the era colours, a density
 * strip of events beneath, and a frame for what the strip shows. Drag the
 * frame to pan; click anywhere to jump there.
 */

import { endDay, midOf, startOf } from '../core/dates';
import { t } from '../core/i18n';
import { colorOf, rankOf, type Doc } from '../core/model';
import { clamp } from '../core/scale';
import { h } from './dom';
import { on } from './state';
import type { Strip } from './view';

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly frame: HTMLElement;
  private range: [number, number] = [0, 1];
  private dirty = true;
  private frameRequest = 0;
  /** The root's width, kept from the resize observer: read on every pan frame, it would force a layout. */
  private width = 0;

  constructor(
    readonly root: HTMLElement,
    private readonly strip: Strip,
  ) {
    this.canvas = h('canvas', { class: 'minimap-canvas', 'aria-hidden': 'true' });
    const label = () => t('minimap', 'Visible range');
    this.frame = h('div', { class: 'minimap-frame', role: 'slider', tabindex: '-1', 'aria-label': label() });
    on('language', () => this.frame.setAttribute('aria-label', label()));
    root.replaceChildren(this.canvas, this.frame);
    new ResizeObserver(() => {
      this.width = root.clientWidth;
      this.dirty = true;
      this.update();
    }).observe(root);
    // An edit, an undo, a restored draft: the picture is redrawn once, whatever else asked for it in the same frame.
    on('changed', () => this.invalidate());
    this.listen();
  }

  /** The document or its look changed: the picture is redrawn at the next frame. */
  invalidate(): void {
    this.dirty = true;
    if (this.frameRequest) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.update();
    });
  }

  private get span(): number {
    if (!this.width) this.width = this.root.clientWidth;
    return this.width;
  }

  private toX(day: number): number {
    const [a, b] = this.range;
    return ((day - a) / (b - a)) * this.span;
  }

  private toDay(x: number): number {
    const [a, b] = this.range;
    return a + (x / Math.max(1, this.span)) * (b - a);
  }

  /** Moves the frame; redraws the picture only when the document or the size changed. */
  update(): void {
    const doc = this.strip.doc;
    if (!doc) return;
    if (this.dirty) this.draw(doc);
    const view = this.strip.view;
    const half = view.width / 2 / view.pxPerDay;
    const x0 = this.toX(view.center - half);
    const x1 = this.toX(view.center + half);
    const width = this.span;
    const left = clamp(x0, 0, width);
    const right = clamp(x1, 0, width);
    this.frame.style.left = `${left}px`;
    this.frame.style.width = `${Math.max(4, right - left)}px`;
  }

  private draw(doc: Doc): void {
    this.dirty = false;
    const [lo, hi] = this.strip.extentDays;
    const pad = (hi - lo) * 0.02;
    this.range = [lo - pad, hi + pad];
    const ratio = devicePixelRatio || 1;
    const width = this.span;
    const height = this.root.clientHeight;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);
    const style = getComputedStyle(this.root);
    const ink = style.getPropertyValue('--ink-soft').trim() || '#5e544b';
    const now = new Date();

    // Eras: the top half, in their colours.
    const band = Math.round(height * 0.45);
    ctx.globalAlpha = 0.55;
    for (const item of doc.items) {
      if (item.kind !== 'era' || !item.end) continue;
      const x0 = this.toX(startOf(item.start));
      const x1 = this.toX(endDay(item.end, now));
      ctx.fillStyle = colorOf(item, doc);
      ctx.fillRect(x0, 2, Math.max(1, x1 - x0 - 0.5), band - 2);
    }
    // Events: a density strip, every 2 px a column as tall as the square root of its count.
    const bins = new Float32Array(Math.ceil(width / 2) + 1);
    for (const item of doc.items) {
      if (item.kind !== 'event') continue;
      const i = Math.floor(this.toX(midOf(item.start)) / 2);
      if (i >= 0 && i < bins.length) bins[i]! += [0, 3, 1, 0.5][rankOf(item)]!;
    }
    const max = Math.max(1, ...bins);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = ink;
    const room = height - band - 4;
    bins.forEach((count, i) => {
      if (!count) return;
      const hgt = Math.max(1.5, Math.sqrt(count / max) * room);
      ctx.fillRect(i * 2, height - 2 - hgt, 1.5, hgt);
    });
    ctx.globalAlpha = 1;
  }

  private listen(): void {
    let drag: { x: number; center: number } | null = null;
    this.root.addEventListener('pointerdown', (event) => {
      const rect = this.root.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (event.target === this.frame) {
        drag = { x: event.clientX, center: this.strip.view.center };
        this.root.setPointerCapture(event.pointerId);
      } else {
        this.strip.goTo(this.toDay(x));
      }
      event.preventDefault();
    });
    this.root.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const [a, b] = this.range;
      const days = ((event.clientX - drag.x) / Math.max(1, this.span)) * (b - a);
      this.strip.setView({ ...this.strip.view, center: drag.center + days });
    });
    const end = () => {
      drag = null;
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
  }
}
