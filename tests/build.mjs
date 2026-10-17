/**
 * The build's own guards: an external reference or a second script must fail
 * the build, and the policy must pin the one script by its hash.
 */
import { createHash } from 'node:crypto';
import { assertSelfContained, pinScript } from '../build.mjs';
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

done('build');
