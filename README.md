# Wechat Gateway

Wechat Gateway is a Windows-only HTTP gateway for desktop WeChat. It connects to the logged-in WeChat PC client through WechatFerry and exposes a local HTTP API for bots, plugins, or services that need to send messages, receive inbound message webhooks, download media, inspect contacts/rooms, and manage selected room actions.

The companion OpenClaw plugin can point its `bridgeApiUrl` at this service, but the gateway itself is framework-neutral: any client that speaks the API in [API.md](./API.md) can use it.

## Requirements

- Windows with WeChat Desktop installed and logged in
- Node.js and pnpm
- `wechatferry@0.0.26` from this repo's lockfile
- A reachable webhook receiver if you want inbound messages pushed to another service

## WechatFerry

This project uses the Node.js WechatFerry packages to talk to the local WeChat client.

Upstream references:

- Official Node.js WechatFerry repo: https://github.com/wechatferry/wechatferry
- WechatFerry docs: https://wcferry.netlify.app/
- Original WeChatFerry project: https://github.com/lich0821/WeChatFerry

The pinned setup targets WechatFerry `v39.4.5` and WeChat Desktop `3.9.12.17`.

## Run

Install dependencies:

```bash
pnpm install
```

Start the gateway:

```bash
node src/server.mjs
```

Run tests:

```bash
npm test
```

By default the gateway listens on `0.0.0.0:8000`.

## Config

Create or edit `config.json`. Only include fields you want to override; all others fall back to defaults in `src/config/schema.mjs`.

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

`POST /set_webhook` updates `runtime.webhookUrl` and writes it back to `config.json`.

## Common Endpoints

See [API.md](./API.md) for the full contract. Common endpoints include:

- `GET /` health/status
- `POST /send_text`
- `POST /send_media_upload`
- `POST /revoke_message`
- `GET /contacts`
- `GET /rooms`
- `GET /room_members`
- `GET /history`
- `POST /download_media`
- `POST /resolve_mp_article`

Outbound and room-management endpoints accept native WeChat IDs such as `wxid_...` and `...@chatroom`. Compatibility-prefixed IDs such as `ntchat:wxid_...` are normalized before calling WechatFerry.

## Revoke Compatibility DLL

This repo includes a pinned native compatibility patch for message revoke support:

```text
skills/wechatferry-native-recovery/assets/ferry-revoke-fix.dll
```

Use it only with the matching WechatFerry / WeChat Desktop pairing. See [docs/native-compatibility-patch.md](./docs/native-compatibility-patch.md) and the native recovery skill at [skills/wechatferry-native-recovery/SKILL.md](./skills/wechatferry-native-recovery/SKILL.md).

## Security Notes

- Keep `config.json` private. It is ignored by git and may contain webhook URLs or tokens.
- Set `webhookSecret` when pushing inbound messages to another service.
- `adminApiToken` is required before enabling room-management endpoints.
- Avoid committing real IPs, Tailscale hostnames, wxids, tokens, or local machine paths.