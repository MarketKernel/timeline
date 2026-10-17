/**
 * The page as it was loaded, before anything has touched it: what Export as a
 * web page copies, with the timeline put inside (export.ts). The page cannot
 * read its own file — from file:// nothing may be fetched — but the parser
 * has just handed over every byte of it, the one inline script included.
 *
 * main.ts imports this first, so it runs before any other module does. An
 * exported page never exports again: it does not keep a second copy of
 * itself, which would be the size of all its pictures.
 */

export const PAGE_SOURCE: string = document.getElementById('timeline-data') ? '' : document.documentElement.outerHTML;
