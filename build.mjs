/**
 * Bundles src/ into ONE self-contained build/timeline.html.
 *
 * Styles, the icon and the compiled TypeScript are all inlined, so
 * the page opens from a file:// URL with no network and no sibling files. It
 * holds no data at all: every chronology is a .timeline file of its own, opened
 * by the user.
 *
 * Beside it goes build/pages/: the same page as an installable PWA for GitHub
 * Pages — a manifest, icons, a service worker that keeps it offline. Its shelf
 * shows the chronologies of a library/ folder put beside it on the site; the
 * build puts none there.
 *
 * The version is package.json's and nowhere else: the page shows it, writes it
 * into every file it saves (meta.generator), and the PWA's cache is named after it.
 */
import { build, transform } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const at = (...parts) => join(root, ...parts);
const watch = process.argv.includes('--watch');
const outFile = at('build', 'timeline.html');

/** §11: the page carries code, not data, and stays small. */
const PAGE_BUDGET = 400 * 1024;

/**
 * package.json's version, and the one the page shows: the same for a build of
 * the commit tagged v<version>, with the commit added for any other —
 * 0.1.0+1a2b3c4 — so a page built from main is not taken for a release. And
 * the project's home, which About links to.
 */
async function readRelease() {
  const { version, homepage } = JSON.parse(await readFile(at('package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json: the version must be x.y.z, not ${version}`);
  if (!/^https:\/\/\S+$/.test(homepage ?? '')) throw new Error(`package.json: the homepage must be an https:// address, not ${homepage}`);
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  };
  const tagged = process.env.RELEASE_TAG === `v${version}` || git('tag', '--points-at', 'HEAD').split('\n').includes(`v${version}`);
  const commit = tagged ? '' : git('rev-parse', '--short', 'HEAD');
  return { version, label: commit ? `${version}+${commit}` : version, homepage };
}

/** Set by buildOnce() before anything is bundled. */
let release;

/** `</script` inside a string literal would close the inline tag early. */
const guard = (code) => code.replace(/<\/(script|style)/gi, '<\\/$1');

/**
 * `<!--` followed later by `<script` puts the HTML parser into the "script data
 * double escaped" state: the closing </script> stops closing, and the page runs
 * nothing at all. It can hide in a string; better to fail the build than ship it.
 */
function assertScriptCloses(code) {
  const open = code.indexOf('<!--');
  if (open >= 0 && /<script/i.test(code.slice(open))) {
    throw new Error('The bundled script has "<!--" followed by "<script": the inline tag would never close');
  }
}

async function bundle(entry) {
  const result = await build({
    entryPoints: [at(entry)],
    bundle: true,
    format: 'iife',
    target: ['es2022'],
    platform: 'browser',
    minify: !watch,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    define: { __APP_VERSION__: JSON.stringify(release.label), __APP_HOME__: JSON.stringify(release.homepage) },
    write: false,
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('esbuild returned an empty result');
  return output.text;
}

/** The whole point of the build: nothing may be fetched at runtime. */
export function assertSelfContained(html) {
  /** @type {[RegExp, string][]} */
  const offenders = [
    [/<script\b[^>]*\ssrc=/i, '<script src=…>'],
    [/<link[^>]+href=["'](?!data:)/i, '<link href=…>'],
    [/@import\s+(url\()?["']?(?!data:)/i, '@import'],
    [/url\(\s*["']?(https?:)?\/\//i, 'url(http…)'],
    [/\s(src|href|action)=["']?(https?:)?\/\//i, 'an address elsewhere'],
  ];
  for (const [pattern, name] of offenders) {
    if (pattern.test(html)) throw new Error(`An external reference is left in the page: ${name}`);
  }
  const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);
  if (!csp) throw new Error('The Content-Security-Policy meta tag is missing');
  for (const required of ["default-src 'none'", "connect-src 'none'"]) {
    if (!csp[1].includes(required)) throw new Error(`The Content-Security-Policy must have ${required}`);
  }
}

/**
 * script-src 'unsafe-inline' would let any inline handler run; the page has
 * exactly one script, so the policy names its hash instead. The hash is of the
 * very bytes between <script> and </script>.
 */
export function pinScript(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error(`The page must have exactly one inline <script>, not ${scripts.length}`);
  const hash = createHash('sha256').update(scripts[0][1], 'utf8').digest('base64');
  const csp = /(http-equiv="Content-Security-Policy" content="[^"]*script-src )'unsafe-inline'/;
  if (!csp.test(html)) throw new Error("The Content-Security-Policy has no script-src 'unsafe-inline' to pin");
  return html.replace(csp, (_, head) => `${head}'sha256-${hash}'`);
}

const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg.replace(/<\?xml[\s\S]*?\?>/, '').trim(), 'utf8').toString('base64')}`;

/**
 * The PWA's page may reach its own origin and nothing else: its manifest, its
 * worker, its icons, and the library files of the shelf (connect-src 'self',
 * this build only — the single file keeps 'none').
 */
export function allowPwa(html) {
  const pattern = /(http-equiv="Content-Security-Policy" content=")([^"]*)/;
  if (!pattern.test(html)) throw new Error('The Content-Security-Policy meta tag is missing');
  return html.replace(pattern, (_, attr, policy) => {
    const directives = new Map(policy.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
    directives.get('img-src').push("'self'");
    directives.set('connect-src', ["'self'"]);
    directives.set('manifest-src', ["'self'"]);
    directives.set('worker-src', ["'self'"]);
    return attr + [...directives].map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
  });
}

/** Under assets/; each goes to build/pages/ under its own name. */
const PWA_ICONS = ['icon.svg', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/icon-maskable-512.png', 'pwa/apple-touch-icon.png'];

/**
 * build/pages/: the page plus what makes it installable. Every path is
 * relative, so it works under a project site's /<repo>/ prefix.
 */
async function buildPages(html) {
  const dir = at('build', 'pages');
  const head = [
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
    '<meta name="theme-color" content="#f6efe1" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#1d1814" media="(prefers-color-scheme: dark)">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    // The page registers the worker itself (update.ts): this is how it knows it is the PWA.
    '<meta name="service-worker" content="sw.js">',
  ].join('\n');
  const page = allowPwa(html).replace('</head>', () => `${head}\n</head>`);
  // A deploy between two releases changes the page, not the version: the hash tells them apart.
  const cache = `${release.version}-${createHash('sha256').update(page).digest('hex').slice(0, 12)}`;
  const manifest = {
    name: 'Timeline',
    short_name: 'Timeline',
    description: 'Chronologies to read and edit: world history, a country, science, your own life',
    id: './',
    start_url: './',
    scope: './',
    display: 'standalone',
    // A .timeline opens in the installed app from the Finder or Explorer, in its window when one is open.
    file_handlers: [{ action: './', accept: { 'application/x-timeline': ['.timeline'] } }],
    launch_handler: { client_mode: 'focus-existing' },
    background_color: '#f6efe1',
    theme_color: '#f6efe1',
    icons: [
      { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const worker = (await readFile(at('src/pwa/sw.js'), 'utf8')).replaceAll('__CACHE__', cache).replaceAll('__VERSION__', release.label);
  await Promise.all([
    writeFile(join(dir, 'index.html'), page, 'utf8'),
    writeFile(join(dir, 'sw.js'), worker, 'utf8'),
    writeFile(join(dir, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    // Without it Pages runs the files through Jekyll, which is only wasted time here.
    writeFile(join(dir, '.nojekyll'), '', 'utf8'),
    ...PWA_ICONS.map((path) => copyFile(at('assets', path), join(dir, basename(path)))),
  ]);
  console.log(`build/pages/ — PWA for GitHub Pages (cache ${cache})`);
}

async function buildOnce() {
  release = await readRelease();
  const [template, styles, icon, appJs] = await Promise.all([
    readFile(at('src/app/template.html'), 'utf8'),
    readFile(at('src/app/styles.css'), 'utf8'),
    readFile(at('assets/icon.svg'), 'utf8'),
    bundle('src/app/main.ts'),
  ]);
  assertScriptCloses(appJs);
  // No target: color-mix() and :has() stay as written, the comments and the whitespace go.
  const css = watch ? styles : (await transform(styles, { loader: 'css', minify: true, logLevel: 'silent' })).code;

  const html = pinScript(template
    .replace('/*__STYLES__*/', () => css)
    .replace('/*__APP__*/', () => guard(appJs))
    .replaceAll('__ICON__', () => dataUri(icon))
    .replaceAll('__VERSION__', () => release.label),
  );

  assertSelfContained(html);
  const size = Buffer.byteLength(html, 'utf8');
  // The budget is the shipped page's: --watch builds it unminified, and only says so.
  if (size > PAGE_BUDGET) {
    const over = `build/timeline.html is ${size} bytes, over the ${PAGE_BUDGET}-byte budget`;
    if (!watch) throw new Error(over);
    console.warn(`${over} (unminified, --watch)`);
  }

  await mkdir(at('build'), { recursive: true });
  await writeFile(outFile, html, 'utf8');
  const kb = (n) => (n / 1024).toFixed(1);
  console.log(`build/timeline.html ${release.label} — ${kb(size)} KB (code ${kb(appJs.length)} KB, styles ${kb(css.length)} KB)`);
  await buildPages(html);
}

// Imported by the tests for assertSelfContained: build only when run.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildOnce();

  if (watch) {
    const { watch: watchDir } = await import('node:fs');
    let pending = null;
    for (const dir of ['src', 'assets']) {
      watchDir(at(dir), { recursive: true }, () => {
        clearTimeout(pending);
        pending = setTimeout(() => buildOnce().catch((error) => console.error(error.message)), 120);
      });
    }
    console.log('watching src/ and assets/ …');
  }
}
