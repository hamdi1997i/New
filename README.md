# 📡 NFC Studio — Advanced NFC Writer & Reader

A polished, framework-free web tool for **reading and writing NFC tags** directly
from your browser using the [Web NFC API](https://developer.mozilla.org/docs/Web/API/Web_NFC_API).
Everything runs on-device — no servers, no tracking.

![tech](https://img.shields.io/badge/Web%20NFC-Chrome%20Android-blue) ![pwa](https://img.shields.io/badge/PWA-installable-success) ![deps](https://img.shields.io/badge/dependencies-none-brightgreen)

## ✨ Features

### Writer
Build a multi-record payload and write it to a tag, with a live **capacity meter**
that warns you before you exceed the tag's storage:

| Record type | Description |
|---|---|
| 📝 Text | Plain text with language code |
| 🔗 URL | Web links (proper NDEF URL record) |
| 📶 Wi-Fi | Tap-to-connect credentials (WPA2/WPA/WEP/Open) via WSC payload |
| 👤 Contact | vCard 3.0 (name, phone, email, org, website) |
| ✉️ Email | `mailto:` with subject & body |
| 💬 SMS | Pre-filled text message |
| 📞 Phone | One-tap dial |
| 📍 Geo | Map coordinates (with "use my location") |
| 📱 Android app | Android Application Record (open/install an app) |
| 🧬 Custom MIME | Any media type + payload |
| 🧱 External type | Raw `domain:type` records |

- **Reorder, edit and delete** records inline
- **Overwrite** toggle and **🔒 make read-only** (permanent lock) option
- **Export / import** record sets as JSON

### Reader
- Continuous scanning with a friendly tap overlay
- Decodes text, URL, MIME, and raw records, shows the tag **serial number**
- **Clone to Writer** — copy a tag's contents straight into the editor
- Copy the decoded result as JSON

### Tools
- 🧹 **Erase** a tag (write an empty record)
- 🔒 **Lock** a tag permanently
- 📑 **Clone** — read one tag, write its contents to another
- ℹ️ **Tag info** — serial number & technical details
- Text ⇄ Bytes converter (UTF-8 size + hex preview)

### Extras
- 🕑 **Activity history** of every read/write/lock (stored locally)
- 🌙 Light / dark theme
- 📲 **Installable PWA** with offline support
- Fully responsive, optimized for phones

## 🚀 Usage

Web NFC requires **Chrome (or a Chromium browser) on Android**, served over **HTTPS**
(`localhost` is also allowed for development).

```bash
# serve locally
python3 -m http.server 8000
# then open http://localhost:8000 on desktop to explore the UI,
# or deploy over HTTPS and open on an Android phone to actually read/write tags.
```

Deploy the folder to any static host (GitHub Pages, Netlify, Vercel, …) — there is
no build step.

## 🧩 Project structure

```
index.html        # markup & layout
css/styles.css    # all styling + theming
js/records.js     # record type definitions + NDEF encoding (incl. Wi-Fi WSC)
js/nfc.js         # Web NFC wrapper (scan / write / makeReadOnly / decode)
js/app.js         # UI state, events, history, import/export
manifest.json     # PWA manifest
sw.js             # offline service worker
```

## ⚠️ Notes & limitations
- Web NFC is currently **Android Chrome only**. On unsupported browsers the app
  still runs and lets you build/preview payloads, but writing is disabled with a clear notice.
- **Locking a tag is irreversible.** The app asks for confirmation first.
- Tag capacity values are reference figures for popular NTAG/Mifare chips.

## 📄 License
MIT
