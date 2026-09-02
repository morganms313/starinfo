# html-mediainfo — portable single-file MediaInfo viewer

**Date:** 2026-09-02
**Status:** approved

## Goal

A single HTML file, handed to colleagues, that reproduces MediaInfo's core
feature set with no install and no server. Open it from disk, drop media
files in, read the report. The MediaInfo engine is packaged as a reusable
script so future single-file HTML tools can embed the same engine.

## Approach

Use the official WebAssembly build of MediaInfoLib (`mediainfo.js`, npm,
pinned at **0.3.7**, BSD-2). This is the real MediaInfo engine, not a
reimplementation, so output parity with the desktop app is inherent.
The 2.5 MB WASM and the 11 KB UMD loader are base64-inlined into the HTML.
Expected deliverable size: ~3.5 MB.

Rejected alternatives: hand-written JS parsers (never reaches parity) and
an HTML shell over a local `mediainfo` binary (not portable).

## Repository layout

```
html-mediainfo/
  package.json               mediainfo.js@0.3.7 pinned; `npm run build`, `npm test`
  build/build.mjs            Node script, no bundler
  src/engine.js              reusable wrapper -> window.MediaInfoEngine
  src/app.html               viewer markup; contains @@ENGINE@@ / @@CSS@@ / @@JS@@ markers
  src/app.css                viewer styles
  src/app.js                 viewer logic
  dist/mediainfo-engine.js   REUSABLE ARTIFACT: one <script> for any HTML tool
  dist/MediaInfo.html        DELIVERABLE for colleagues
  test/                      build test, Node smoke test, sample generation
  docs/superpowers/specs/    this document
  README.md
```

`dist/` is build output only; never hand-edited.

## Build (`build/build.mjs`)

1. Read `node_modules/mediainfo.js/dist/umd/index.min.js` and
   `node_modules/mediainfo.js/dist/MediaInfoModule.wasm`.
2. Base64-encode the WASM.
3. Emit `dist/mediainfo-engine.js` =
   UMD loader + `src/engine.js` with `@@WASM_B64@@` and `@@VERSION@@`
   markers replaced (version read from the package's `package.json`).
4. Emit `dist/MediaInfo.html` = `src/app.html` with `@@ENGINE@@` replaced by
   the engine script, `@@CSS@@` by `src/app.css`, `@@JS@@` by `src/app.js`.
5. Print output sizes.

Marker replacement uses a function replacer so `$` sequences in the payload
are not interpreted.

## Reusable engine (`window.MediaInfoEngine`)

```
MediaInfoEngine.version            // "0.3.7" (mediainfo.js)
MediaInfoEngine.create(options)    // -> Promise<MediaInfo>  (mediainfo.js instance)
MediaInfoEngine.analyze(blob, options) // -> Promise<string | object>
```

- `options`: `{ format: 'object'|'JSON'|'XML'|'HTML'|'text', full: boolean, coverData: boolean }`.
  Defaults: `format: 'text'`, `full: false`, `coverData: false`.
- WASM loading: on first use, decode the base64 once into a `Uint8Array`,
  wrap in a `Blob`, and return `URL.createObjectURL(blob)` from
  `locateFile`. Object URLs fetch correctly from `file://` in Chrome,
  Edge, Firefox, and Safari. The decoded bytes are cached for the page
  lifetime.
- Because the output format is fixed per MediaInfoLib instance
  (`_mi_new(format, coverData, full)`), `analyze` keeps one instance per
  `format|full|coverData` key and calls `reset()`-via-`analyzeData`
  between files. Instances are created lazily.
- Chunked reading: `readChunk(size, offset)` returns
  `new Uint8Array(await blob.slice(offset, offset + size).arrayBuffer())`.
  Chunk size is mediainfo.js's default (256 KiB).
- Concurrency: `analyze` serialises calls per instance with a promise
  queue, because `analyzeData` rejects if a parse is already in progress.
- No network access of any kind. Stated in README and in the About panel.

## Viewer

Single page, vanilla JS, no framework, no external requests.

**Layout**
- Full-window drop target. Dropping anywhere adds files.
- Header: title, "Open files…" button (`<input type=file multiple>`),
  Full toggle, view tabs, Copy, Save, Clear all, About.
- Left sidebar: file list — name, human size, status
  (queued / parsing / done / error). Click selects. Remove per file.
- Main panel: the report for the selected file in a `<pre>` (Text, JSON,
  XML), an iframe-free rendered block for HTML (MediaInfo's HTML output
  is a plain table; inject into a `div` after stripping `<script>` tags,
  which MediaInfo does not emit anyway), or the Tree.

**Views** — Text, Tree, JSON, XML, HTML.
- Text/JSON/XML/HTML come straight from the engine with the matching
  `format`.
- Tree is built client-side by parsing the Text output (`src/parse-text.js`): one collapsible
  section per track (`General`, `Video`, `Audio #1`, …), rows of human-readable
  field → value. Sections expanded by default; state per section kept in
  memory only.

**Full toggle** maps to `full: true` (MediaInfo "Complete" / all fields).

**Caching** — results keyed by `fileId|format|full`. Switching views or
toggling Full re-parses only on a cache miss. Parses run one at a time
in drop order; the selected file's current view is prioritised at the
front of the queue.

**Copy** writes the current view's raw text to the clipboard (for Tree,
the Text output is copied instead, fetched if not cached). **Save**
downloads via `<a download>` on a Blob with extension `.txt`, `.json`,
`.xml`, `.html` (Tree saves as `.txt`). File name: `<original>.mediainfo.<ext>`.

