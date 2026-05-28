/* records.js — record type definitions, form fields, and NDEF encoding helpers */
(function (global) {
  'use strict';

  const enc = new TextEncoder();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Build a Wi-Fi NDEF MIME payload (application/vnd.wfa.wsc) as a byte array.
  // Implements the Wi-Fi Simple Configuration credential TLV format.
  function wifiPayload({ ssid, password, auth }) {
    const ssidBytes = enc.encode(ssid || '');
    const pwdBytes = enc.encode(password || '');
    const authMap = { nopass: 0x0001, WEP: 0x0002, WPA: 0x0020, WPA2: 0x0020 };
    const authType = authMap[auth] || 0x0020;
    const encrType = auth === 'nopass' ? 0x0001 : 0x0008; // None / AES

    function tlv(type, dataBytes) {
      const out = [(type >> 8) & 0xff, type & 0xff, (dataBytes.length >> 8) & 0xff, dataBytes.length & 0xff];
      return out.concat(Array.from(dataBytes));
    }

    let cred = [];
    cred = cred.concat(tlv(0x1026, [1]));                       // Network Index
    cred = cred.concat(tlv(0x1045, ssidBytes));                 // SSID
    cred = cred.concat(tlv(0x1003, [(authType >> 8) & 0xff, authType & 0xff])); // Auth Type
    cred = cred.concat(tlv(0x100f, [(encrType >> 8) & 0xff, encrType & 0xff])); // Encryption Type
    if (auth !== 'nopass') cred = cred.concat(tlv(0x1027, pwdBytes)); // Network Key
    cred = cred.concat(tlv(0x1020, [0, 0, 0, 0, 0, 0]));        // MAC (wildcard)

    const credential = tlv(0x100e, cred);                       // Credential wrapper
    return new Uint8Array(credential);
  }

  // Definitions: each entry describes default data, how to render a form, and how to encode.
  const TYPES = {
    text: {
      label: 'Text',
      icon: '📝',
      defaults: { text: '', lang: 'en' },
      fields: (d) => `
        <label>Language code <input data-k="lang" value="${esc(d.lang)}" maxlength="8" placeholder="en"></label>
        <label>Text <textarea data-k="text" placeholder="Your text…">${esc(d.text)}</textarea></label>`,
      summary: (d) => d.text ? `“${d.text.slice(0, 60)}”` : '(empty text)',
      encode: (d) => ({ recordType: 'text', lang: d.lang || 'en', data: d.text || '' })
    },
    url: {
      label: 'URL', icon: '🔗',
      defaults: { url: 'https://' },
      fields: (d) => `<label>URL <input data-k="url" type="url" value="${esc(d.url)}" placeholder="https://example.com"></label>`,
      summary: (d) => d.url || '(empty url)',
      encode: (d) => ({ recordType: 'url', data: d.url || '' })
    },
    wifi: {
      label: 'Wi-Fi', icon: '📶',
      defaults: { ssid: '', password: '', auth: 'WPA2' },
      fields: (d) => `
        <label>Network name (SSID) <input data-k="ssid" value="${esc(d.ssid)}"></label>
        <label>Security
          <select data-k="auth">
            ${['WPA2', 'WPA', 'WEP', 'nopass'].map((a) => `<option ${a === d.auth ? 'selected' : ''} value="${a}">${a === 'nopass' ? 'Open (no password)' : a}</option>`).join('')}
          </select></label>
        <label>Password <input data-k="password" value="${esc(d.password)}" autocomplete="off"></label>`,
      summary: (d) => `“${d.ssid || '?'}” · ${d.auth === 'nopass' ? 'open' : d.auth}`,
      encode: (d) => ({ recordType: 'mime', mediaType: 'application/vnd.wfa.wsc', data: wifiPayload(d) })
    },
    vcard: {
      label: 'Contact', icon: '👤',
      defaults: { name: '', phone: '', email: '', org: '', url: '' },
      fields: (d) => `
        <label>Full name <input data-k="name" value="${esc(d.name)}"></label>
        <label>Phone <input data-k="phone" value="${esc(d.phone)}"></label>
        <label>Email <input data-k="email" value="${esc(d.email)}"></label>
        <label>Organization <input data-k="org" value="${esc(d.org)}"></label>
        <label>Website <input data-k="url" value="${esc(d.url)}"></label>`,
      summary: (d) => d.name || d.email || d.phone || '(empty contact)',
      encode: (d) => {
        const v = ['BEGIN:VCARD', 'VERSION:3.0'];
        if (d.name) v.push('FN:' + d.name);
        if (d.org) v.push('ORG:' + d.org);
        if (d.phone) v.push('TEL;TYPE=CELL:' + d.phone);
        if (d.email) v.push('EMAIL:' + d.email);
        if (d.url) v.push('URL:' + d.url);
        v.push('END:VCARD');
        return { recordType: 'mime', mediaType: 'text/vcard', data: enc.encode(v.join('\r\n')) };
      }
    },
    email: {
      label: 'Email', icon: '✉️',
      defaults: { to: '', subject: '', body: '' },
      fields: (d) => `
        <label>To <input data-k="to" type="email" value="${esc(d.to)}"></label>
        <label>Subject <input data-k="subject" value="${esc(d.subject)}"></label>
        <label>Body <textarea data-k="body">${esc(d.body)}</textarea></label>`,
      summary: (d) => 'mailto:' + (d.to || '?'),
      encode: (d) => {
        const params = [];
        if (d.subject) params.push('subject=' + encodeURIComponent(d.subject));
        if (d.body) params.push('body=' + encodeURIComponent(d.body));
        const uri = 'mailto:' + (d.to || '') + (params.length ? '?' + params.join('&') : '');
        return { recordType: 'url', data: uri };
      }
    },
    sms: {
      label: 'SMS', icon: '💬',
      defaults: { number: '', body: '' },
      fields: (d) => `
        <label>Number <input data-k="number" value="${esc(d.number)}"></label>
        <label>Message <textarea data-k="body">${esc(d.body)}</textarea></label>`,
      summary: (d) => 'sms:' + (d.number || '?'),
      encode: (d) => ({ recordType: 'url', data: 'sms:' + (d.number || '') + (d.body ? '?body=' + encodeURIComponent(d.body) : '') })
    },
    tel: {
      label: 'Phone', icon: '📞',
      defaults: { number: '' },
      fields: (d) => `<label>Phone number <input data-k="number" value="${esc(d.number)}" placeholder="+1234567890"></label>`,
      summary: (d) => 'tel:' + (d.number || '?'),
      encode: (d) => ({ recordType: 'url', data: 'tel:' + (d.number || '') })
    },
    geo: {
      label: 'Location', icon: '📍',
      defaults: { lat: '', lng: '' },
      fields: (d) => `
        <div class="grid2">
          <label>Latitude <input data-k="lat" type="number" step="any" value="${esc(d.lat)}"></label>
          <label>Longitude <input data-k="lng" type="number" step="any" value="${esc(d.lng)}"></label>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="geolocate">📍 Use my location</button>`,
      summary: (d) => `geo:${d.lat || '?'},${d.lng || '?'}`,
      encode: (d) => ({ recordType: 'url', data: `geo:${d.lat || 0},${d.lng || 0}` })
    },
    app: {
      label: 'Android app', icon: '📱',
      defaults: { pkg: '' },
      fields: (d) => `<label>Package name <input data-k="pkg" value="${esc(d.pkg)}" placeholder="com.example.app"></label>`,
      summary: (d) => 'AAR · ' + (d.pkg || '?'),
      encode: (d) => ({ recordType: 'android.com:pkg', data: enc.encode(d.pkg || '') })
    },
    mime: {
      label: 'Custom MIME', icon: '🧬',
      defaults: { mediaType: 'application/json', text: '' },
      fields: (d) => `
        <label>Media type <input data-k="mediaType" value="${esc(d.mediaType)}"></label>
        <label>Content <textarea data-k="text">${esc(d.text)}</textarea></label>`,
      summary: (d) => d.mediaType,
      encode: (d) => ({ recordType: 'mime', mediaType: d.mediaType || 'application/octet-stream', data: enc.encode(d.text || '') })
    },
    raw: {
      label: 'External type', icon: '🧱',
      defaults: { domainType: 'example.com:myType', text: '' },
      fields: (d) => `
        <label>External type <input data-k="domainType" value="${esc(d.domainType)}" placeholder="domain.com:typeName"></label>
        <label>Payload <textarea data-k="text">${esc(d.text)}</textarea></label>`,
      summary: (d) => d.domainType,
      encode: (d) => ({ recordType: d.domainType || 'example.com:raw', data: enc.encode(d.text || '') })
    }
  };

  // Approximate the encoded byte length of a record's payload for the capacity meter.
  function estimateSize(type, data) {
    try {
      const rec = TYPES[type].encode(data);
      let payload = rec.data;
      let len;
      if (typeof payload === 'string') len = enc.encode(payload).length;
      else if (payload instanceof Uint8Array) len = payload.length;
      else len = 0;
      // header (~3-6 B) + type length + optional lang/mediaType
      return len + 7 + (rec.mediaType ? rec.mediaType.length : 0) + (rec.lang ? rec.lang.length : 0);
    } catch (e) { return 0; }
  }

  global.NFCRecords = { TYPES, estimateSize, esc };
})(window);
