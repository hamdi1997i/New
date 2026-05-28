/* nfc.js — thin wrapper around the Web NFC API (NDEFReader) with graceful fallbacks */
(function (global) {
  'use strict';

  const supported = typeof global.NDEFReader !== 'undefined';
  const dec = new TextDecoder();

  function isSupported() { return supported; }

  // Translate decoded NDEF records into a friendly, displayable structure.
  function decodeRecord(record) {
    const out = { recordType: record.recordType, mediaType: record.mediaType || null, id: record.id || null };
    try {
      switch (record.recordType) {
        case 'text':
          out.kind = 'text';
          out.text = dec.decode(record.data);
          out.lang = record.lang || '';
          break;
        case 'url':
        case 'absolute-url':
          out.kind = 'url';
          out.url = dec.decode(record.data);
          break;
        case 'mime':
          out.kind = 'mime';
          if (/^text\//.test(record.mediaType || '') || /json|xml|vcard|wfa/.test(record.mediaType || '')) {
            out.text = safeDecode(record.data);
          }
          out.bytes = toHex(record.data);
          break;
        case 'smart-poster':
          out.kind = 'smart-poster';
          out.bytes = toHex(record.data);
          break;
        case 'empty':
          out.kind = 'empty';
          break;
        default:
          out.kind = 'other';
          out.text = safeDecode(record.data);
          out.bytes = toHex(record.data);
      }
    } catch (e) {
      out.kind = 'other';
      out.error = e.message;
    }
    return out;
  }

  function safeDecode(buf) {
    try { return dec.decode(buf); } catch (e) { return ''; }
  }

  function toHex(buf) {
    if (!buf) return '';
    const bytes = buf instanceof DataView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  }

  // Start a continuous scan. onReading receives { serialNumber, records:[...] }.
  // Returns an AbortController so the caller can stop the scan.
  async function scan({ onReading, onError, signal } = {}) {
    if (!supported) throw new Error('Web NFC is not supported on this device/browser.');
    const reader = new global.NDEFReader();
    await reader.scan({ signal });
    reader.addEventListener('reading', (event) => {
      const records = [...event.message.records].map(decodeRecord);
      onReading && onReading({ serialNumber: event.serialNumber, records, raw: event });
    });
    reader.addEventListener('readingerror', () => {
      onError && onError(new Error('Could not read tag. Move it closer and hold steady.'));
    });
    return reader;
  }

  // Write NDEF records. `records` is an array of {recordType, ...} compatible with NDEFReader.write.
  async function write(records, { overwrite = true, signal } = {}) {
    if (!supported) throw new Error('Web NFC is not supported on this device/browser.');
    const reader = new global.NDEFReader();
    await reader.write({ records }, { overwrite, signal });
  }

  // Attempt to make the tag permanently read-only.
  async function makeReadOnly({ signal } = {}) {
    if (!supported) throw new Error('Web NFC is not supported on this device/browser.');
    const reader = new global.NDEFReader();
    if (typeof reader.makeReadOnly !== 'function') {
      throw new Error('makeReadOnly() is not available in this browser.');
    }
    await reader.makeReadOnly({ signal });
  }

  global.NFC = { isSupported, scan, write, makeReadOnly, decodeRecord, toHex };
})(window);
