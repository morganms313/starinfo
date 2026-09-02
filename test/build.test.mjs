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
