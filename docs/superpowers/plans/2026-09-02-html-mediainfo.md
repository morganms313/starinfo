# html-mediainfo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `dist/MediaInfo.html`, a single portable HTML file that analyses media files with the real MediaInfoLib engine, plus `dist/mediainfo-engine.js`, the reusable engine script for future HTML tools.

**Architecture:** A Node build script base64-inlines the mediainfo.js WASM into a self-contained engine script that exposes `window.MediaInfoEngine`, then splices engine + CSS + JS into one HTML page. The viewer is vanilla JS: a file queue, per-view result cache, five views (Text, Tree, JSON, XML, HTML), copy/save, and localStorage persistence.

**Tech Stack:** Node 25 (build + `node --test`), mediainfo.js 0.3.7 (WASM, BSD-2), ffmpeg (fixture generation only), vanilla HTML/CSS/JS. No bundler, no framework.

## Global Constraints

- mediainfo.js pinned at exactly `0.3.7`.
- No network requests from the engine or the viewer; everything runs from `file://`.
- `dist/` is build output only, never hand-edited, but IS committed (it is the deliverable).
- Marker syntax in sources is `@@NAME@@`; replacement uses a function replacer.
- Engine API: `MediaInfoEngine.version`, `MediaInfoEngine.create(options)`, `MediaInfoEngine.analyze(blob, options)`; options `{format, full, coverData}`, defaults `{format:'text', full:false, coverData:false}`.
- Views: Text, Tree, JSON, XML, HTML. Save extensions: `.txt .txt .json .xml .html`. Save name `<original>.mediainfo.<ext>`.
- localStorage keys: `mediainfo.view`, `mediainfo.full`; all storage access in try/catch.
- Test hook exposed as `window.__mediainfoApp = { addFiles, state }`.
- Commit after every task with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.

---

### Task 1: Scaffold, dependency, fixture

**Files:**
- Create: `package.json`, `.gitignore`, `test/fixtures/sample.mp4` (generated), `test/make-fixture.sh`

**Interfaces:**
- Produces: `npm run build` → runs `build/build.mjs`; `npm test` → `node --test test/`; fixture at `test/fixtures/sample.mp4` (H.264 320x240 25fps + AAC 48kHz, 2 s).

- [ ] **Step 1: package.json**

```json
{
  "name": "html-mediainfo",
  "version": "0.1.0",
  "private": true,
  "description": "Portable single-file MediaInfo viewer (MediaInfoLib via WebAssembly)",
  "type": "module",
  "scripts": {
    "build": "node build/build.mjs",
    "test": "node --test test/",
    "fixture": "sh test/make-fixture.sh"
  },
  "devDependencies": {
    "mediainfo.js": "0.3.7"
  },
  "license": "BSD-2-Clause"
}
```

- [ ] **Step 2: .gitignore**

```
node_modules/
.DS_Store
```

- [ ] **Step 3: Fixture script `test/make-fixture.sh`**

```sh
#!/bin/sh
# Generates the test fixture if missing. Requires ffmpeg.
set -e
out="$(dirname "$0")/fixtures/sample.mp4"
[ -f "$out" ] && { echo "fixture exists: $out"; exit 0; }
mkdir -p "$(dirname "$out")"
ffmpeg -loglevel error -y \
  -f lavfi -i testsrc=size=320x240:rate=25 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$out"
echo "wrote $out"
```

- [ ] **Step 4: Install and generate**

Run: `npm install && npm run fixture && ls -la test/fixtures/`
Expected: `node_modules/mediainfo.js` present; `sample.mp4` a few tens of KB.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore test/make-fixture.sh test/fixtures/sample.mp4
git commit -m "Scaffold project, pin mediainfo.js 0.3.7, add test fixture"
```

---

### Task 2: Engine smoke test (library + fixture sanity)

**Files:**
- Create: `test/library.smoke.test.mjs`

**Interfaces:**
- Consumes: `mediainfo.js` ESM export `mediaInfoFactory`, fixture from Task 1.
- Produces: confidence the pinned library parses the fixture in Node.

- [ ] **Step 1: Write the test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mediaInfoFactory from 'mediainfo.js';

const fixture = fileURLToPath(new URL('./fixtures/sample.mp4', import.meta.url));

test('mediainfo.js parses the fixture: one AVC video + one AAC audio track', async () => {
  const size = (await stat(fixture)).size;
  const fh = await open(fixture, 'r');
  const mi = await mediaInfoFactory({ format: 'object' });
  try {
    const result = await mi.analyzeData(size, async (chunkSize, offset) => {
      const buf = new Uint8Array(chunkSize);
      const { bytesRead } = await fh.read(buf, 0, chunkSize, offset);
      return bytesRead === chunkSize ? buf : buf.subarray(0, bytesRead);
    });
    const tracks = result.media.track;
    const byType = (t) => tracks.filter((x) => x['@type'] === t);
    assert.equal(byType('General').length, 1);
    assert.equal(byType('Video').length, 1);
    assert.equal(byType('Audio').length, 1);
    assert.equal(byType('Video')[0].Format, 'AVC');
    assert.equal(byType('Audio')[0].Format, 'AAC');
    assert.equal(byType('Video')[0].Width, 320);
    assert.match(result.creatingLibrary.version, /^\d+\.\d+/);
  } finally {
    mi.close();
    await fh.close();
  }
});
```