**Persistence** — `localStorage`: selected view, Full toggle. Reads and
writes wrapped in try/catch; defaults apply if storage is unavailable.

**Theme** — light and dark via `prefers-color-scheme`; monospace report
body; system font UI. No external fonts.

**About panel** — mediainfo.js version, MediaInfoLib version (parsed from
the `creatingLibrary` block of the first JSON result, or "unknown" before
any parse), BSD-2 license text for mediainfo.js and MediaInfoLib, and the
statement that files never leave the machine.

**Errors** — a failed parse marks the file `error` in the sidebar and
shows the message in the main panel; other files continue. Files of size
0 are reported as such without invoking the engine.

## Verification

1. **Spike first.** Before any UI work: a bare page with the inlined
   engine, opened from `file://` in the browser pane, must parse a sample
   file. If object-URL loading fails anywhere, fall back to a `data:`
   URL and re-test. UI work starts only after this passes.
2. **Build test** (`node --test`): markers replaced, no `@@` left in
   outputs, decoded base64 length equals the WASM byte length, engine
   file is self-contained (no `import`/`require` at top level).
3. **Engine smoke test** (Node): generate `test/fixtures/sample.mp4`
   with ffmpeg (`testsrc` + `sine`, 2 s) if missing; run mediainfo.js
   on it; assert one Video and one Audio track, `Format: AVC` / `AAC`.
4. **Browser check** in the browser pane against `dist/MediaInfo.html`:
   drop the sample, confirm all five views render, Full toggle changes
   the field count, Copy/Save work, state persists across reload.
5. **Parity spot check** (optional, needs `brew install mediainfo`):
   diff Text output of the CLI vs the page for the sample; differences
   limited to library version line and file path are acceptable.

## Out of scope (v1)

- Directory drop / recursive folder scan.
- Cover art display (`coverData`) in the UI — engine supports it, viewer
  does not expose it.
- EBUCore / PBCore / other MediaInfo export formats not exposed by
  mediainfo.js.
- Auto-update of the bundled library; bump by changing the pinned version
  and rebuilding.

## Licenses

mediainfo.js and MediaInfoLib are BSD-2-Clause. The About panel and
README reproduce the notices. The deliverable may be redistributed freely.
