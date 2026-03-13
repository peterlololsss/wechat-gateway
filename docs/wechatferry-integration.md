# WechatFerry Integration Notes

This repo currently has a minimal `ntchat` proof of concept in [main.py](/D:/PycharmProjects/wechat-gateway/main.py) and a stable OpenClaw-facing contract in [bridge-node/API.md](/D:/PycharmProjects/wechat-gateway/bridge-node/API.md). The installed replacement library is `wechatferry@0.0.26`, which is a Node/TypeScript package, not a drop-in Python replacement.

The practical implication is simple:

- Keep the OpenClaw-facing HTTP/webhook contract stable.
- Replace the backend adapter from `ntchat` with `wechatferry`.
- Prefer building the new bridge in Node/TypeScript instead of extending the current Python script.

## What is installed

The top-level `wechatferry` package is mostly a re-export wrapper around these packages:

- `@wechatferry/core`: low-level WCF RPC client over the bundled SDK
- `@wechatferry/agent`: the usable high-level API for most bot work
- `@wechatferry/puppet`: Wechaty adapter
- `@wechatferry/plugins`
- `@wechatferry/logger`

For this project, `@wechatferry/agent` is the correct integration layer. `core` is useful only when we need raw WCF calls that the agent does not wrap.

## Environment constraints

- Windows only. The upstream guide explicitly targets 64-bit Windows.
- The current docs say the supported WeChat desktop version is `3.9.12.17`.
- The installed `@wechatferry/core` package bundles `sdk/v39.4.5`.
- This stack is version-pinned. Upgrading WeChat independently can break the hook.
- The underlying Node API does not open WeChat for you, so the bridge should own that behavior if you want parity with the old script.
- `refreshQrcode()` exists in the type surface but is marked deprecated and "Not supported", so QR-login style HTTP endpoints should not be part of the plan.

## Important project reality

There are two different things named "WechatFerry":

- The Node wrapper repo `wechatferry/wechatferry` is active enough to publish `0.0.26`.
- The original underlying WCF project `lich0821/WeChatFerry` currently states that it has stopped maintenance.

So this is still a better Node integration surface than `ntchat`, but it is not maintenance-free. Treat it as a version-locked Windows automation dependency.

## Recommended layer to use

Use `WechatferryAgent`, not raw `Wechatferry`, for the bridge.

Why:

- It emits `login`, `logout`, `message`, and `error` events.
- It wraps message sending as `sendText`, `sendImage`, `sendFile`, `forwardMsg`, `revokeMsg`.
- It exposes higher-level contact, room, member, and history APIs.
- It adds a `keepalive` mode because raw WCF logout signaling is weak.

Minimal startup shape:

```ts
import { WechatferryAgent } from 'wechatferry/agent'

const agent = new WechatferryAgent({ keepalive: true })
let selfInfo: { wxid?: string; name?: string; mobile?: string; home?: string } | null = null

agent.on('login', (info) => {
  selfInfo = info
})

agent.on('message', (msg) => {
  console.log(msg)
})

agent.on('logout', () => {
  selfInfo = null
})

agent.start()
```

## Capability summary

### Core/agent capabilities that matter for this bridge

- Login state: `isLogin()`
- Self identity: `getUserInfo()`
- Receive inbound messages: `message` event
- Send text: `sendText()` / `sendTxt()`
- Send image/file: `sendImage()`, `sendFile()`
- Send richer payloads: `sendXml()`, `sendRichText()`, `sendPatMsg()`
- Forward/revoke: `forwardMsg()`, `revokeMsg()`
- Contacts and rooms: `getContactList()`, `getChatRoomList()`, `getChatRoomMembers()`
- Message/media helpers: `downloadFile()`, `getAudioMsg()`, `downloadAttach()`, `decryptImage()`, `execOCR()`
- Friend/group operations: `acceptFriend()`, `addRoomMembers()`, `delRoomMembers()`, `inviteRoomMembers()`
- Database/history access: `getDbList()`, `dbSqlQuery()`, `getHistoryMessageList()`

### Message object we receive

Inbound `message` events are `WxMsg` objects with these important fields:

- `id`: message id
- `type`: numeric WeChat message type
- `ts`: unix timestamp
- `sender`: sender wxid
- `roomid`: empty for DM, `...@chatroom` for groups
- `content`: main message text/body
- `xml`: raw xml payload for app/link/quote/system messages
- `thumb`: media thumb path/identifier
- `extra`: extra media path/identifier
- `is_self`: whether the message is sent by the bot account
- `is_group`: whether the message came from a room

That is already enough to reconstruct the current webhook payload shape.

## Mapping to the existing bridge contract

The right design is to preserve [bridge-node/API.md](/D:/PycharmProjects/wechat-gateway/bridge-node/API.md) and only swap the backend implementation.

### HTTP endpoints

Current stable contract -> WechatFerry implementation:

- `GET /`
  - use `agent.wcf.isLogin()`
  - if logged in, read cached `selfInfo` or call `agent.wcf.getUserInfo()`
- `GET /login_info`
  - use `agent.wcf.getUserInfo()`
  - normalize field names before returning
- `GET /contacts`
  - use `agent.getContactList()`
  - normalize `userName -> wxid`, `nickName -> nickname`
