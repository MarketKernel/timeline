/**
 * Checks .timeline files, and libraries of them, the way the app reads them:
 * the same zip reader and the same model.ts. What it reports is what a reader
 * would see as a warning, or would not be able to open at all.
 *
 *   node tools/check.mjs moon.en.timeline    one file
 *   node tools/check.mjs library/            a shelf: index.json and every file it lists
 *
 * Problems (a file that does not open, a field the app drops, a picture or the
 * music missing, index.json disagreeing with a file) fail the run; notes (no
 * thumb for a picture) do not. docs/format.md describes both formats.
 */
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from './load.mjs';

const { readArchive, bytesSource, indexProblems } = await load('core/archive', 'core/zip', 'core/library');

let problems = 0;
const problem = (where, text) => {
  problems += 1;
  console.log(`  ✗ ${where}: ${text}`);
};
const note = (where, text) => console.log(`  · ${where}: ${text}`);

/** Reads and checks one .timeline; returns its document, or null when it does not open. */
async function checkFile(path) {
  console.log(path);
  let read;
  try {
    read = await readArchive(bytesSource(new Uint8Array(await readFile(path))));
  } catch (error) {
    // The zip itself, or what is in it: the same refusals the app gives.
    problem(error.code === 'model' || /^json-/.test(error.code ?? '') ? 'timeline.json' : 'zip', error.message);
    return null;
  }
  const { doc, warnings, archive: zip, prefix } = read;
  for (const w of warnings) problem(w.path, w.text);
  const thumbless = Object.keys(doc.images).filter((hash) => !zip.has(`${prefix}thumbs/${hash}.webp`));
  if (thumbless.length) note('thumbs', `${thumbless.length} of ${Object.keys(doc.images).length} pictures have no thumbs/<hash>.webp: their cards decode the large image`);
  console.log(`  ${doc.title} — ${doc.lang}, ${doc.items.length} items, ${Object.keys(doc.images).length} pictures${doc.music ? ', music' : ''}`);
  return doc;
}

/** Checks library/index.json and every file it lists. */
async function checkLibrary(dir) {
  const indexPath = join(dir, 'index.json');
  console.log(indexPath);
  let index;
  try {
    index = JSON.parse(await readFile(indexPath, 'utf8'));
  } catch (error) {
    problem('index.json', error.message);
    return;
  }
  // The index's own rules are the app's (core/library.ts); the files it lists are checked here.
  for (const { where, text } of indexProblems(index)) problem(where, text);
  if (!Array.isArray(index?.files)) return;
  for (const [i, value] of index.files.entries()) {
    const where = `files[${i}]`;
    // indexProblems has said what is wrong with an entry that is not one: the rest of the list is still checked.
    const entry = value && typeof value === 'object' ? value : {};
    if (typeof entry.cover === 'string' && entry.cover && !existsSync(join(dir, entry.cover))) problem(where, `the cover ${entry.cover} is not there`);
    if (typeof entry.file !== 'string') continue;
    const path = join(dir, entry.file);
    if (!entry.file || !existsSync(path)) {
      problem(where, `the file ${entry.file} is not there`);
      continue;
    }
    const doc = await checkFile(path);
    if (!doc) continue;
    if (doc.lang !== entry.lang) problem(where, `lang is "${entry.lang}", the file says "${doc.lang}"`);
    if (doc.items.length !== entry.items) problem(where, `items is ${entry.items}, the file has ${doc.items.length}`);
    if (Object.keys(doc.images).length !== entry.images) problem(where, `images is ${entry.images}, the file has ${Object.keys(doc.images).length}`);
    if (statSync(path).size !== entry.size) problem(where, `size is ${entry.size}, the file is ${statSync(path).size} bytes`);
  }
}

const paths = process.argv.slice(2);
if (!paths.length) {
  console.log('usage: node tools/check.mjs FILE.timeline … | LIBRARY_DIR');
  process.exit(2);
}
for (const path of paths) {
  if (existsSync(path) && statSync(path).isDirectory()) await checkLibrary(path);
  else await checkFile(path);
}
console.log(problems ? `${problems} problem${problems === 1 ? '' : 's'}` : 'all good');
process.exit(problems ? 1 : 0);
