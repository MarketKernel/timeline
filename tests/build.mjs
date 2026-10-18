/**
 * The build's own guards: an external reference or a second script must fail
 * the build, and the policy must pin the one script by its hash.
 */
import { createHash } from 'node:crypto';
import { allowPwa, assertSelfContained, libraryOrigins, pinScript } from '../build.mjs';
import { checker } from '../tools/load.mjs';

const { check, done } = checker();

const page = (body, csp = "default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'") =>
  `<meta http-equiv="Content-Security-Policy" content="${csp}">${body}`;
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

check('a clean page passes', throws(() => assertSelfContained(page('<script>1</script>'))), false);
check('a data: icon passes', throws(() => assertSelfContained(page('<link rel="icon" href="data:image/svg+xml;base64,AA">'))), false);
for (const [name, body] of [
  ['script src', '<script src="x.js"></script>'],
  ['stylesheet link', '<link rel="stylesheet" href="a.css">'],
  ['css import', '<style>@import "a.css";</style>'],
  ['css url http', '<style>a{background:url(https://x/y.png)}</style>'],
  ['css url protocol-relative', '<style>a{background:url(//x/y.png)}</style>'],
  ['img from elsewhere', '<img src="https://x/y.png">'],
]) {
  check(`rejects ${name}`, throws(() => assertSelfContained(page(body))), true);
}
check('rejects a page without a policy', throws(() => assertSelfContained('<script>1</script>')), true);
check('rejects a policy that lets the page connect', throws(() => assertSelfContained(page('', "default-src 'none'; connect-src 'self'"))), true);

const code = 'console.log(1)';
const pinned = pinScript(page(`<script>${code}</script>`));
const hash = createHash('sha256').update(code).digest('base64');
check('pins the script by its hash', pinned.includes(`script-src 'sha256-${hash}'`), true);
check('no unsafe-inline left', pinned.includes("'unsafe-inline'"), false);
check('two scripts are refused', throws(() => pinScript(page('<script>1</script><script>2</script>'))), true);

const policy = "default-src 'none'; img-src blob: data:; connect-src 'none'";
const pwa = (origins) => /content="([^"]*)"/.exec(allowPwa(page('', policy), origins))?.[1];
check('the PWA reaches its own site', pwa([]), "default-src 'none'; img-src blob: data: 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'");
check('…and the sites its library names, for files and covers', pwa(['https://a.example']), "default-src 'none'; img-src blob: data: 'self' https://a.example; connect-src 'self' https://a.example; manifest-src 'self'; worker-src 'self'");
const library = (...files) => ({ format: 'timeline-library', files });
check(
  'a library’s sites: each once, beside index.json not among them',
  libraryOrigins(library({ file: 'https://b.example/x.timeline', cover: 'https://a.example/c/x.webp' }, { file: 'https://b.example/y.timeline', cover: null }, { file: 'z.timeline', cover: 'covers/z.webp' })),
  ['https://a.example', 'https://b.example'],
);
check('a site over http is refused', throws(() => libraryOrigins(library({ file: 'http://a.example/x.timeline' }))), true);
check('no library, no sites', libraryOrigins(null), []);

done('build');
