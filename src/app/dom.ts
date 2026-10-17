/** Small helpers for building DOM by hand. */

type Attrs = Record<string, string | number | boolean | null | undefined | ((event: Event) => void)>;

/** `h('button', { class: 'x', onclick: fn }, 'Text', child)` */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, ''), value as EventListener);
    else if (key === 'class') el.className = String(value);
    else if (key === 'text') el.textContent = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An SVG shape: `shape('rect', { x: 4, y: 6, width: 16, height: 12 })`. */
export function shape(tag: 'path' | 'rect' | 'circle', attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** A 24 × 24 icon that screen readers pass over: path data as strings, or shapes. */
export function icon(...parts: (string | SVGElement)[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const part of parts) svg.append(typeof part === 'string' ? shape('path', { d: part }) : part);
  return svg;
}

/** The element with this id; throws if the template lacks it, so a typo fails at once. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return el as T;
}

/** A key pressed in a field is the field's: the page's shortcuts leave it alone. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/**
 * Follows one press of the pointer on `target`: `move` at every move, `up`
 * once when it is let go or cancelled (`event.type` says which). The listeners
 * go with the press.
 */
export function trackPointer(target: EventTarget, move: (event: PointerEvent) => void, up: (event: PointerEvent) => void): void {
  const onMove = (event: Event) => move(event as PointerEvent);
  const onUp = (event: Event) => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    up(event as PointerEvent);
  };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}

/** A mouse click follows a drag at once: swallow that one, and nothing later (a touch drag has no click). */
export function swallowClick(): void {
  const swallow = (e: Event) => (e.stopPropagation(), e.preventDefault());
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

/** A phone's width: one screen at a time, the panels are bottom sheets (styles.css says the same, at 720px). */
export const isNarrow = (): boolean => matchMedia('(max-width: 720px)').matches;

export const isTouch = (): boolean => matchMedia('(pointer: coarse)').matches;

export const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
