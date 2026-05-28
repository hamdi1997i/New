/* app.js — UI state, wiring and orchestration */
(function () {
  'use strict';

  const { TYPES, estimateSize, esc } = window.NFCRecords;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---------------------------------------------------------------- state
  let records = load('nfc.records', []);
  let history = load('nfc.history', []);
  let currentScan = null;       // active NDEFReader for read tab
  let activeController = null;  // AbortController for write/tool operations
  let pendingClone = null;      // records captured during a clone operation

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch (e) { return fallback; }
  }
  function save() {
    localStorage.setItem('nfc.records', JSON.stringify(records));
    localStorage.setItem('nfc.history', JSON.stringify(history));
  }

  // ---------------------------------------------------------------- toast
  let toastTimer;
  function toast(msg, kind = 'info') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
  }

  // ---------------------------------------------------------------- history
  function logHistory(type, detail, kind = 'info') {
    history.unshift({ ts: Date.now(), type, detail, kind });
    history = history.slice(0, 100);
    save();
    renderHistory();
  }
  function renderHistory() {
    const list = $('#history-list');
    $('#history-empty').hidden = history.length > 0;
    list.innerHTML = history.map((h) => `
      <li class="history-item ${esc(h.kind)}">
        <span class="hi-icon">${h.kind === 'error' ? '⚠️' : h.kind === 'success' ? '✅' : 'ℹ️'}</span>
        <div>
          <div class="hi-type">${esc(h.type)}</div>
          <div class="hi-detail">${esc(h.detail)}</div>
        </div>
        <time>${new Date(h.ts).toLocaleString()}</time>
      </li>`).join('');
  }

  // ---------------------------------------------------------------- records UI
  function renderRecords() {
    const list = $('#records-list');
    $('#records-empty').hidden = records.length > 0;
    list.innerHTML = records.map((r, i) => {
      const def = TYPES[r.type];
      return `
        <li class="record" data-i="${i}">
          <div class="record-head">
            <span class="record-type">${def.icon} ${def.label}</span>
            <span class="record-summary">${esc(def.summary(r.data))}</span>
            <div class="record-actions">
              <button class="icon-btn" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button class="icon-btn" data-act="down" title="Move down" ${i === records.length - 1 ? 'disabled' : ''}>▼</button>
              <button class="icon-btn" data-act="edit" title="Edit">✏️</button>
              <button class="icon-btn" data-act="del" title="Delete">🗑</button>
            </div>
          </div>
          <div class="record-body" ${r._open ? '' : 'hidden'}>${def.fields(r.data)}</div>
        </li>`;
    }).join('');
    updateCapacity();
    save();
  }

  function updateCapacity() {
    const total = records.reduce((sum, r) => sum + estimateSize(r.type, r.data), 0);
    const cap = parseInt($('#tag-capacity').value, 10);
    $('#payload-size').textContent = `${total} bytes`;
    const fill = $('#capacity-fill');
    if (cap > 0) {
      const pct = Math.min(100, (total / cap) * 100);
      fill.style.width = pct + '%';
      fill.className = 'capacity-fill' + (total > cap ? ' over' : pct > 80 ? ' warn' : '');
      $('#payload-size').textContent = `${total} / ${cap} bytes`;
    } else {
      fill.style.width = '0%';
      fill.className = 'capacity-fill';
    }
  }

  function addRecord(type) {
    const def = TYPES[type];
    records.push({ type, data: JSON.parse(JSON.stringify(def.defaults)), _open: true });
    renderRecords();
  }

  // delegated events for record list
  $('#records-list').addEventListener('click', (e) => {
    const li = e.target.closest('.record');
    if (!li) return;
    const i = +li.dataset.i;
    const act = e.target.dataset.act || e.target.dataset.action;
    if (act === 'del') { records.splice(i, 1); renderRecords(); }
    else if (act === 'edit') { records[i]._open = !records[i]._open; renderRecords(); }
    else if (act === 'up' && i > 0) { [records[i - 1], records[i]] = [records[i], records[i - 1]]; renderRecords(); }
    else if (act === 'down' && i < records.length - 1) { [records[i + 1], records[i]] = [records[i], records[i + 1]]; renderRecords(); }
    else if (act === 'geolocate') { geolocate(i); }
  });

  // live-edit inputs inside a record body
  $('#records-list').addEventListener('input', (e) => {
    const li = e.target.closest('.record');
    const k = e.target.dataset.k;
    if (!li || !k) return;
    const i = +li.dataset.i;
    records[i].data[k] = e.target.value;
    // refresh the summary line without collapsing the open editor
    const sumEl = $('.record-summary', li);
    if (sumEl) sumEl.textContent = TYPES[records[i].type].summary(records[i].data);
    updateCapacity();
    save();
  });

  function geolocate(i) {
    if (!navigator.geolocation) return toast('Geolocation not available', 'error');
    toast('Getting your location…');
    navigator.geolocation.getCurrentPosition((pos) => {
      records[i].data.lat = pos.coords.latitude.toFixed(6);
      records[i].data.lng = pos.coords.longitude.toFixed(6);
      renderRecords();
      toast('Location captured', 'success');
    }, () => toast('Could not get location', 'error'));
  }

  // ---------------------------------------------------------------- encoding
  function buildNdefRecords() {
    if (!records.length) throw new Error('Add at least one record first.');
    return records.map((r) => TYPES[r.type].encode(r.data));
  }

  // ---------------------------------------------------------------- WRITE
  async function doWrite() {
    let ndef;
    try { ndef = buildNdefRecords(); }
    catch (e) { return toast(e.message, 'error'); }

    if (!window.NFC.isSupported()) {
      return toast('Web NFC unavailable. Use Chrome on Android over HTTPS.', 'error');
    }
    const overwrite = $('#opt-overwrite').checked;
    const lock = $('#opt-lock').checked;
    if (lock && !confirm('Locking is PERMANENT — the tag can never be rewritten. Continue?')) return;

    activeController = new AbortController();
    showOverlay('Tap your tag to write…');
    toggleWriteButtons(true);
    try {
      await window.NFC.write(ndef, { overwrite, signal: activeController.signal });
      if (lock) {
        showOverlay('Tap again to LOCK the tag…');
        await window.NFC.makeReadOnly({ signal: activeController.signal });
      }
      toast('✅ Tag written' + (lock ? ' & locked' : '') + ' successfully', 'success');
      logHistory('Write', `${records.length} record(s)${lock ? ', locked' : ''}`, 'success');
    } catch (e) {
      if (e.name !== 'AbortError') { toast('Write failed: ' + e.message, 'error'); logHistory('Write failed', e.message, 'error'); }
    } finally {
      hideOverlay();
      toggleWriteButtons(false);
      activeController = null;
    }
  }

  function toggleWriteButtons(busy) {
    $('#write-btn').disabled = busy;
    $('#cancel-write').hidden = !busy;
  }

  // ---------------------------------------------------------------- READ
  async function startScan() {
    if (!window.NFC.isSupported()) {
      return toast('Web NFC unavailable. Use Chrome on Android over HTTPS.', 'error');
    }
    setScanStatus('Scanning… tap a tag now.', 'active');
    $('#scan-btn').hidden = true;
    $('#stop-scan-btn').hidden = false;
    activeController = new AbortController();
    try {
      currentScan = await window.NFC.scan({
        signal: activeController.signal,
        onReading: handleReading,
        onError: (err) => setScanStatus(err.message, 'error')
      });
    } catch (e) {
      setScanStatus('Scan error: ' + e.message, 'error');
      stopScan();
    }
  }

  function stopScan() {
    if (activeController) activeController.abort();
    activeController = null;
    currentScan = null;
    $('#scan-btn').hidden = false;
    $('#stop-scan-btn').hidden = true;
    if ($('#scan-status').classList.contains('active')) setScanStatus('Stopped.', 'idle');
  }

  function setScanStatus(msg, kind) {
    const el = $('#scan-status');
    el.textContent = msg;
    el.className = 'scan-status ' + kind;
  }

  let lastRead = null;
  function handleReading({ serialNumber, records: recs }) {
    lastRead = { serialNumber, records: recs };
    setScanStatus('Tag read ✓', 'success');
    logHistory('Read', `${recs.length} record(s) · ${serialNumber || 'no serial'}`, 'success');
    renderReadResult(serialNumber, recs);

    // If a clone was requested, capture and route to writer.
    if (pendingClone === 'capture') {
      pendingClone = recs;
      setToolsStatus('Captured. Now tap the destination tag to write.', 'active');
    }
  }

  function renderReadResult(serial, recs) {
    const wrap = $('#read-result');
    $('#read-footer').hidden = false;
    wrap.innerHTML = `
      <div class="tag-meta">
        <span class="pill">Serial: ${esc(serial || 'unknown')}</span>
        <span class="pill">${recs.length} record(s)</span>
      </div>
      ${recs.map((r, i) => renderReadRecord(r, i)).join('')}`;
  }

  function renderReadRecord(r, i) {
    let body = '';
    if (r.kind === 'text') body = `<p class="rr-text">${esc(r.text)}</p><small>lang: ${esc(r.lang || '—')}</small>`;
    else if (r.kind === 'url') body = `<a class="rr-link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>`;
    else if (r.kind === 'empty') body = '<em>Empty record</em>';
    else { body = (r.text ? `<p class="rr-text">${esc(r.text)}</p>` : '') + (r.bytes ? `<code class="rr-hex">${esc(r.bytes)}</code>` : ''); }
    return `
      <div class="rr-card">
        <div class="rr-head"><strong>#${i + 1} · ${esc(r.recordType)}</strong>${r.mediaType ? `<span class="pill pill-muted">${esc(r.mediaType)}</span>` : ''}</div>
        ${body}
      </div>`;
  }

  // map decoded read records back into editable writer records (best effort)
  function readToWriterRecords(recs) {
    const out = [];
    recs.forEach((r) => {
      if (r.kind === 'text') out.push({ type: 'text', data: { text: r.text, lang: r.lang || 'en' }, _open: false });
      else if (r.kind === 'url') {
        if (/^https?:/i.test(r.url)) out.push({ type: 'url', data: { url: r.url }, _open: false });
        else if (/^tel:/i.test(r.url)) out.push({ type: 'tel', data: { number: r.url.slice(4) }, _open: false });
        else out.push({ type: 'url', data: { url: r.url }, _open: false });
      } else if (r.kind === 'mime' && r.text) {
        out.push({ type: 'mime', data: { mediaType: r.mediaType || 'text/plain', text: r.text }, _open: false });
      } else if (r.text) {
        out.push({ type: 'text', data: { text: r.text, lang: 'en' }, _open: false });
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- TOOLS
  function setToolsStatus(msg, kind) {
    const el = $('#tools-status');
    el.textContent = msg;
    el.className = 'scan-status ' + kind;
  }

  async function tool(name) {
    if (!window.NFC.isSupported()) return setToolsStatus('Web NFC unavailable on this device.', 'error');
    if (name === 'erase') return toolWrite([{ recordType: 'empty' }], 'Erase', 'Tag erased');
    if (name === 'lock') return toolLock();
    if (name === 'clone') return toolClone();
    if (name === 'info') return toolInfo();
  }

  async function toolWrite(ndef, label, okMsg) {
    activeController = new AbortController();
    setToolsStatus('Tap your tag…', 'active');
    showOverlay('Tap your tag…');
    try {
      await window.NFC.write(ndef, { overwrite: true, signal: activeController.signal });
      setToolsStatus('✅ ' + okMsg, 'success');
      toast('✅ ' + okMsg, 'success');
      logHistory(label, okMsg, 'success');
    } catch (e) {
      if (e.name !== 'AbortError') { setToolsStatus('Failed: ' + e.message, 'error'); logHistory(label + ' failed', e.message, 'error'); }
    } finally { hideOverlay(); activeController = null; }
  }

  async function toolLock() {
    if (!confirm('Locking is PERMANENT and cannot be undone. Continue?')) return;
    activeController = new AbortController();
    setToolsStatus('Tap your tag to lock…', 'active');
    showOverlay('Tap your tag to LOCK…');
    try {
      await window.NFC.makeReadOnly({ signal: activeController.signal });
      setToolsStatus('🔒 Tag locked (read-only).', 'success');
      toast('🔒 Tag locked', 'success');
      logHistory('Lock', 'Tag made read-only', 'success');
    } catch (e) {
      if (e.name !== 'AbortError') { setToolsStatus('Failed: ' + e.message, 'error'); }
    } finally { hideOverlay(); activeController = null; }
  }

  async function toolClone() {
    // Step 1: read source, step 2: route to writer for destination.
    switchTab('read');
    pendingClone = 'capture';
    toast('Clone: scan the SOURCE tag first', 'info');
    setScanStatus('Clone mode — scan the SOURCE tag.', 'active');
    if (!activeController) startScan();
    const check = setInterval(() => {
      if (Array.isArray(pendingClone)) {
        clearInterval(check);
        records = readToWriterRecords(pendingClone);
        pendingClone = null;
        stopScan();
        renderRecords();
        switchTab('write');
        toast('Source captured → review & write to destination tag', 'success');
        logHistory('Clone', `${records.length} record(s) captured`, 'info');
      }
    }, 400);
  }

  async function toolInfo() {
    switchTab('read');
    toast('Tag info: scan a tag to see serial & records', 'info');
    if (!activeController) startScan();
  }

  // ---------------------------------------------------------------- overlay
  function showOverlay(text) { $('#overlay-text').textContent = text; $('#overlay').hidden = false; }
  function hideOverlay() { $('#overlay').hidden = true; }

  // Cancel any active operation AND force the UI back to a clean state, even if
  // the underlying NFC promise never rejects on abort (happens on some devices).
  function cancelActive() {
    if (activeController) { try { activeController.abort(); } catch (e) {} }
    activeController = null;
    hideOverlay();
    toggleWriteButtons(false);
    if ($('#tools-status').classList.contains('active')) setToolsStatus('Cancelled.', 'idle');
    toast('Cancelled');
  }

  // ---------------------------------------------------------------- import / export
  function exportRecords() {
    const blob = new Blob([JSON.stringify({ version: 1, records }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `nfc-records-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('Records exported', 'success');
  }
  function importRecords(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const imported = Array.isArray(data) ? data : data.records;
        if (!Array.isArray(imported)) throw new Error('Invalid file');
        records = imported.filter((r) => r && TYPES[r.type]);
        renderRecords();
        toast(`Imported ${records.length} record(s)`, 'success');
      } catch (e) { toast('Import failed: ' + e.message, 'error'); }
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------- tabs
  function switchTab(name) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  }

  // ---------------------------------------------------------------- theme
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('#theme-toggle').textContent = t === 'light' ? '☀️' : '🌙';
    localStorage.setItem('nfc.theme', t);
  }

  // ---------------------------------------------------------------- support pill
  function refreshSupport() {
    const pill = $('#support-pill');
    if (window.NFC.isSupported()) {
      pill.textContent = '✅ Web NFC ready';
      pill.className = 'pill pill-ok';
    } else {
      pill.textContent = '⚠️ NFC not supported';
      pill.className = 'pill pill-warn';
      pill.title = 'Web NFC needs Chrome on Android over HTTPS.';
    }
  }

  // ---------------------------------------------------------------- converter
  function updateConverter() {
    const txt = $('#conv-text').value;
    const bytes = new TextEncoder().encode(txt);
    const hex = Array.from(bytes.slice(0, 64)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    $('#conv-out').innerHTML = `<strong>${bytes.length}</strong> bytes · <strong>${txt.length}</strong> chars`
      + (hex ? `<br><code>${esc(hex)}${bytes.length > 64 ? ' …' : ''}</code>` : '');
  }

  // ---------------------------------------------------------------- wire up
  function init() {
    // tabs
    $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    // theme
    applyTheme(localStorage.getItem('nfc.theme') || 'dark');
    $('#theme-toggle').addEventListener('click', () =>
      applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
    // records
    $('#add-record').addEventListener('click', () => addRecord($('#record-type').value));
    $('#clear-records').addEventListener('click', () => {
      if (records.length && confirm('Remove all records?')) { records = []; renderRecords(); }
    });
    $('#export-records').addEventListener('click', exportRecords);
    $('#import-records').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', (e) => e.target.files[0] && importRecords(e.target.files[0]));
    $('#tag-capacity').addEventListener('change', updateCapacity);
    // write
    $('#write-btn').addEventListener('click', doWrite);
    $('#cancel-write').addEventListener('click', cancelActive);
    // read
    $('#scan-btn').addEventListener('click', startScan);
    $('#stop-scan-btn').addEventListener('click', stopScan);
    $('#copy-to-write').addEventListener('click', () => {
      if (!lastRead) return;
      records = readToWriterRecords(lastRead.records);
      renderRecords(); switchTab('write');
      toast('Records copied to Writer', 'success');
    });
    $('#copy-read-json').addEventListener('click', () => {
      if (!lastRead) return;
      navigator.clipboard.writeText(JSON.stringify(lastRead, null, 2));
      toast('JSON copied', 'success');
    });
    // tools
    $$('.tool-card').forEach((c) => c.addEventListener('click', () => tool(c.dataset.tool)));
    $('#conv-text').addEventListener('input', updateConverter);
    // history
    $('#clear-history').addEventListener('click', () => {
      if (confirm('Clear all history?')) { history = []; save(); renderHistory(); }
    });
    // overlay cancel
    $('#overlay-cancel').addEventListener('click', cancelActive);

    refreshSupport();
    renderRecords();
    renderHistory();
    updateConverter();

    // register service worker for offline/PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
