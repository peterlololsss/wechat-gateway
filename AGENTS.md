# WECHAT-GATEWAY — PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-12  
**Stack:** Node.js ESM (`"type": "module"`), no TypeScript, no bundler  
**Runtime:** Windows only — hooks into desktop WeChat PC client via `wechatferry` npm package

---

## OVERVIEW

Windows-local HTTP bridge that connects to the WeChat desktop client through `WechatferryAgent` and exposes a stable HTTP/JSON API + webhook push contract for downstream consumers (e.g. the OpenClaw plugin). Acts as a translation layer: left side is the WeChat hook implementation (replaceable), right side is the stable API contract.

**⚠️ `openclaw-wentchat/` is a SEPARATE plugin project installed in OpenClaw — it is NOT part of this server. Do not modify or treat it as part of the bridge.**

---

## STRUCTURE

```
wechat-gateway/
├── src/server.mjs          # Entry point: wires all modules, starts HTTP + bridge
├── src/bridge/             # WechatFerry adapter (replaceable implementation detail)
├── src/http/               # HTTP request routing, response helpers, webhook push
├── src/messages/           # WeChat message parsing + stable webhook payload contract
├── src/media/              # Media download, decrypt, OCR, MP article resolution
├── src/runtime/            # InboundMessageStore (dedup cache) + GroupContextStore (group context) + OutboundSendQueue
├── src/config/             # Config schema, defaults, parsing helpers
├── src/logger.mjs          # Structured key=value logger (no external deps)
├── src/validators.mjs      # Input validation helpers
├── config.json             # User overrides (not committed with secrets)
├── API.md                  # Stable external API contract (source of truth for consumers)
├── docs/wechatferry-integration.md  # Integration notes and WechatFerry internals
└── openclaw-wentchat/      # SEPARATE PROJECT — not part of this bridge
```

---

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add/change HTTP endpoint | `src/http/request-handler.mjs` — routes Map |
| Change webhook payload shape | `src/messages/contract.mjs` — `buildWebhookPayload` |
| Parse new message type | `src/messages/wechat-message-parser.mjs` |
| Add WechatFerry capability | `src/bridge/wechatferry-adapter.mjs` — `WechatFerryBridge` class |
| Config field add/change | `src/config/schema.mjs` — `DEFAULT_STARTUP_CONFIG` + `normalizeStartupConfig` |
| Runtime state (webhookUrl) | `src/config/store.mjs` + `src/config/schema.mjs` — `DEFAULT_RUNTIME_STATE` + `normalizeRuntimeState` |
| Media download/decrypt | `src/media/media-downloads.mjs` + bridge adapter methods |
| Outbound send throttling | `src/runtime/outbound-send-queue.mjs` |
| Inbound dedup + media cache | `src/runtime/inbound-message-store.mjs` |
| Group chat context buffer | `src/runtime/group-context-store.mjs` |
| Stable API contract docs | `API.md` |

---

## ARCHITECTURE

```
WeChat PC ←→ WechatferryAgent ←→ WechatFerryBridge (EventEmitter)
                                          │
                              ┌───────────┴───────────┐
                        inbound message           HTTP request
                              │                        │
                    InboundMessageStore         request-handler.mjs
                    (dedup + raw cache)         (routes Map, ~20 routes)
                              │                        │
                    GroupContextStore          OutboundSendQueue
                    (per-room rolling buf)     (throttle+jitter)
                              │
                    buildWebhookPayload + context_messages
                    (contract.mjs)
                              │
                    postWebhook → VPS
```

**Key flow — inbound:**
1. `WechatferryAgent` emits `message` (raw `WxMsg`)
2. `handleMessage` calls `buildWebhookPayload` → normalizes to stable contract
3. `InboundMessageStore.remember()` deduplicates; stores raw+payload for media ops
4. If message is from a group (`room_wxid` non-empty) and `groupContextEnabled` is true → `GroupContextStore.push()` adds the message to the per-room rolling buffer
5. If `runtimeState.webhookUrl` set → attach `context_messages` snapshot from `GroupContextStore`, then `postWebhook()` (async, fire-and-forget with retry)

**Key flow — outbound (send):**
- All send operations go through `OutboundSendQueue.schedule()` for throttle+jitter
- Default: 800ms throttle + 0–400ms jitter between sends

---

## CONVENTIONS

- **ESM only** — all files use `.mjs` extension, `import/export` syntax
- **No TypeScript** — plain JavaScript, no `tsc`, no type annotations
- **No framework** — raw `node:http`, no Express/Fastify
- **Logger format:** `createLogger('scope')` → structured `key=value` lines to stdout/stderr
- **Error responses:** always `{ detail: "message" }` JSON, never throw to client
- **Config split:**
  - `startup` config: loaded once at boot, never mutated at runtime
  - `runtime` state (`webhookUrl`): mutable, persisted to `config.json` via `saveRuntimeState`