- `GET /contact_tags`
  - use `agent.getContactTagList()`
  - normalize `labelId -> id`, `labelName -> name`
- `GET /rooms`
  - use `agent.getChatRoomList()`
  - normalize `userName -> wxid`, `nickName -> nickname`
- `POST /send_text`
  - use `agent.sendText(to_wxid, content, at_list ?? [])`

### Required normalization

Do not leak raw WechatFerry field names directly into the OpenClaw contract.

Suggested normalization:

- self:
  - `wxid = userInfo.wxid`
  - `nickname = userInfo.name`
  - `account = userInfo.home ?? userInfo.mobile ?? ""`
- contact:
  - `wxid = contact.userName`
  - `nickname = contact.nickName`
- room:
  - `wxid = room.userName`
  - `nickname = room.nickName`

This matters because the current contract assumes `wxid`/`nickname`, while WechatFerry mostly exposes `userName`/`nickName`.

### Webhook payload reconstruction

Existing payload fields can be rebuilt as:

- `channel`: set to `"wechatferry"` and keep the plugin tolerant
- `msg_type`: `msg.type`
- `self_info.wxid`: cached login `wxid`
- `self_info.nickname`: cached login `name`
- `data.from_wxid`: `msg.sender`
- `data.to_wxid`: self wxid
- `data.room_wxid`: `msg.roomid ?? ""`
- `data.content`: normalized content from `msg.content` or parsed `msg.xml`
- `data.at_user_list`: parse `msgsource.atuserlist` from XML when available
- `data.msgid`: `msg.id`
- `data.timestamp`: `msg.ts`

Anti-loop check should use `msg.is_self === true` first, and fall back to `msg.sender === selfInfo.wxid`.

## Message handling recommendations

Start with a narrow first version:

- Text DM and group text
- Group `@` sending through `sendText(..., mentionList)`
- Contacts list
- Rooms list
- Stable webhook forwarding

Then add richer parsing:

- quoted reply parsing from `msg.xml`
- link/article metadata extraction from `msg.xml`
- image/file/voice placeholders plus normalized media metadata
- keep binary media download scoped to recent inbound messages that the bridge has actually seen

Do not make `msg.type` part of a stable external contract. Different WeChat backends and versions can shift numeric values.

## Known gaps vs the old ntchat script

- No built-in "open WeChat and wait login" flow like the current Python demo.
- No supported QR-code API for remote login.
- Login/logout handling is event plus polling based; use `keepalive: true` for long-running service behavior.
- Send methods do not all share the same success convention:
  - several send APIs return `0` for success
  - some room/admin operations return `1` for success
  - normalize these to booleans inside the bridge

## Endpoints worth adding later

The bridge now exposes image/file send, room member lookup, forward, revoke, and history query.

Remaining realistic next endpoints:

- any OCR/decrypt endpoint only if a real downstream use case appears

WechatFerry already has enough surface for this.

## Recommended implementation direction

Build a Windows-local Node service with this shape:

1. `adapter/wechatferry.ts`
   - owns `WechatferryAgent`
   - caches self info
   - normalizes contacts/rooms/messages
2. `server/http.ts`
   - exposes the stable HTTP contract from [bridge-node/API.md](/D:/PycharmProjects/wechat-gateway/bridge-node/API.md)
3. `server/webhook.ts`
   - translates `WxMsg` into the stable outbound webhook payload
4. `types/contract.ts`
   - defines the OpenClaw-facing JSON contract so backend swaps stay cheap

That keeps the OpenClaw side insulated from another backend migration later.

## Sources used

Local package/source:

- [package.json](/D:/PycharmProjects/wechat-gateway/package.json)
- [main.py](/D:/PycharmProjects/wechat-gateway/main.py)
- [bridge-node/API.md](/D:/PycharmProjects/wechat-gateway/bridge-node/API.md)
- [node_modules/wechatferry/package.json](/D:/PycharmProjects/wechat-gateway/node_modules/wechatferry/package.json)
- [node_modules/.pnpm/@wechatferry+core@0.0.26/node_modules/@wechatferry/core/dist/index.d.ts](/D:/PycharmProjects/wechat-gateway/node_modules/.pnpm/@wechatferry+core@0.0.26/node_modules/@wechatferry/core/dist/index.d.ts)
- [node_modules/.pnpm/@wechatferry+agent@0.0.26/node_modules/@wechatferry/agent/dist/index.d.ts](/D:/PycharmProjects/wechat-gateway/node_modules/.pnpm/@wechatferry+agent@0.0.26/node_modules/@wechatferry/agent/dist/index.d.ts)
- [node_modules/.pnpm/@wechatferry+agent@0.0.26/node_modules/@wechatferry/agent/dist/index.cjs](/D:/PycharmProjects/wechat-gateway/node_modules/.pnpm/@wechatferry+agent@0.0.26/node_modules/@wechatferry/agent/dist/index.cjs)

Upstream references:

- https://github.com/wechatferry/wechatferry
- https://github.com/wechatferry/wechatferry/releases/tag/v0.0.26
- https://wcferry.netlify.app/guide
- https://wcferry.netlify.app/integrations/node
- https://github.com/lich0821/WeChatFerry
