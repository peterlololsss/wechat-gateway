# src/bridge/ — WECHATFERRY ADAPTER

**Replaceable implementation detail.** Wraps `WechatferryAgent` as an `EventEmitter`. If the WeChat hook backend changes, only this module changes — the HTTP contract is unaffected.

---

## KEY FILE

`wechatferry-adapter.mjs` — `WechatFerryBridge` class (only public API in this dir)

`wechat-launcher.mjs` — auto-launch WeChat.exe before bridge start

---

## WechatFerryBridge API

| Method | Returns | Notes |
|--------|---------|-------|
| `start()` / `stop()` | void | Idempotent via `this.started` guard |
| `isLogin()` | boolean | Wraps `agent.wcf.isLogin()`, never throws |
| `getLoginInfo()` | selfInfo object | Cached; lazy-fetches via `wcf.getUserInfo()` on first call after login |
| `getHealth()` | `{status,login,wxid}` | For `GET /` |
| `getContacts()` | contact array | `agent.getContactList()` normalized via `normalizeContact` |
| `getContactTags()` | `{id,name}[]` | `agent.getContactTagList()` — `labelId`/`labelName` → `id`/`name` |
| `getRooms()` | room array | `agent.getChatRoomList()` normalized via `normalizeRoom` |
| `getRoomMembers(roomWxid)` | member array | Returns `[]` if result is not an array |
| `sendText(toWxid, content, atList)` | `{ok,status}` | Via `wrapStatus(..., 0)` |
| `sendRichText(toWxid, payload)` | `{ok,status}` | Via `wrapStatus(..., 0)`; payload: `{title,url,digest,thumburl,name,account}` |
| `sendImage(toWxid, imagePath)` | `{ok,status}` | Async; adapts local path via `createLocalFileBox` |
| `sendFile(toWxid, filePath)` | `{ok,status}` | Async; adapts local path via `createLocalFileBox` |
| `inviteRoomMembers/addRoomMembers/removeRoomMembers` | `{ok,status}` | Via `wrapStatus(..., 1)` |
| `forwardMessage(toWxid, messageId)` | `{ok,status}` | Via `wrapStatus(..., 1)`; `messageId` coerced to string |
| `revokeMessage(messageId)` | `{ok,status}` | Via `wrapStatus(..., 1)`; `messageId` coerced to string |
| `getHistory(chatWxid, options)` | history array | `options`: `{limit,beforeCreateTime,dbNumber}`; sorted desc by createTime; max 200 |
| `downloadMedia(rawMessage, options)` | `{message_id,media,...saved}` | Async; requires raw from `InboundMessageStore` |
| `decryptImage(rawMessage, options)` | `{message_id,media,...saved}` | Async; polls `wcf.decryptImage` up to `timeoutSeconds` |
| `extractAudio(rawMessage, options)` | `{message_id,media,format,...saved}` | Async; polls `wcf.getAudioMsg`; `format` is always `"mp3"` |
| `ocrImage(rawMessage)` | `{message_id,media,extra_path,result}` | Sync; `result` is raw from `wcf.execOCR` — normalize via `normalizeOcrResult` |
| `resolveMpArticle(url, options)` | article object | Async; delegates to `mp-article-resolver.mjs` (requires Playwright) |

---

## CRITICAL CONVENTIONS

- **`wrapStatus(status, successStatus)`** — sends use `successStatus=0`, room ops use `successStatus=1`. Never compare status integers directly outside this helper.
- **Never call `agent.wcf.*` directly in HTTP handlers** — always go through `WechatFerryBridge` methods
- **`keepalive: true`** must be passed to `WechatferryAgent` — WCF logout signaling is unreliable
- `selfInfoRaw` is cached and cleared on logout; `getLoginInfo()` lazy-fetches on first use after login

---

## NOTES

- WechatFerry status codes are inconsistent: 0=ok for send ops, 1=ok for room/admin ops
- `createLocalFileBox` adapts a local file path to the FileBox interface expected by `sendImage`/`sendFile`
- `resolveMpArticle` calls Playwright — may throw `'Playwright is not installed'` (503 upstream)
