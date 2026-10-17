/**
 * Compiles src/ modules for Node, so the tests exercise the very code the page
 * runs, and gives the tests a checker without a test framework.
 */
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** `load('core/dates', 'core/scale')` → one object with every export of those modules. */
export async function load(...modules) {
  const result = await build({
    stdin: {
      contents: modules.map((name) => `export * from './src/${name}';`).join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    define: { __APP_VERSION__: '"0.0.0-test"', __APP_HOME__: '"https://example.org/timeline"' },
    write: false,
    logLevel: 'silent',
  });
  const dir = await mkdtemp(join(tmpdir(), 'timeline-test-'));
  const file = join(dir, 'bundle.cjs');
  await writeFile(file, result.outputFiles[0].text);
  try {
    return createRequire(import.meta.url)(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `check(name, actual, expected)` compares as JSON; `done(label)` prints the tally and fails the process on any miss. */
export function checker() {
  let passed = 0;
  let failed = 0;
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a === b) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL  ${name}\n  expected: ${b}\n  actual:   ${a}`);
    }
  };
  const done = (label) => {
    console.log(`${label}: ${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
  };
  return { check, done };
}
