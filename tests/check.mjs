/**
 * tools/check.mjs, the checker docs/format.md tells authors to run: the test
 * library passes it, and a file or an index.json with mistakes fails it and
 * says where.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checker, load, root } from '../tools/load.mjs';
import { sampleLibrary } from '../tools/sample.mjs';

const { check, done } = checker();
const { ZipWriter, memorySink } = await load('core/zip');
const run = (...args) => spawnSync(process.execPath, [join(root, 'tools', 'check.mjs'), ...args], { encoding: 'utf8' });

const dir = await mkdtemp(join(tmpdir(), 'timeline-check-'));
try {
  await sampleLibrary(dir);
  const good = run(dir);
  check('the test library passes', [good.status, good.stdout.trim().split('\n').pop()], [0, 'all good']);

  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  index.files[0].lang = 'de';
  index.files[1].file = 'gone.timeline';
  await writeFile(join(dir, 'index.json'), JSON.stringify(index));
  const bad = run(dir);
  check('an index that disagrees with its files fails', [bad.status, /files\[0\]: lang is "de", the file says "en"/.test(bad.stdout), /files\[1\]: the file gone.timeline is not there/.test(bad.stdout)], [1, true, true]);

  const broken = join(dir, 'broken.timeline');
  const out = memorySink();
  const writer = new ZipWriter(out.sink);
  const json = { format: 'timeline', version: 1, lang: 'en', meta: { id: 'broken', kind: 'history' }, title: 'Broken', items: [{ id: 'p', kind: 'period', start: { y: 1900 }, title: 'No end' }] };
  await writer.add('timeline.json', new TextEncoder().encode(JSON.stringify(json)));
  await writer.finish();
  await writeFile(broken, out.bytes());
  const file = run(broken);
  check('a file with a bad item fails, and says which', [file.status, /items\[0\]/.test(file.stdout)], [1, true]);

  await writeFile(join(dir, 'index.json'), JSON.stringify({ format: 'timeline-library', version: 1, files: [null, { id: 'a', file: 7 }] }));
  const odd = run(dir);
  check('entries that are not entries are reported, not a crash', [odd.status, /files\[0\]: id must be a non-empty string/.test(odd.stdout), odd.stderr], [1, true, '']);
  check('…and the run ends with its count', /^\d+ problems?$/.test(odd.stdout.trim().split('\n').pop()), true);

  await writeFile(join(dir, 'not.timeline'), 'not a zip');
  check('a file that is not a zip fails', run(join(dir, 'not.timeline')).status, 1);
} finally {
  await rm(dir, { recursive: true, force: true });
}
done('check');
