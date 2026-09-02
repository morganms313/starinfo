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
      d.appendChild(sanitizeHtml(String(res)));
      els.report.appendChild(d);
      return;
    }
    var pre = document.createElement('pre'); pre.textContent = String(res);
    els.report.appendChild(pre);
  }

  // MediaInfo's HTML output is a plain table, but field values come from arbitrary
  // files: parse into an inert document and drop anything executable.
  function sanitizeHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    Array.prototype.forEach.call(doc.querySelectorAll('script, style, link, meta, iframe, object, embed, form'), function (n) { n.remove(); });
    Array.prototype.forEach.call(doc.body.querySelectorAll('*'), function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var name = a.name.toLowerCase();
        if (name.indexOf('on') === 0 || ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
      });
    });
    var frag = document.createDocumentFragment();
    while (doc.body.firstChild) frag.appendChild(doc.body.firstChild);
    return frag;
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
