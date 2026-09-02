# html-mediainfo

A single portable HTML file that does what MediaInfo does. Double-click `dist/MediaInfo.html`,
drop media files in, read the report. Nothing to install, no server, no network. Files never
leave the machine.

Powered by the real MediaInfoLib engine via [mediainfo.js](https://mediainfo.js.org)
(WebAssembly), so the output matches the desktop app.

## Deliverables

| File | Purpose |
|------|---------|
| `dist/MediaInfo.html` | Hand this to colleagues. ~3.3 MB, self-contained. |
| `dist/mediainfo-engine.js` | Drop-in engine for other single-file HTML tools. |

Views: Text, Tree, JSON, XML, HTML. "Full" shows every field (MediaInfo's Complete mode).
Copy and Save export the current view. The chosen view and Full setting are remembered.

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
`MediaInfoEngine.create(options)` returns a raw mediainfo.js instance if you need the low-level API.

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
