# src/media/ — MEDIA OPERATIONS

**All media download, decryption, OCR, and MP article resolution live here.**

---

## FILES

| File | Role |
|------|------|
| `media-downloads.mjs` | File I/O: save FileBox or local file, ensure storage dirs, name generation |
| `mp-article-resolver.mjs` | Fetch WeChat MP article content via Playwright browser |
| `ocr-result.mjs` | Normalize raw OCR result from `wcf.execOCR` into `{text, lines}` |

---

## OPERATIONS (called via WechatFerryBridge)

| Bridge method | Implementation |
|---------------|----------------|
| `downloadMedia` | `agent.downloadFile()` → `saveDownloadedFileBox()` |
| `decryptImage` | `wcf.downloadAttach()` + polling `wcf.decryptImage()` → `saveGeneratedLocalFile()` |
| `extractAudio` | Polling `wcf.getAudioMsg()` → `saveGeneratedLocalFile()` |
| `ocrImage` | `wcf.execOCR(extraPath)` → `normalizeOcrResult()` |
| `resolveMpArticle` | `resolveMpArticleWithBrowser({url, timeoutMs})` |

---

## KEY CONSTRAINTS

- **`message_id` is short-lived** — `InboundMessageStore` holds messages for 30min/1000 entries max. All media ops require the raw message still in cache (404 if expired).
- **Storage dir** — `config.mediaDownloadDir` (default `"downloads"`); subdirs `images/` and `audio/` created on demand via `ensureMediaStorageDir`.
- **`decryptImage`/`extractAudio` poll 1s intervals** up to `timeoutSeconds` (default 30, max 120).
- **`resolveMpArticle` requires Playwright** — if not installed, throws `'Playwright is not installed'` → upstream maps to 503.
- **No transcription** — `extractAudio` produces MP3 only. Speech-to-text not implemented.
