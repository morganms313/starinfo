import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEngine, buildHtml } from '../build/build.mjs';

const wasm = readFileSync(new URL('../node_modules/mediainfo.js/dist/MediaInfoModule.wasm', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../node_modules/mediainfo.js/package.json', import.meta.url), 'utf8'));

test('engine: markers replaced, payload intact, self-contained, compiles', () => {
  const engine = buildEngine();
  assert.ok(!/@@[A-Z_0-9]+@@/.test(engine), 'no markers left');
  const m = engine.match(/WASM_B64 = '([A-Za-z0-9+/=]+)'/);
  assert.ok(m, 'base64 payload present');
  const bytes = Buffer.from(m[1], 'base64');
  assert.equal(bytes.length, wasm.length, 'decoded length equals wasm size');
  assert.equal(bytes.subarray(0, 4).toString('latin1'), '\0asm', 'wasm magic');
  assert.ok(engine.includes(`VERSION = '${pkg.version}'`));
  assert.ok(engine.includes('MediaInfoEngine'));
  assert.ok(!/^import\s/m.test(engine), 'no top-level import');
  assert.ok(!engine.includes('</script'), 'safe to inline in <script>');
  assert.doesNotThrow(() => new Function(engine), 'engine compiles');
});

test('html: markers replaced, scripts compile, required ids present', () => {
  const engine = buildEngine();
  const html = buildHtml(engine);
  assert.ok(!/@@[A-Z_0-9]+@@/.test(html), 'no markers left');
  assert.ok(html.includes('<title>MediaInfo</title>'));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2, 'engine script + app script');
  for (const s of scripts) assert.doesNotThrow(() => new Function(s));
  for (const id of ['picker', 'tabs', 'full', 'copy', 'save', 'clear', 'about', 'files', 'report', 'hint', 'veil', 'ver', 'aboutDlg', 'libver', 'aboutClose']) {
    assert.ok(html.includes(`id="${id}"`), `id ${id}`);
  }
  for (const v of ['text', 'tree', 'json', 'xml', 'html']) assert.ok(html.includes(`data-view="${v}"`), `tab ${v}`);
  assert.ok(!html.includes('http://') && !html.includes('https://cdn'), 'no external resource references');
});
