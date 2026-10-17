/**
 * An item's pictures in the details panel and full screen (Task §5.1, §7).
 *
 * The panel shows one picture large with its caption and credit; a gallery
 * adds arrows, a counter and a row of thumbs to pick from, and a swipe or
 * ← → steps through it. A click opens the picture full screen — the
 * lightbox, a modal <dialog>, so the strip's keys rest while it is open.
 *
 * Thumbs hold references in the image cache and give them back when the
 * panel moves on; large images come from the cache's "last few looked at".
 */

import { t } from '../core/i18n';
import type { Doc, ImageInfo } from '../core/model';
import { h } from './dom';
import type { ImageStore } from './images';

function icon(...paths: string[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const chevron = (side: 'left' | 'right') => icon(side === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6');

/** The caption and the credit (author · licence · source, linked when there is a URL). */
export function captionOf(info: ImageInfo, className = ''): HTMLElement | null {
  const credit = info.credit;
  const creditText = credit ? [credit.author, credit.license, credit.source].filter(Boolean).join(' · ') : '';
  if (!info.caption && !creditText) return null;
  return h(
    'figcaption',
    { class: className },
    info.caption ? h('span', { class: 'details-caption' }, info.caption) : null,
    creditText
      ? credit?.url
        ? h('a', { class: 'details-credit', href: credit.url, target: '_blank', rel: 'noopener noreferrer' }, creditText)
        : h('span', { class: 'details-credit' }, creditText)
      : null,
  );
}

/** Left and right on a picture: a swipe of 40 px steps, a shorter one is a tap. */
function swipe(el: HTMLElement, step: (direction: 1 | -1) => void, tap: () => void): void {
  let start: { x: number; y: number; id: number } | null = null;
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  el.addEventListener('pointerup', (event) => {
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    else if (Math.hypot(dx, dy) < 8) tap();
  });
  el.addEventListener('pointercancel', () => (start = null));
}

/** Thumbs for a row of pictures, each holding a cache reference until `dispose`. */
function thumbs(pictures: string[], store: ImageStore | null, className: string, onPick: (i: number) => void) {
  const held: string[] = [];
  let disposed = false;
  const buttons = pictures.map((hash, i) => {
    const img = h('img', { alt: '', draggable: 'false' });
    void store?.thumb(hash).then((url) => {
      if (!url) return;
      if (disposed) store?.release(hash);
      else {
        held.push(hash);
        img.src = url;
      }
    });
    return h('button', { class: className, type: 'button', 'aria-label': t('gallery', 'Picture {n} of {count}', { n: i + 1, count: pictures.length }), onclick: () => onPick(i) }, img);
  });
  return {
    buttons,
    dispose() {
      disposed = true;
      for (const hash of held.splice(0)) store?.release(hash);
    },
  };
}

export interface Gallery {
  el: HTMLElement;
  dispose(): void;
}

/** The pictures at the top of the details panel. */
export function detailsGallery(doc: Doc, pictures: string[], store: ImageStore | null): Gallery {
  const many = pictures.length > 1;
  let index = 0;
  const img = h('img', { class: 'details-image', alt: '', draggable: 'false' });
  const counter = h('span', { class: 'gallery-counter', hidden: !many });
  const caption = h('div', { class: 'details-caption-box' });
  const prev = h('button', { class: 'gallery-arrow gallery-arrow--prev', type: 'button', 'aria-label': t('gallery', 'Previous picture'), hidden: !many }, chevron('left'));
  const next = h('button', { class: 'gallery-arrow gallery-arrow--next', type: 'button', 'aria-label': t('gallery', 'Next picture'), hidden: !many }, chevron('right'));
  const zoom = h('button', { class: 'gallery-zoom', type: 'button', title: t('gallery', 'Full screen'), 'aria-label': t('gallery', 'Full screen') }, icon('M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'));
  const frame = h('div', { class: 'details-frame' }, img, prev, next, counter, zoom);
  const row = many ? thumbs(pictures, store, 'gallery-thumb', (i) => show(i)) : null;
  const strip = row ? h('div', { class: 'gallery-strip', role: 'group', 'aria-label': t('gallery', 'Pictures') }, ...row.buttons) : null;
  let disposed = false;

  function show(i: number): void {
    index = (i + pictures.length) % pictures.length;
    const hash = pictures[index]!;
    const info = doc.images[hash]!;
    img.style.aspectRatio = `${info.w}/${info.h}`;
    img.alt = info.caption ?? '';
    const wanted = index;
    void store?.image(hash).then((url) => {
      if (url && !disposed && index === wanted) img.src = url;
    });
    counter.textContent = `${index + 1} / ${pictures.length}`;
    caption.replaceChildren(captionOf(info) ?? '');
    row?.buttons.forEach((b, j) => b.setAttribute('aria-current', String(j === index)));
    row?.buttons[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  zoom.addEventListener('click', () => openLightbox(doc, pictures, index, store, show));
  swipe(img, (d) => many && show(index + d), () => openLightbox(doc, pictures, index, store, show));
  frame.addEventListener('keydown', (event) => {
    if (!many || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    event.stopPropagation();
    show(index + (event.key === 'ArrowLeft' ? -1 : 1));
  });
  show(0);
  return {
    el: h('figure', { class: `details-figure${many ? ' details-figure--gallery' : ''}` }, frame, strip, caption),
    dispose() {
      disposed = true;
      row?.dispose();
    },
  };
}

/**
 * The pictures full screen, from `index`. ← → and swipes step, Esc or a
 * click beside the picture closes; `onClose` hears where it ended, so the
 * panel shows the same picture.
 */
export function openLightbox(doc: Doc, pictures: string[], index: number, store: ImageStore | null, onClose?: (index: number) => void): void {
  const many = pictures.length > 1;
  const img = h('img', { class: 'lightbox-image', alt: '', draggable: 'false' });
  const counter = h('span', { class: 'lightbox-counter', hidden: !many });
  const caption = h('div', { class: 'lightbox-caption' });
  const close = h('button', { class: 'lightbox-close', type: 'button', 'aria-label': t('gallery', 'Close'), title: t('gallery', 'Close (Esc)') }, icon('M6 6l12 12', 'M18 6L6 18'));
  const prev = h('button', { class: 'lightbox-arrow lightbox-arrow--prev', type: 'button', 'aria-label': t('gallery', 'Previous picture'), hidden: !many }, chevron('left'));
  const next = h('button', { class: 'lightbox-arrow lightbox-arrow--next', type: 'button', 'aria-label': t('gallery', 'Next picture'), hidden: !many }, chevron('right'));
  const row = many ? thumbs(pictures, store, 'lightbox-thumb', (i) => show(i)) : null;
  const stage = h('div', { class: 'lightbox-stage' }, img);
  const el = h(
    'dialog',
    { class: 'lightbox', 'aria-label': t('gallery', 'Pictures') },
    stage,
    prev,
    next,
    h('div', { class: 'lightbox-top' }, counter, close),
    h('div', { class: 'lightbox-bottom' }, caption, row ? h('div', { class: 'lightbox-strip' }, ...row.buttons) : null),
  );

  function show(i: number): void {
    index = (i + pictures.length) % pictures.length;
    const hash = pictures[index]!;
    const info = doc.images[hash]!;
    img.alt = info.caption ?? '';
    const wanted = index;
    void store?.image(hash).then((url) => {
      if (url && index === wanted) img.src = url;
    });
    // The neighbours, ready before they are asked for.
    if (many) for (const j of [index + 1, index - 1]) void store?.image(pictures[(j + pictures.length) % pictures.length]!);
    counter.textContent = `${index + 1} / ${pictures.length}`;
    caption.replaceChildren(captionOf(info) ?? '');
    row?.buttons.forEach((b, j) => b.setAttribute('aria-current', String(j === index)));
    row?.buttons[index]?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  close.addEventListener('click', () => el.close());
  el.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (many) show(index + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  // A tap beside the picture closes; on the picture it does nothing but a swipe.
  swipe(stage, (d) => many && show(index + d), () => undefined);
  stage.addEventListener('click', (event) => {
    if (event.target === stage) el.close();
  });
  el.addEventListener('close', () => {
    row?.dispose();
    el.remove();
    onClose?.(index);
  });
  document.body.append(el);
  el.showModal();
  show(index);
  close.focus();
}
