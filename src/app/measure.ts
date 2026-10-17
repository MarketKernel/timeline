/** Text widths without layout: a canvas measures with the same font the CSS uses. */

const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const context = canvas?.getContext('2d') ?? null;
const cache = new Map<string, number>();

export function textWidth(text: string, font: string): number {
  const key = `${font}\u0000${text}`;
  let width = cache.get(key);
  if (width === undefined) {
    if (context) {
      context.font = font;
      width = context.measureText(text).width;
    } else width = text.length * 7;
    if (cache.size > 5000) cache.clear();
    cache.set(key, width);
  }
  return width;
}

/** How many lines `text` takes at `width` px, breaking at spaces — as the browser would, near enough. */
export function lineCount(text: string, font: string, width: number): number {
  let lines = 1;
  let line = 0;
  const space = textWidth(' ', font);
  for (const word of text.split(/\s+/)) {
    const w = textWidth(word, font);
    if (line > 0 && line + space + w > width) {
      lines++;
      line = w;
    } else line += (line > 0 ? space : 0) + w;
  }
  return lines;
}
