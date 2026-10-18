/**
 * About this timeline: the ⓘ beside the title. Who made the chronology, how
 * to reach them, their website and when the file was made — what Timeline
 * settings keep in `author` and `meta.created`, shown to whoever reads it,
 * the exported page included. A part the file does not have says so rather
 * than vanishing, so a reader knows it was not given, not lost.
 */

import { formatWhen } from '../core/dates';
import { t } from '../core/i18n';
import { isSafeUrl, type Doc } from '../core/model';
import { byId, h } from './dom';
import { app } from './state';
import { dialog } from './ui';

/** An address to write to, as people type one: it becomes a mailto link; anything else stays text. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `meta.created` as a date in the interface's language; a spelling this app did not write stays as the file has it. */
function createdText(created: string): string {
  const match = /^(-?\d{1,6})-(\d{2})-(\d{2})/.exec(created);
  if (!match) return created;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? formatWhen({ y, m, d }) : created;
}

/** A link the reader opens in a new tab; the page itself never follows it. */
const link = (href: string, text: string): HTMLAnchorElement => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

function rows(doc: Doc): [string, Node | string | null][] {
  const { name, contact, url } = doc.author ?? {};
  return [
    [t('info', 'Author'), name ?? null],
    [t('info', 'Contact'), contact ? (EMAIL.test(contact) ? link(`mailto:${contact}`, contact) : contact) : null],
    [t('info', 'Website'), url && isSafeUrl(url) ? link(url, url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')) : (url ?? null)],
    [t('info', 'Created'), doc.meta.created ? createdText(doc.meta.created) : null],
  ];
}

function showInfo(): void {
  const doc = app.session?.doc;
  if (!doc) return;
  const list = h('dl', { class: 'doc-info' });
  for (const [label, value] of rows(doc)) {
    list.append(h('dt', {}, label), value === null ? h('dd', { class: 'doc-info-none' }, t('info', 'Not specified')) : h('dd', { lang: doc.lang }, value));
  }
  void dialog({
    title: t('info', 'About this timeline'),
    body: h('div', {}, h('p', { class: 'dialog-text doc-info-title', lang: doc.lang }, doc.title), list),
    buttons: [{ label: t('ui', 'Close'), value: 'ok', primary: true }],
  });
}

export function setupInfo(): void {
  byId('doc-info').addEventListener('click', showInfo);
}
