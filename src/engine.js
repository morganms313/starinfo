/*
 * MediaInfoEngine — self-contained MediaInfoLib (WebAssembly) for single-file HTML tools.
 * Built from mediainfo.js @@VERSION@@ (BSD-2-Clause, https://mediainfo.js.org) and
 * MediaInfoLib (BSD-2-Clause, https://mediaarea.net). No network access.
 *
 *   MediaInfoEngine.version                                 -> "@@VERSION@@"
 *   MediaInfoEngine.create({format, full, coverData})       -> Promise<MediaInfo>
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