- **Full `startup` config fields** (all overridable in `config.json`):

  | Field | Default | Description |
  |-------|---------|-------------|
  | `host` | `"0.0.0.0"` | HTTP listen address |
  | `port` | `8000` | HTTP listen port |
  | `webhookSecret` | `""` | Sent as `x-ntchat-secret` on webhook pushes |
  | `channelName` | `"wechatferry"` | `channel` field in webhook payloads |
  | `logLevel` | `"info"` | `debug`/`info`/`warn`/`error` |
  | `debugRawInbound` | `false` | Log raw WxMsg fields on every inbound message |
  | `webhookTimeoutMs` | `30000` | Per-attempt HTTP timeout for webhook push |
  | `webhookRetryCount` | `2` | Max retry attempts after webhook failure |
  | `webhookRetryBackoffMs` | `1000` | Base backoff delay (ms) between retries |
  | `webhookRetryBackoffMultiplier` | `2` | Exponential multiplier per retry |
  | `keepalive` | `true` | Passed to `WechatferryAgent`; required for long-running service |
  | `outboundSendThrottleMs` | `800` | Minimum gap between outbound sends |
  | `outboundSendJitterMs` | `400` | Max random jitter added on top of throttle |
  | `autoLaunchWeChat` | `true` | Auto-start WeChat.exe on boot |
  | `wechatExecutablePath` | `""` | Override WeChat.exe path (auto-detected if empty) |
  | `wechatLaunchTimeoutMs` | `10000` | Max wait for WeChat to start |
  | `supportedWeChatVersionPrefix` | `""` | Warn if detected version doesn't start with this (empty = no check) |
  | `mediaDownloadDir` | `"downloads"` | Root dir for `POST /download_media` saves |
  | `enableRoomMemberManagement` | `false` | Enable `/rooms/*` admin endpoints |
  | `adminApiToken` | `""` | Required when `enableRoomMemberManagement` is true |
  | `groupContextEnabled` | `true` | Attach `context_messages` to group webhook pushes |
  | `groupContextTtlHours` | `48` | How far back (hours) to include in `context_messages` |
  | `groupContextMaxMessages` | `200` | Max messages retained per room in rolling buffer |
- **`wrapStatus(status, successStatus)`** — bridge methods return `{ ok, status }`, normalize WechatFerry's inconsistent return conventions (0=ok for sends, 1=ok for room ops)
- **Field normalization:** raw WechatFerry names (`userName`, `nickName`) must never leak into API responses — always normalize via `contract.mjs`
- **Self-message filtering:** `raw.is_self === true` check in `server.mjs` prevents bot echo loops

---

## ANTI-PATTERNS (THIS PROJECT)

- **Never expose raw WechatFerry field names** (`userName`, `nickName`, `msgSvrId`, etc.) in HTTP responses or webhook payloads — normalize through `contract.mjs`
- **Never hardcode `msg_type` numeric values** in plugin-side code — treat as opaque passthrough field (values differ across WeChat versions/backends)
- **Never hardcode `channel` field value** — it may change if backend swaps
- **`message_id` is NOT a long-term archive key** — `InboundMessageStore` only holds recent messages (30min window, max 1000). `POST /download_media` will 404 for old messages
- **No QR-login API** — `refreshQrcode()` is deprecated and unsupported in WechatFerry
- **Do not modify `openclaw-wentchat/`** — it is a separate plugin, not this server
- **No speech-to-text** — only MP3 extraction exists; transcription has no concrete use case yet

---

## UNIQUE STYLES

- All HTTP routes in a single `Map` in `createBridgeRequestHandler` — no router library
- `dispatchOutbound(operation, task, fields)` wraps all send operations through `OutboundSendQueue`
- `requireJson`, `requireLogin`, `requireAdminApi` — guard helpers called at top of each POST handler
- `GET /history` accepts `peer_wxid` as alias for `chat_wxid` (backward compat)
- `response_mode: "binary"` on download endpoints streams file bytes directly instead of JSON path
- Logger uses `key=value` pairs as second arg: `logger.info('event', { field: value })`
- `config.json` supports partial overrides — only fields present override defaults

---

## COMMANDS

```bash
# Run bridge
node src/server.mjs

# Run tests
node --test --experimental-test-isolation=none
```

---

## NOTES

- **Windows only** — `wechatferry` bundles a Windows-specific SDK; do not attempt Linux/Mac
- **WeChat version pinned** — supported version `3.9.12.17`; upgrading WeChat independently can break the hook
- **WechatFerry status** — upstream `lich0821/WeChatFerry` is maintenance-stopped; Node wrapper `wechatferry@0.0.26` is active but treat as version-locked
- **`keepalive: true`** is required for long-running service — WCF logout signaling is weak
- **Admin API** for room management (invite/add/remove) is disabled by default; requires `enableRoomMemberManagement: true` + `adminApiToken` + `x-bridge-admin-token` header
- **Webhook retry** — 2 retries with exponential backoff (1s base, 2x multiplier); failures only logged, not fatal
- **`debugRawInbound: true`** config flag enables verbose raw WxMsg logging for debugging