- [ ] **Step 2: Run**

Run: `npm test`
Expected: 1 pass.

- [ ] **Step 3: Commit**

```bash
git add test/library.smoke.test.mjs
git commit -m "Add Node smoke test for pinned mediainfo.js against fixture"
```

---

### Task 3: Engine wrapper + build script (engine only), TDD

**Files:**
- Create: `src/engine.js`, `build/build.mjs`, `test/build.test.mjs`

**Interfaces:**
- Consumes: `node_modules/mediainfo.js/dist/umd/index.min.js` (registers global `MediaInfo` with `.mediaInfoFactory`), `node_modules/mediainfo.js/dist/MediaInfoModule.wasm`.
- Produces: `build/build.mjs` exports `buildEngine(): string` and `buildHtml(engine: string): string`; running it directly writes `dist/mediainfo-engine.js` and `dist/MediaInfo.html`. `src/engine.js` defines `window.MediaInfoEngine = { version, create, analyze }`.

- [ ] **Step 1: Write failing build test (engine part)**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/build.test.mjs`
Expected: FAIL, cannot find module `../build/build.mjs`.

- [ ] **Step 3: Write `src/engine.js`**

```js
/*
 * MediaInfoEngine — self-contained MediaInfoLib (WebAssembly) for single-file HTML tools.
 * Built from mediainfo.js @@VERSION@@ (BSD-2-Clause, https://mediainfo.js.org) and
 * MediaInfoLib (BSD-2-Clause, https://mediaarea.net). No network access.
 *
 *   MediaInfoEngine.version                       -> "@@VERSION@@"
 *   MediaInfoEngine.create({format, full, coverData}) -> Promise<MediaInfo>
 *   MediaInfoEngine.analyze(blob, {format, full, coverData}) -> Promise<string|object>
 *
 * format: 'text' (default) | 'JSON' | 'XML' | 'HTML' | 'object'
 */
