# src/ — BRIDGE MODULES

**All server-side code lives here.** Entry point is `server.mjs`; everything else is a module.

---

## STRUCTURE

```
src/
├── server.mjs              # Bootstrap, event wiring, graceful shutdown
├── logger.mjs              # Module-global structured logger (no deps)
├── validators.mjs          # Pure input validation helpers
├── bridge/                 # WechatFerry adapter (EventEmitter wrapper)
├── config/                 # Schema, defaults, parse, load/save helpers
├── http/                   # Route map, guards, response helpers, webhook push
├── media/                  # Download/decrypt/OCR/MP article operations
├── messages/               # Message normalization + stable contract
└── runtime/                # Stateful runtime: dedup store + send queue
```

---

## WHERE TO LOOK

| Task | File |
|------|------|
| Boot sequence / event wiring | `server.mjs` |
| All HTTP routes | `http/request-handler.mjs` |
| Self-message filter (anti-loop) | `server.mjs` — `raw.is_self` check |
| Inbound dedup + cache | `runtime/inbound-message-store.mjs` |
| Outbound throttle+jitter | `runtime/outbound-send-queue.mjs` |
| Config schema + defaults | `config/schema.mjs` |
| Config load/save from disk | `config/store.mjs` |
| Logger | `logger.mjs` — `createLogger(scope)` |
| Validation helpers | `validators.mjs` |

---

## MODULE DEPENDENCY GRAPH

```
server.mjs
  ├── bridge/wechatferry-adapter.mjs  (WechatFerryBridge)
  ├── http/request-handler.mjs        (createBridgeRequestHandler)
  ├── http/webhook.mjs                (postWebhook)
  ├── runtime/inbound-message-store.mjs
  ├── runtime/outbound-send-queue.mjs
  └── config/store.mjs
```

Bridge adapter depends on `messages/contract.mjs` and `media/` — no other cross-layer deps.

---

## CONVENTIONS (THIS LAYER)

- `server.mjs` is the only file that wires modules together — no circular imports
- `runtimeState` object is passed by reference; mutations in handler persist in-process
- All modules export named functions/classes — no default exports
- Two-phase config: `loadConfig()` (startup, immutable) + `loadRuntimeState()` (mutable, disk-persisted)
