#!/usr/bin/env node
// Builds dist/mediainfo-engine.js (reusable) and dist/StarInfo.html (deliverable).
// No bundler: reads sources, base64-inlines the WASM, substitutes @@MARKERS@@.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p));
const text = (p) => read(p).toString('utf8');

const PKG_DIR = 'node_modules/mediainfo.js';
const pkg = JSON.parse(text(`${PKG_DIR}/package.json`));

// Function replacer so `$` sequences inside payloads are copied verbatim.
// Replacement text is never re-scanned for markers.
function substitute(source, map) {
  return source.replace(/@@([A-Z_0-9]+)@@/g, (whole, name) => {
    if (!(name in map)) throw new Error(`build: unknown marker ${whole}`);
    return map[name];
  });
}

export function buildEngine() {
  const umd = text(`${PKG_DIR}/dist/umd/index.min.js`);
  const wasm = read(`${PKG_DIR}/dist/MediaInfoModule.wasm`);
  const wrapper = substitute(text('src/engine.js'), {
    WASM_B64: wasm.toString('base64'),
    VERSION: pkg.version,
  });
  const banner = `/* mediainfo-engine.js — mediainfo.js ${pkg.version} + MediaInfoLib, BSD-2-Clause. ` +
    `Self-contained (WASM inlined). Built ${new Date().toISOString().slice(0, 10)}. */\n`;
  return banner + umd + '\n' + wrapper;
}

export function buildHtml(engine) {
  return substitute(text('src/app.html'), {
    ENGINE: engine,
    CSS: text('src/app.css'),
    PARSE: text('src/parse-text.js'),
    JS: text('src/app.js'),
    VERSION: pkg.version,
  });
}

function main() {
  mkdirSync(resolve(root, 'dist'), { recursive: true });
  const engine = buildEngine();
  writeFileSync(resolve(root, 'dist/mediainfo-engine.js'), engine);
  const html = buildHtml(engine);
  writeFileSync(resolve(root, 'dist/StarInfo.html'), html);
  const mb = (s) => (Buffer.byteLength(s) / 1048576).toFixed(2) + ' MB';
  console.log(`dist/mediainfo-engine.js  ${mb(engine)}`);
  console.log(`dist/StarInfo.html       ${mb(html)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
