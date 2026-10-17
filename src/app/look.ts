/**
 * A timeline's look on the page: its paper (in the light or the dark theme),
 * its texture and its title face — or the stock look when no file is open.
 */

import type { Style } from '../core/model';
import { paperTones, type PaperTone } from '../core/style';
import { app } from './state';

const TONES: readonly PaperTone[] = ['paper', 'paper-raised', 'paper-sunk', 'rule', 'rule-strong'];

/** One spelling per value, whatever order its keys were made in. */
export const canon = (value: unknown): string =>
  JSON.stringify(value, (_, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v)) ?? '';

/**
 * Puts the open file's look on the page — or the stock look when no file is
 * open. On :root, so the details panel and the dialogs wear it too; called
 * again when the theme changes, since the dark theme has its own paper.
 */
export function applyStyle(style: Style | undefined = app.session?.doc.style): void {
  const root = document.documentElement;
  // Most edits leave the look as it was: nothing to set, nothing to redraw.
  const key = `${root.dataset.theme}|${canon(style)}`;
  if (key === appliedLook) return;
  appliedLook = key;
  const tones = style?.paper ? paperTones(style.paper, root.dataset.theme === 'dark') : null;
  for (const tone of TONES) {
    if (tones) root.style.setProperty(`--${tone}`, tones[tone]);
    else root.style.removeProperty(`--${tone}`);
  }
  if (style?.texture && style.texture !== 'grain') root.dataset.texture = style.texture;
  else delete root.dataset.texture;
  if (style?.font === 'sans') root.style.setProperty('--serif', 'var(--sans)');
  else root.style.removeProperty('--serif');
  app.minimap?.invalidate();
}

let appliedLook: string | null = null;
