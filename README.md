# WechatFerry Node Bridge

Runs on Windows, connects to the local desktop WeChat client through `wechatferry`, and exposes the HTTP contract described in [API.md](./API.md).

## Run

Install dependencies first:

```bash
pnpm install
```

Then start the bridge:

```bash
node src/server.mjs
```

Run tests:

```bash
node --test --experimental-test-isolation=none
```

`POST /resolve_mp_article` uses `playwright-core` and launches the local Edge browser channel by default. On a standard Windows install, no separate Playwright browser download is required.

Outbound and room-management endpoints accept native WeChat IDs (`wxid_...`, `...@chatroom`) and compatibility-prefixed IDs like `ntchat:wxid_...`; the bridge normalizes them before calling WechatFerry.

## Config

Edit `config.json`. Only include fields you want to override — all others fall back to defaults defined in `src/config/schema.mjs`.

```json
{
  "startup": {
    "webhookSecret": "your-secret",
    "logLevel": "info"
  },
  "runtime": {
    "webhookUrl": "https://your-server.example.com/webhook/ntchat"
  }
}
```

**startup defaults** (see `src/config/schema.mjs` for the full list):

| Field | Default | Description |
|-------|---------|-------------|
| `host` | `"0.0.0.0"` | HTTP listen address |
| `port` | `8000` | HTTP listen port |
| `webhookSecret` | `""` | Sent as `x-ntchat-secret` header on webhook pushes |
| `channelName` | `"wechatferry"` | Channel identifier included in webhook payloads |
| `logLevel` | `"info"` | `debug` / `info` / `warn` / `error` |
| `debugRawInbound` | `false` | Log raw inbound message fields (temporary debugging) |
| `autoLaunchWeChat` | `true` | Auto-start desktop WeChat on startup |
| `wechatExecutablePath` | `""` | Override WeChat.exe path (auto-detected if empty) |
| `mediaDownloadDir` | `"downloads"` | Where `POST /download_media` saves files |
| `enableRoomMemberManagement` | `false` | Enable room invite/add/remove endpoints |
| `adminApiToken` | `""` | Required when room management is enabled |

**runtime** fields:

| Field | Default | Description |
|-------|---------|-------------|
| `webhookUrl` | `""` | Inbound messages are pushed here. Empty = disabled |

`POST /set_webhook` updates `runtime.webhookUrl` and writes it back to `config.json`.
