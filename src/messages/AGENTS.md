# src/messages/ — MESSAGE CONTRACT + PARSING

**The boundary between WeChat internals and the stable API contract.** Two files with distinct responsibilities.

---

## FILES

| File | Role |
|------|------|
| `contract.mjs` | Normalizes all outward-facing shapes: webhook payload, contacts, rooms, history |
| `wechat-message-parser.mjs` | XML parsing, content normalization, media classification, app payload handling |

---

## contract.mjs — Stable API boundary

**Single source of truth for field names in HTTP responses and webhook payloads.**

| Export | Purpose |
|--------|---------|
| `buildWebhookPayload(message, selfInfo, channelName)` | Builds the full webhook push object |
| `normalizeContact(contact)` | `userName → wxid`, `nickName → nickname`, etc. |
| `normalizeRoom(room)` | Same normalization for chat rooms |
| `normalizeRoomMember(member)` | Member with display_name, remark |
| `normalizeHistoryMessage(message)` | History record normalized for `GET /history` |
| `normalizeSelfInfo(userInfo)` | Bot identity from raw WechatFerry login info |

**Any time a WechatFerry raw field (`userName`, `nickName`, `msgSvrId`, etc.) must appear in the API response, it MUST pass through a normalize function here — never inline.**

---

## wechat-message-parser.mjs — XML/content parsing

| Export | Purpose |
|--------|---------|
| `normalizeWechatMessage(message, {selfWxid})` | Main entry: content + linkMeta + atUserList + media + quotedMessage |
| `normalizeMediaDescriptor(message)` | `{kind, thumb_path, extra_path}` or null |
| `classifyWechatMediaKind(type)` | type int → `"image"/"voice"/"video"/"file"/""` |

**Key parsing flows:**
- Text messages: sanitize, reject XML-looking content
- App messages (`type=49`): parse `<appmsg>` XML → link/mp-article/miniprogram/referMsg
- Quoted replies (App subtype ReferMsg): extract `<refermsg>` → `quotedMessage` field
- System/Sys messages: extract from `<template>` or `<replacemsg>` XML
- `at_user_list`: parse `<atuserlist>` from `<msgsource>` XML

---

## ANTI-PATTERNS

- **Never add raw WechatFerry field names to any normalize* function output** — always use the contract field names (`wxid`, `nickname`, `msgid`, etc.)
- **Never hardcode `WechatMessageType` numeric values** — use the enum constants imported from `wechatferry`
- **Add new parser tests when a new XML payload shape is observed in production** — per TODO.md
