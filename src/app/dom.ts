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

/** The element with this id; throws if the template lacks it, so a typo fails at once. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return el as T;
}

export const isTouch = (): boolean => matchMedia('(pointer: coarse)').matches;

export const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
