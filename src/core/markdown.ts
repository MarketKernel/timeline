/**
 * Markdown-lite for an item's text: paragraphs (a blank line), line breaks,
 * *em* / _em_, **strong**, [links](https://…) and bare https:// addresses.
 * Nothing else — no HTML ever passes through. The result is a small tree the
 * view turns into DOM nodes itself, so a file from a stranger stays text.
 */

import { isSafeUrl } from './model';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'br' }
  | { kind: 'em' | 'strong'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] };

export type Paragraph = Inline[];

const PATTERN = /\*\*(.+?)\*\*|\*(.+?)\*|(?<![\w])_(.+?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|\n/gs;

function inline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of source.matchAll(PATTERN)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: source.slice(last, at) });
    last = at + match[0].length;
    const [whole, strong, em1, em2, label, href, bare] = match;
    if (whole === '\n') out.push({ kind: 'br' });
    else if (strong !== undefined) out.push({ kind: 'strong', children: inline(strong) });
    else if (em1 !== undefined || em2 !== undefined) out.push({ kind: 'em', children: inline((em1 ?? em2)!) });
    else if (label !== undefined) {
      out.push(isSafeUrl(href) ? { kind: 'link', href: href!, children: inline(label) } : { kind: 'text', text: whole });
    } else if (bare !== undefined) out.push({ kind: 'link', href: bare, children: [{ kind: 'text', text: bare }] });
  }
  if (last < source.length) out.push({ kind: 'text', text: source.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Paragraph[] {
  return source
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(inline);
}

const flat = (nodes: Inline[]): string => nodes.map((node) => (node.kind === 'text' ? node.text : node.kind === 'br' ? ' ' : flat(node.children))).join('');

/** Texts already flattened: the strip asks for every card's at every build, search for every item at every key. */
const plain = new Map<string, string>();

/** The text without marks: for search, tooltips and the card's first line. */
export function plainText(source: string): string {
  let text = plain.get(source);
  if (text === undefined) {
    text = parseMarkdown(source).map(flat).join(' ');
    if (plain.size >= 5000) plain.clear();
    plain.set(source, text);
  }
  return text;
}
