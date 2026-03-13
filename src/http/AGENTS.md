# src/http/ — HTTP LAYER

**All HTTP concerns live here.** Routes, guards, response helpers, webhook push.

---

## FILES

| File | Role |
|------|------|
| `request-handler.mjs` | Single `routes` Map (23 entries), `createBridgeRequestHandler` factory |
| `http-utils.mjs` | `writeJson`, `readJsonBody`, `getPathname`, `getRequestUrl`, `isJsonRequest` |
| `file-response.mjs` | `streamLocalFileResponse` — binary file streaming for `response_mode: "binary"` |
| `webhook.mjs` | `postWebhook` — async HTTP POST to VPS with retry + backoff |

---

## ROUTE PATTERN

All routes are `"METHOD /path"` keys in a single `Map`. No router library.

```js
const routes = new Map([
  ['GET /', async (_req, res) => { ... }],
  ['POST /send_text', async (req, res) => { ... }],
  // ...
])
```

To **add a route**: add entry to the Map. To **remove**: delete entry.

## COMPLETE ROUTE INVENTORY (23 routes)

| Route | Auth guards | Notes |
|-------|-------------|-------|
| `GET /` | — | Health check; returns `{status,login,wxid}` |
| `GET /login_info` | — | 503 if not logged in |
| `GET /contacts` | — | Returns `{contacts:[...]}` |
| `GET /contact_tags` | — | Returns `{tags:[...]}` |
| `GET /rooms` | — | Returns `{rooms:[...]}` |
| `GET /room_members` | — | Query param `room_wxid` required |
| `GET /history` | — | Query params: `chat_wxid`/`peer_wxid`, `limit`, `before_create_time`, `db_number` |
| `POST /send_text` | JSON, login | Body: `{to_wxid, content, at_list?}` |
| `POST /send_rich_text` | JSON, login | Body: `{to_wxid, title, url, digest?, thumb_url?, name?, account?}`; `title`+`url` required |
| `POST /send_image` | JSON, login | Body: `{to_wxid, image_path}` |
| `POST /send_file` | JSON, login | Body: `{to_wxid, file_path}` |
| `POST /send_media_upload` | JSON, login | Body: `{to_wxid, media_kind, file_name?, content_base64}`; remote plugin upload path for images/files |
| `POST /forward_message` | JSON, login | Body: `{to_wxid, message_id}` |
| `POST /revoke_message` | JSON, login | Body: `{message_id}` |
| `POST /download_media` | JSON, login | Body: `{message_id, timeout_seconds?, response_mode?}` |
| `POST /decrypt_image` | JSON, login | Body: `{message_id, timeout_seconds?, response_mode?}` |
| `POST /download_audio` | JSON, login | Body: `{message_id, timeout_seconds?, response_mode?}` |
| `POST /ocr_image` | JSON, login | Body: `{message_id}`; returns `{ocr:{text,lines,...}}` |
| `POST /resolve_mp_article` | JSON, login | Body: `{message_id?, url?}`; needs one of the two |
| `POST /rooms/invite_members` | JSON, admin | Body: `{room_wxid, member_wxids[]}`; requires `enableRoomMemberManagement` |
| `POST /rooms/add_members` | JSON, admin | Body: `{room_wxid, member_wxids[]}`; requires `enableRoomMemberManagement` |
| `POST /rooms/remove_members` | JSON, admin | Body: `{room_wxid, member_wxids[]}`; requires `enableRoomMemberManagement` |
| `POST /set_webhook` | JSON | Body: `{target_url}`; persists to `config.json` |

---

## GUARD HELPERS (call at top of each POST handler)

| Helper | Rejects with |
|--------|-------------|
| `requireJson(req, res)` | 415 if Content-Type ≠ application/json |
| `requireLogin(bridge, res)` | 503 if `bridge.isLogin()` is false |
| `requireAdminApi(req, config, res)` | 404 (disabled), 503 (no token), 403 (wrong token) |

Pattern: `if (!requireJson(req, res)) return;` — returns false and writes response on failure.

---

## OUTBOUND DISPATCH

All send operations go through `dispatchOutbound(operation, task, fields)`:

```js
const result = await dispatchOutbound('send_text', () => bridge.sendText(...), { to_wxid });
if (!result.ok) { writeJson(res, 500, ...); return; }
```

Never call `bridge.send*` directly from a handler — always via `dispatchOutbound`.

---

## RESPONSE MODES (download endpoints)

`response_mode: "binary"` in request body → `streamLocalFileResponse` streams file bytes.  
Default (omitted/json) → `writeJson` returns `{ status, message, download/image/audio }`.

---

## WEBHOOK PUSH

`postWebhook(targetUrl, payload, secret, options)` — fire-and-forget, async, with retry.  
Called in `server.mjs`, not in this module. Retry config: 2 retries, 1s base, 2x multiplier.

---

## ERROR HANDLING

- Unknown route → 404
- Invalid JSON body → 400
- Request body too large → 413
- Unhandled throws → 500
- All errors: `{ detail: "message" }` shape always