(function (global) {
  'use strict';

  var WASM_B64 = '@@WASM_B64@@';
  var VERSION = '@@VERSION@@';
  var DEFAULTS = { format: 'text', full: false, coverData: false };

  var lib = global.MediaInfo;
  if (!lib || typeof lib.mediaInfoFactory !== 'function') {
    throw new Error('MediaInfoEngine: mediainfo.js UMD bundle must be loaded first');
  }

  var wasmUrl = null;
  function getWasmUrl() {
    if (wasmUrl) return wasmUrl;
    var bin = atob(WASM_B64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    wasmUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
    return wasmUrl;
  }

  function normalize(options) {
    var o = Object.assign({}, DEFAULTS, options || {});
    return { format: o.format, full: !!o.full, coverData: !!o.coverData };
  }

  function create(options) {
    var o = normalize(options);
    return lib.mediaInfoFactory({
      format: o.format,
      full: o.full,
      coverData: o.coverData,
      locateFile: function () { return getWasmUrl(); }
    });
  }

  // One MediaInfoLib instance per (format, full, coverData); the output format is fixed
  // at instance creation. Calls on the same instance are serialised because
  // analyzeData() rejects while another parse is in progress.
  var instances = {};
  var queues = {};

  function readChunkFrom(blob) {
    return function (size, offset) {
      return blob.slice(offset, offset + size).arrayBuffer().then(function (buf) {
        return new Uint8Array(buf);
      });
    };
  }

  function analyze(blob, options) {
    var o = normalize(options);
    var key = o.format + '|' + (o.full ? 1 : 0) + '|' + (o.coverData ? 1 : 0);
    if (!instances[key]) {
      instances[key] = create(o).catch(function (err) {
        delete instances[key];
        throw err;
      });
    }
    var run = function () {
      return instances[key].then(function (mi) {
        return mi.analyzeData(blob.size, readChunkFrom(blob));
      });
    };
    var prev = queues[key] || Promise.resolve();
    var p = prev.then(run, run);
    queues[key] = p.then(function () {}, function () {});
    return p;
  }

  global.MediaInfoEngine = { version: VERSION, create: create, analyze: analyze };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Write `build/build.mjs`**

```js
#!/usr/bin/env node
// Builds dist/mediainfo-engine.js (reusable) and dist/MediaInfo.html (deliverable).
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
    JS: text('src/app.js'),
    VERSION: pkg.version,
  });
}

function main() {
  mkdirSync(resolve(root, 'dist'), { recursive: true });
  const engine = buildEngine();
  writeFileSync(resolve(root, 'dist/mediainfo-engine.js'), engine);
  const html = buildHtml(engine);
  writeFileSync(resolve(root, 'dist/MediaInfo.html'), html);
  const mb = (s) => (Buffer.byteLength(s) / 1048576).toFixed(2) + ' MB';
  console.log(`dist/mediainfo-engine.js  ${mb(engine)}`);
  console.log(`dist/MediaInfo.html       ${mb(html)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 5: Run the engine test**

Run: `node --test test/build.test.mjs`
Expected: PASS (the HTML test does not exist yet; `buildHtml` is exported but untested).

- [ ] **Step 6: Commit**

```bash
git add src/engine.js build/build.mjs test/build.test.mjs
git commit -m "Add MediaInfoEngine wrapper and build script with WASM inlining"
```

---

### Task 4: Spike — engine works from file:// in a browser

**Files:**
- Create: `test/spike.html` (temporary; deleted at the end of this task)

**Interfaces:**
- Consumes: `dist/mediainfo-engine.js` from `npm run build` (the HTML build will fail until Task 5 exists, so build the engine alone with a one-liner).
- Produces: go/no-go on the object-URL WASM loading strategy.

- [ ] **Step 1: Build the engine file only**

Run: `node -e "import('./build/build.mjs').then(m=>{require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/mediainfo-engine.js',m.buildEngine());console.log('ok')})"`
Expected: `ok`, `dist/mediainfo-engine.js` ≈ 3.4 MB.

- [ ] **Step 2: Write the spike page**

The fixture is embedded as base64 so no file picker is needed. Generate the page:

```bash
B64=$(base64 -i test/fixtures/sample.mp4 | tr -d '\n')
cat > test/spike.html <<EOF
<!DOCTYPE html><meta charset="utf-8"><title>spike</title>
<pre id="out">loading…</pre>
<script src="../dist/mediainfo-engine.js"></script>
<script>
(async () => {
  const out = document.getElementById('out');
  try {
    const bytes = Uint8Array.from(atob('$B64'), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'video/mp4' });
    const t0 = performance.now();
    const text = await MediaInfoEngine.analyze(blob, { format: 'text' });
    const json = JSON.parse(await MediaInfoEngine.analyze(new Blob([]), { format: 'JSON' }));
    out.textContent = 'ENGINE ' + MediaInfoEngine.version + ' LIB ' + json.creatingLibrary.version +
      ' ms=' + Math.round(performance.now() - t0) + '\n\n' + text;
    document.title = 'spike-ok';
  } catch (e) { out.textContent = 'FAIL ' + (e && e.stack || e); document.title = 'spike-fail'; }
})();
</script>
EOF
```

- [ ] **Step 3: Open from file:// in the browser pane and read the result**

Navigate to `file:///Users/morgan/Documents/Projects/html-mediainfo/test/spike.html`, then `get_page_text`.
Expected: first line starts with `ENGINE 0.3.7 LIB 2x.xx`, followed by a MediaInfo text report with `Format : AVC` and `Format : AAC`. Title `spike-ok`.
If the browser pane refuses `file://`, serve with `python3 -m http.server` from the repo root as a fallback for the functional check and note the file:// check as pending for a double-click test.
If FAIL mentions the wasm fetch: change `getWasmUrl` to return `'data:application/wasm;base64,' + WASM_B64` and retest.

- [ ] **Step 4: Record and clean up**

Note the measured library version and load time in the commit message. Delete `test/spike.html`.

```bash
rm test/spike.html
git add -A
git commit -m "Spike: verify inlined WASM loads from file:// (MediaInfoLib <version>)"
```

---

### Task 5: Viewer markup and styles

**Files:**
- Create: `src/app.html`, `src/app.css`
- Modify: `test/build.test.mjs` (add HTML test)

**Interfaces:**
- Produces element ids consumed by `src/app.js`: `picker, tabs, full, copy, save, clear, about, files, report, hint, veil, ver, aboutDlg, libver, aboutClose`. Tab buttons carry `data-view` in `text|tree|json|xml|html`.

- [ ] **Step 1: Add failing HTML build test**

Append to `test/build.test.mjs`:

```js
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
```

(Note: the About panel cites `https://mediainfo.js.org` and `https://mediaarea.net` as plain text links; `https://` is allowed, `http://` and CDN hosts are not.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/build.test.mjs`
Expected: FAIL, ENOENT `src/app.html`.

- [ ] **Step 3: Write `src/app.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>MediaInfo</title>
<style>
@@CSS@@
</style>
</head>
<body>
<header class="bar">
  <div class="brand">
    <span class="logo" aria-hidden="true">MI</span>
    <h1>MediaInfo</h1>
    <span class="ver" id="ver" title="mediainfo.js version"></span>
  </div>
  <div class="tools">
    <label class="btn primary" for="picker">Open files…</label>
    <input id="picker" type="file" multiple hidden>
    <nav class="tabs" id="tabs" role="tablist" aria-label="Report view">
      <button type="button" role="tab" data-view="text">Text</button>
      <button type="button" role="tab" data-view="tree">Tree</button>
      <button type="button" role="tab" data-view="json">JSON</button>
      <button type="button" role="tab" data-view="xml">XML</button>
      <button type="button" role="tab" data-view="html">HTML</button>
    </nav>
    <label class="toggle" title="Show all fields (MediaInfo “Complete” mode)">
      <input type="checkbox" id="full"> Full
    </label>
    <span class="spacer"></span>
    <button type="button" class="btn" id="copy" disabled>Copy</button>
    <button type="button" class="btn" id="save" disabled>Save</button>
    <button type="button" class="btn" id="clear" disabled>Clear all</button>
    <button type="button" class="btn ghost" id="about" aria-haspopup="dialog">About</button>
  </div>
</header>

<main class="body">
  <aside class="files" id="files" aria-label="Files">
    <p class="empty">No files yet</p>
  </aside>
  <section class="report" id="report" aria-live="polite">
    <div class="hint" id="hint">
      <div class="hint-icon" aria-hidden="true">⬇</div>
      <p class="hint-title">Drop media files anywhere</p>
      <p class="hint-sub">or use <strong>Open files…</strong></p>
      <p class="hint-sub muted">Files are analysed on this computer and never leave it.</p>
    </div>
  </section>
</main>

<div class="veil" id="veil" aria-hidden="true"><span>Drop to analyse</span></div>

<dialog id="aboutDlg" class="about">
  <h2>About MediaInfo (portable)</h2>
  <dl>
    <dt>mediainfo.js</dt><dd>@@VERSION@@ — MediaInfoLib compiled to WebAssembly, https://mediainfo.js.org</dd>
    <dt>MediaInfoLib</dt><dd id="libver">unknown (open the About panel after analysing a file)</dd>
    <dt>Privacy</dt><dd>This page makes no network requests. Files are read locally in your browser; nothing is uploaded.</dd>
  </dl>
  <h3>Licenses</h3>
  <p>mediainfo.js — Copyright © buzz. MediaInfoLib — Copyright © 2002–2026 MediaArea.net SARL (https://mediaarea.net). Both are distributed under the BSD-2-Clause license:</p>
  <pre class="license">Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.</pre>
  <form method="dialog"><button type="submit" class="btn primary" id="aboutClose">Close</button></form>
</dialog>

<script>
@@ENGINE@@
</script>
<script>
@@JS@@
</script>
</body>
</html>
```

- [ ] **Step 4: Write `src/app.css`**

```css
:root {
  --bg: #f4f5f7; --panel: #ffffff; --ink: #1c1f26; --muted: #6b7280; --line: #e2e5ea;
  --accent: #2563eb; --accent-ink: #ffffff; --hover: #eef2ff; --sel: #e0e7ff;
  --ok: #16a34a; --warn: #d97706; --err: #dc2626; --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115; --panel: #171a21; --ink: #e6e8ee; --muted: #8b93a5; --line: #262b36;
    --accent: #5b8def; --accent-ink: #0b1020; --hover: #1e2431; --sel: #263047;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { font: 14px/1.4 var(--sans); color: var(--ink); background: var(--bg); display: flex; flex-direction: column; }
h1 { font-size: 16px; margin: 0; font-weight: 600; }
h2, h3 { margin: 0 0 8px; }
button, label.btn { font: inherit; }

.bar { display: flex; align-items: center; gap: 16px; padding: 8px 14px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 8px; }
.logo { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 6px; background: var(--accent); color: var(--accent-ink); font-weight: 700; font-size: 12px; }
.ver { color: var(--muted); font-size: 12px; }
.tools { display: flex; align-items: center; gap: 8px; flex: 1; flex-wrap: wrap; }
.spacer { flex: 1; }

.btn { padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--ink); cursor: pointer; }
.btn:hover:not(:disabled) { background: var(--hover); }
.btn:disabled { opacity: .45; cursor: default; }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
.btn.primary:hover { filter: brightness(1.08); background: var(--accent); }
.btn.ghost { border-color: transparent; color: var(--muted); }

.tabs { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.tabs button { padding: 6px 12px; border: 0; border-right: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer; }
.tabs button:last-child { border-right: 0; }
.tabs button:hover { background: var(--hover); }
.tabs button[aria-selected="true"] { background: var(--accent); color: var(--accent-ink); }
.toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }

.body { display: flex; flex: 1; min-height: 0; }
.files { width: 280px; flex: none; overflow: auto; background: var(--panel); border-right: 1px solid var(--line); }
.files .empty { color: var(--muted); padding: 16px; margin: 0; text-align: center; }
.file { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); cursor: pointer; }
.file:hover { background: var(--hover); }
.file.selected { background: var(--sel); }
.file .name { grid-column: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.file .meta { grid-column: 1; color: var(--muted); font-size: 12px; display: flex; gap: 8px; }
.file .rm { grid-column: 2; grid-row: 1 / span 2; align-self: center; border: 0; background: transparent; color: var(--muted); font-size: 16px; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
.file .rm:hover { background: var(--line); color: var(--ink); }
.status::before { content: "●"; margin-right: 4px; }
.status.queued { color: var(--muted); }
.status.parsing { color: var(--warn); }
.status.done { color: var(--ok); }
.status.error { color: var(--err); }

.report { flex: 1; min-width: 0; overflow: auto; padding: 16px 20px; position: relative; }
.report pre { margin: 0; font: 12.5px/1.45 var(--mono); white-space: pre; tab-size: 4; }
.report .loading, .report .error { color: var(--muted); padding: 24px; text-align: center; }
.report .error { color: var(--err); white-space: pre-wrap; text-align: left; font-family: var(--mono); font-size: 12.5px; }
.report .htmlview table { border-collapse: collapse; font: 12.5px/1.45 var(--mono); }
.report .htmlview td { padding: 1px 12px 1px 0; vertical-align: top; }
.report .htmlview h1, .report .htmlview h2 { font-size: 14px; margin: 14px 0 4px; }

.tree details { margin-bottom: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
.tree summary { padding: 8px 12px; font-weight: 600; cursor: pointer; user-select: none; }
.tree table { width: 100%; border-collapse: collapse; font: 12.5px/1.45 var(--mono); }
.tree td { padding: 2px 12px; border-top: 1px solid var(--line); vertical-align: top; word-break: break-word; }
.tree td.k { width: 34%; color: var(--muted); }

.hint { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; color: var(--muted); pointer-events: none; }
.hint-icon { font-size: 40px; }
.hint-title { font-size: 18px; color: var(--ink); margin: 8px 0 4px; }
.hint-sub { margin: 2px 0; }
.muted { color: var(--muted); font-size: 12px; }
.hint[hidden] { display: none; }

.veil { position: fixed; inset: 0; display: none; place-content: center; background: color-mix(in srgb, var(--accent) 18%, transparent); border: 3px dashed var(--accent); font-size: 22px; font-weight: 600; color: var(--ink); z-index: 10; pointer-events: none; }
.veil.on { display: grid; }

dialog.about { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--ink); max-width: 640px; padding: 20px 24px; }
dialog.about::backdrop { background: rgba(0,0,0,.4); }
dialog.about dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0 0 14px; }
dialog.about dt { color: var(--muted); }
dialog.about dd { margin: 0; }
dialog.about .license { font: 11px/1.4 var(--mono); white-space: pre-wrap; background: var(--bg); padding: 10px; border-radius: 6px; max-height: 200px; overflow: auto; }
dialog.about form { text-align: right; margin-top: 12px; }

@media (max-width: 760px) {
  .body { flex-direction: column; }
  .files { width: auto; max-height: 30vh; border-right: 0; border-bottom: 1px solid var(--line); }
}
```

- [ ] **Step 5: Create an empty `src/app.js` placeholder so the build resolves** (real content in Task 6)

```js
// filled in Task 6
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all pass (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/app.html src/app.css src/app.js test/build.test.mjs
git commit -m "Add viewer markup, styles, and HTML build test"
```

---

### Task 6: Viewer logic

**Files:**
- Modify: `src/app.js` (replace placeholder)

**Interfaces:**
- Consumes: `window.MediaInfoEngine.analyze(blob, {format, full})`; element ids from Task 5.
- Produces: `window.__mediainfoApp = { addFiles(FileList|File[]), state }`.

- [ ] **Step 1: Write `src/app.js`**

```js
(function () {
  'use strict';

  // ---- constants -----------------------------------------------------------
  var FORMAT = { text: 'text', tree: 'object', json: 'JSON', xml: 'XML', html: 'HTML' };
  var EXT = { text: 'txt', tree: 'txt', json: 'json', xml: 'xml', html: 'html' };
  var VIEWS = Object.keys(FORMAT);

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    picker: $('picker'), tabs: $('tabs'), full: $('full'), copy: $('copy'), save: $('save'),
    clear: $('clear'), about: $('about'), files: $('files'), report: $('report'), hint: $('hint'),
    veil: $('veil'), ver: $('ver'), aboutDlg: $('aboutDlg'), libver: $('libver')
  };

  // ---- persistence (all guarded) ------------------------------------------
  var store = {
    get: function (k, dflt) {
      try { var v = localStorage.getItem('mediainfo.' + k); return v === null ? dflt : JSON.parse(v); }
      catch (e) { return dflt; }
    },
    set: function (k, v) { try { localStorage.setItem('mediainfo.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  // ---- state ---------------------------------------------------------------
  var state = {
    files: [],          // {id, file, name, size, status, error, removed}
    selected: null,
    view: VIEWS.indexOf(store.get('view', 'text')) >= 0 ? store.get('view', 'text') : 'text',
    full: store.get('full', false) === true,
    libVersion: null,
    nextId: 1
  };
  var cache = {};      // key -> result
  var pending = {};    // key -> Promise
  var jobs = [];       // queued {f, view, full, key, resolve, reject}
  var running = false;
  var renderToken = 0;

  function keyOf(f, view, full) { return f.id + '|' + FORMAT[view] + '|' + (full ? 1 : 0); }

  // ---- job queue: one parse at a time, selected file's current view first --
  function request(f, view, full) {
    var k = keyOf(f, view, full);
    if (k in cache) return Promise.resolve(cache[k]);
    if (pending[k]) return pending[k];
    var job = { f: f, view: view, full: full, key: k };
    job.promise = new Promise(function (res, rej) { job.resolve = res; job.reject = rej; });
    pending[k] = job.promise;
    jobs.push(job);
    pump();
    return job.promise;
  }

  function pickJob() {
    var sel = state.selected;
    var i = -1;
    if (sel) {
      i = jobs.findIndex(function (j) { return j.f === sel && j.view === state.view && j.full === state.full; });
      if (i < 0) i = jobs.findIndex(function (j) { return j.f === sel; });
    }
    if (i < 0) i = 0;
    return jobs.splice(i, 1)[0];
  }

  function pump() {
    if (running || jobs.length === 0) return;
    var job = pickJob();
    if (job.f.removed) {
      delete pending[job.key];
      job.reject(new Error('File removed'));
      pump();
      return;
    }
    running = true;
    setStatus(job.f, 'parsing');
    MediaInfoEngine.analyze(job.f.file, { format: FORMAT[job.view], full: job.full }).then(function (res) {
      cache[job.key] = res;
      delete pending[job.key];
      job.f.error = null;
      setStatus(job.f, 'done');
      noteLibVersion(job.view, res);
      job.resolve(res);
    }, function (err) {
      delete pending[job.key];
      job.f.error = err || new Error('Unknown error');
      setStatus(job.f, 'error');
      job.reject(job.f.error);
    }).then(function () { running = false; pump(); });
  }

  function noteLibVersion(view, res) {
    if (state.libVersion) return;
    try {
      var obj = view === 'tree' ? res : (view === 'json' ? JSON.parse(res) : null);
      if (obj && obj.creatingLibrary && obj.creatingLibrary.version) {
        state.libVersion = obj.creatingLibrary.version;
        els.libver.textContent = state.libVersion;
      }
    } catch (e) { /* ignore */ }
  }

  // ---- files ---------------------------------------------------------------
  function addFiles(list) {
    var added = [];
    for (var i = 0; i < list.length; i++) {
      var file = list[i];
      if (!file) continue;
      var f = { id: state.nextId++, file: file, name: file.name || 'untitled', size: file.size, status: 'queued', error: null, removed: false };
      state.files.push(f);
      added.push(f);
    }
    if (added.length === 0) return;
    added.forEach(function (f) {
      if (f.size === 0) { f.status = 'error'; f.error = new Error('File is empty (0 bytes)'); }
      else request(f, state.view, state.full).catch(function () {});
    });
    if (!state.selected) select(added[0]); else renderFiles();
    updateButtons();
  }

  function removeFile(f) {
    f.removed = true;
    state.files = state.files.filter(function (x) { return x !== f; });
    jobs = jobs.filter(function (j) { return j.f !== f; });
    Object.keys(cache).forEach(function (k) { if (k.indexOf(f.id + '|') === 0) delete cache[k]; });
    if (state.selected === f) state.selected = state.files[0] || null;
    renderFiles();
    renderReport();
    updateButtons();
  }

  function clearAll() {
    state.files.forEach(function (f) { f.removed = true; });
    state.files = [];
    jobs = [];
    cache = {};
    state.selected = null;
    renderFiles();
    renderReport();
    updateButtons();
  }

  function select(f) {
    state.selected = f;
    renderFiles();
    renderReport();
    updateButtons();
  }

  function setStatus(f, status) {
    f.status = status;
    var row = els.files.querySelector('[data-id="' + f.id + '"] .status');
    if (row) { row.className = 'status ' + status; row.textContent = status; }
  }

  function humanSize(n) {
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB', 'TB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i];
  }

  // ---- rendering -----------------------------------------------------------
  function renderFiles() {
    els.files.textContent = '';
    if (state.files.length === 0) {
      var p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No files yet';
      els.files.appendChild(p);
      return;
    }
    state.files.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'file' + (f === state.selected ? ' selected' : '');
      row.setAttribute('data-id', f.id);
      row.title = f.name;
      var name = document.createElement('div'); name.className = 'name'; name.textContent = f.name;
      var meta = document.createElement('div'); meta.className = 'meta';
      var size = document.createElement('span'); size.textContent = humanSize(f.size);
      var st = document.createElement('span'); st.className = 'status ' + f.status; st.textContent = f.status;
      meta.appendChild(size); meta.appendChild(st);
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rm'; rm.textContent = '×'; rm.title = 'Remove';
      rm.addEventListener('click', function (e) { e.stopPropagation(); removeFile(f); });
      row.appendChild(name); row.appendChild(meta); row.appendChild(rm);
      row.addEventListener('click', function () { select(f); });
      els.files.appendChild(row);
    });
  }

  function clearReport() {
    Array.prototype.slice.call(els.report.children).forEach(function (c) { if (c !== els.hint) els.report.removeChild(c); });
  }

  function showBlock(className, text) {
    clearReport();
    var d = document.createElement('div'); d.className = className; d.textContent = text;
    els.report.appendChild(d);
  }

  function renderReport() {
    var f = state.selected;
    els.hint.hidden = !!f;
    clearReport();
    if (!f) return;
    var k = keyOf(f, state.view, state.full);
    if (k in cache) { showResult(cache[k]); return; }
    if (f.error) { showBlock('error', 'Could not analyse "' + f.name + '"\n\n' + (f.error.message || String(f.error))); return; }
    showBlock('loading', 'Analysing "' + f.name + '"…');
    var token = ++renderToken;
    request(f, state.view, state.full).then(function (res) {
      if (token === renderToken) { clearReport(); showResult(res); updateButtons(); }
    }, function (err) {
      if (token === renderToken) { showBlock('error', 'Could not analyse "' + f.name + '"\n\n' + (err && err.message || String(err))); updateButtons(); }
    });
  }

  function showResult(res) {
    if (state.view === 'tree') { els.report.appendChild(buildTree(res)); return; }
    if (state.view === 'html') {
      var d = document.createElement('div'); d.className = 'htmlview';
      d.innerHTML = String(res).replace(/<script[\s\S]*?<\/script>/gi, '');
      els.report.appendChild(d);
      return;
    }
    var pre = document.createElement('pre'); pre.textContent = String(res);
    els.report.appendChild(pre);
  }

  // Tree: one collapsible section per track, rows of field -> value.
  function buildTree(obj) {
    var root = document.createElement('div'); root.className = 'tree';
    var tracks = (obj && obj.media && obj.media.track) || [];
    tracks.forEach(function (t) {
      var det = document.createElement('details'); det.open = true;
      var sum = document.createElement('summary');
      var title = t['@type'] || 'Track';
      if (t['@typeorder']) title += ' #' + t['@typeorder'];
      sum.textContent = title;
      det.appendChild(sum);
      var table = document.createElement('table');
      appendRows(table, t, '');
      det.appendChild(table);
      root.appendChild(det);
    });
    if (tracks.length === 0) { var p = document.createElement('p'); p.className = 'loading'; p.textContent = 'No tracks found.'; root.appendChild(p); }
    return root;
  }

  function appendRows(table, obj, prefix) {
    Object.keys(obj).forEach(function (k) {
      if (k.charAt(0) === '@') return;
      var v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) { appendRows(table, v, prefix + k + '/'); return; }
      var tr = document.createElement('tr');
      var td1 = document.createElement('td'); td1.className = 'k'; td1.textContent = prefix + k;
      var td2 = document.createElement('td'); td2.textContent = Array.isArray(v) ? v.join(', ') : String(v);
      tr.appendChild(td1); tr.appendChild(td2); table.appendChild(tr);
    });
  }

  function renderTabs() {
    Array.prototype.forEach.call(els.tabs.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-view') === state.view ? 'true' : 'false');
    });
    els.full.checked = state.full;
  }

  function updateButtons() {
    var f = state.selected;
    var ready = !!f && (keyOf(f, state.view, state.full) in cache);
    els.copy.disabled = !ready;
    els.save.disabled = !ready;
    els.clear.disabled = state.files.length === 0;
  }

  // ---- copy / save ---------------------------------------------------------
  function currentText() {
    var f = state.selected;
    if (!f) return Promise.resolve('');
    var view = state.view === 'tree' ? 'text' : state.view;
    return request(f, view, state.full).then(function (r) { return String(r); });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
  }

  function flash(btn, label) {
    var old = btn.textContent; btn.textContent = label;
    setTimeout(function () { btn.textContent = old; }, 1200);
  }

  function saveText(text) {
    var f = state.selected; if (!f) return;
    var ext = EXT[state.view];
    var mime = { txt: 'text/plain', json: 'application/json', xml: 'application/xml', html: 'text/html' }[ext];
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name + '.mediainfo.' + ext;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  // ---- events --------------------------------------------------------------
  els.picker.addEventListener('change', function () { addFiles(els.picker.files); els.picker.value = ''; });

  els.tabs.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]'); if (!b) return;
    state.view = b.getAttribute('data-view'); store.set('view', state.view);
    renderTabs(); renderReport(); updateButtons();
  });

  els.full.addEventListener('change', function () {
    state.full = els.full.checked; store.set('full', state.full);
    renderReport(); updateButtons();
  });

  els.copy.addEventListener('click', function () {
    currentText().then(copyText).then(function () { flash(els.copy, 'Copied'); }, function () { flash(els.copy, 'Failed'); });
  });
  els.save.addEventListener('click', function () { currentText().then(saveText); });
  els.clear.addEventListener('click', clearAll);
  els.about.addEventListener('click', function () {
    if (!state.libVersion) {
      MediaInfoEngine.analyze(new Blob([]), { format: 'JSON' }).then(function (r) { noteLibVersion('json', r); }, function () {});
    }
    els.aboutDlg.showModal();
  });

  // Drag & drop anywhere on the page.
  var dragDepth = 0;
  document.addEventListener('dragenter', function (e) { e.preventDefault(); dragDepth++; els.veil.classList.add('on'); });
  document.addEventListener('dragover', function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  document.addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; els.veil.classList.remove('on'); } });
  document.addEventListener('drop', function (e) {
    e.preventDefault(); dragDepth = 0; els.veil.classList.remove('on');
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  // ---- init ----------------------------------------------------------------
  els.ver.textContent = 'v' + MediaInfoEngine.version;
  renderTabs(); renderFiles(); renderReport(); updateButtons();

  window.__mediainfoApp = { addFiles: addFiles, state: state };
})();
```

- [ ] **Step 2: Build and run tests**

Run: `npm run build && npm test`
Expected: sizes printed (~3.4 MB engine, ~3.5 MB HTML); 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app.js dist/
git commit -m "Add viewer logic: queue, cache, five views, copy/save, persistence"
```

---

### Task 7: Browser verification of the built deliverable

**Files:**
- None created (verification only). Fix anything found in `src/` and rebuild.

- [ ] **Step 1: Open the deliverable from file://**

Navigate the browser pane to `file:///Users/morgan/Documents/Projects/html-mediainfo/dist/MediaInfo.html`. Screenshot. Expected: header with tabs, hint text, "v0.3.7" badge, no console errors (`read_console_messages onlyErrors`).

- [ ] **Step 2: Inject the fixture via the test hook**

Run in `javascript_tool` (base64 produced with `base64 -i test/fixtures/sample.mp4 | tr -d '\n'`):

```js
const b = Uint8Array.from(atob('<B64>'), c => c.charCodeAt(0));
window.__mediainfoApp.addFiles([new File([b], 'sample.mp4', { type: 'video/mp4' })]);
await new Promise(r => setTimeout(r, 1500));
document.getElementById('report').innerText.slice(0, 400);
```

Expected: Text report starting with `General` and containing `Format : AVC`.

- [ ] **Step 3: Walk the views**

Click Tree, JSON, XML, HTML tabs via `find`/`computer`; after each, `get_page_text` and confirm: Tree shows sections `General`, `Video`, `Audio`; JSON contains `"creatingLibrary"`; XML starts `<?xml`; HTML shows a table. Toggle Full and confirm the Text view gets longer (`innerText.length` increases). Reload, confirm the last view and Full state are restored.

- [ ] **Step 4: Error and empty paths**

```js
window.__mediainfoApp.addFiles([new File([], 'empty.bin')]);
```
Expected: sidebar row `error`, report reads "File is empty (0 bytes)" when selected. Remove it with ×; Clear all empties the list and shows the hint.

- [ ] **Step 5: Copy/Save**

Click Copy: button flashes "Copied". Click Save: the browser pane may block downloads; if so verify `saveText` is wired by checking `document.querySelector('#save').disabled === false` and note that download is to be confirmed by Morgan on a double-click open.

- [ ] **Step 6: Fix, rebuild, commit**

Any fix goes into `src/`, then `npm run build && npm test`.

```bash
git add -A
git commit -m "Verify deliverable in browser; fixes from verification"
```

---

### Task 8: README and optional CLI parity check

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

```markdown
# html-mediainfo

A single portable HTML file that does what MediaInfo does. Double-click `dist/MediaInfo.html`,
drop media files in, read the report. Nothing to install, no server, no network. Files never
leave the machine.

Powered by the real MediaInfoLib engine via [mediainfo.js](https://mediainfo.js.org)
(WebAssembly), so the output matches the desktop app.

## Deliverables

| File | Purpose |
|------|---------|
| `dist/MediaInfo.html` | Hand this to colleagues. ~3.5 MB, self-contained. |
| `dist/mediainfo-engine.js` | Drop-in engine for other single-file HTML tools. |

## Using the engine in another HTML tool

Inline `dist/mediainfo-engine.js` in a `<script>` (or reference it), then:

```js
const text = await MediaInfoEngine.analyze(file, { format: 'text' });   // like the CLI
const json = await MediaInfoEngine.analyze(file, { format: 'JSON' });
const obj  = await MediaInfoEngine.analyze(file, { format: 'object' }); // parsed JS object
// options: format 'text'|'JSON'|'XML'|'HTML'|'object', full (all fields), coverData
MediaInfoEngine.version; // mediainfo.js version
```

`analyze` reads the file in 256 KiB chunks through the File API, so multi-GB files are fine.
One MediaInfoLib instance is kept per format; calls on the same format run one at a time.

## Building

```bash
npm install
npm run build     # writes dist/
npm test          # build checks + Node smoke test against test/fixtures/sample.mp4
npm run fixture   # regenerate the fixture (needs ffmpeg)
```

To update the engine, change the pinned `mediainfo.js` version in `package.json`, `npm install`,
`npm run build`, `npm test`, and re-check `dist/MediaInfo.html` in a browser opened from disk.

## Licenses

mediainfo.js (© buzz) and MediaInfoLib (© MediaArea.net SARL) are BSD-2-Clause. The About panel
in the page reproduces the notices. This repository is BSD-2-Clause as well.
```

- [ ] **Step 2: Optional parity spot check**

If `mediainfo` CLI is available (`brew install mediainfo`), run `mediainfo test/fixtures/sample.mp4` and compare against the page's Text view for the same file. Only the `Complete name` line and library version differences are expected.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Add README with usage, embedding, and build instructions"
```
