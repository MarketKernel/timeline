/** `npm test`: every unit test in Node, one after another; the first failure stops the run. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from '../tools/load.mjs';

const TESTS = ['build', 'dates', 'ruler', 'layout', 'zip', 'archive', 'files', 'library', 'model', 'style', 'eras', 'commands', 'search', 'exif', 'i18n', 'check'];
const started = performance.now();
for (const name of TESTS) {
  const result = spawnSync(process.execPath, [join(root, 'tests', `${name}.mjs`), ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`all ${TESTS.length} unit tests passed in ${((performance.now() - started) / 1000).toFixed(1)} s`);
