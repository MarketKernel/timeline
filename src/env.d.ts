/** package.json's version, as build.mjs puts it in: 0.1.0, or 0.1.0+1a2b3c4 off a release. */
declare const __APP_VERSION__: string;

/** SVG files are bundled as their markup (esbuild's text loader). */
declare module '*.svg' {
  const markup: string;
  export default markup;
}
