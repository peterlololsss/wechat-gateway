# OpenClaw WeChat Bridge — API Reference

> **版本**: 1.0  
> **服务端口**: 8000  
> **传输协议**: HTTP/JSON  
> **最后更新**: 2026-03

---

## 目录

- [架构概览](#架构概览)
- [API 稳定性承诺](#api-稳定性承诺)
- [快速开始](#快速开始)
- [环境变量配置](#环境变量配置)
- [HTTP API 端点](#http-api-端点)
  - [GET / — 健康检查](#get----健康检查)
  - [GET /login_info — 获取登录身份](#get-login_info--获取登录身份)
  - [GET /contacts — 获取联系人列表](#get-contacts--获取联系人列表)
  - [GET /contact_tags — 获取联系人标签](#get-contact_tags--获取联系人标签)
  - [GET /rooms — 获取群聊列表](#get-rooms--获取群聊列表)
  - [GET /room_members — 获取群成员列表](#get-room_members--获取群成员列表)
  - [GET /history — 获取历史消息](#get-history--获取历史消息)
  - [POST /send_text — 发送文本消息](#post-send_text--发送文本消息)
  - [POST /send_image — 发送图片消息](#post-send_image--发送图片消息)
  - [POST /send_file — 发送文件消息](#post-send_file--发送文件消息)
  - [POST /send_media_upload — 上传并发送媒体](#post-send_media_upload--上传并发送媒体)
  - [POST /forward_message — 转发消息](#post-forward_message--转发消息)
  - [POST /revoke_message — 撤回消息](#post-revoke_message--撤回消息)
  - [POST /download_media — 下载媒体消息](#post-download_media--下载媒体消息)
- [Webhook 推送 (Bridge → VPS)](#webhook-推送-bridge--vps)
  - [推送载荷结构](#推送载荷结构)
  - [data 字段详细说明](#data-字段详细说明)
  - [link_meta 字段 (公众号文章元数据)](#link_meta-字段-公众号文章元数据)

  - [quoted_message 字段 (引用消息元数据)](#quoted_message-字段-引用消息元数据)
  - [支持的消息类型](#支持的消息类型)
  - [反回环保护](#反回环保护)
- [错误处理](#错误处理)

---

## 架构概览

```
                    实现细节（可替换）                          稳定 API 契约
              ┌──────────────────────┐           ┌──────────────────────────────┐
              │                      │           │                              │
  WeChat PC ←→ WeChat Hook 层       ←→  Python Bridge (0.0.0.0:8000)  ←→  VPS / 插件端
              │ (ntchat / WeChatFerry│           │                              │
              │  / 其他)             │           │  HTTP API + Webhook Push     │
              └──────────────────────┘           └──────────────────────────────┘
```

**消息流向**:

- **入站 (VPS → Bridge → WeChat)**: 插件端通过 HTTP API 调用 Bridge 发送消息
- **出站 (WeChat → Bridge → VPS)**: Bridge 监听微信消息事件，构建标准化载荷后 POST 推送至 VPS webhook

Bridge 是一个**翻译层** —— 左侧的微信连接方式是实现细节，可以在不影响右侧 API 的前提下替换。插件开发者应当仅依赖右侧的 HTTP API 和 Webhook 推送格式。

---

## API 稳定性承诺

以下内容构成**稳定契约**，在底层微信连接方式变更时保持不变:

1. **HTTP API 端点**的路径、请求方法、请求体结构和响应体结构
2. **Webhook 推送载荷**的 JSON 结构和字段语义
3. **错误响应**的 HTTP 状态码和错误格式

以下内容为**实现细节**，可能随时变更:

- 底层微信连接库 (ntchat / WeChatFerry / itchat 等)
- `msg_type` 的具体数值 (不同 Hook 库的常量不同)
- `channel` 字段的具体字符串值
- Bridge 内部的进程管理、日志格式、缓存策略

**插件开发建议**: 对 `msg_type` 和 `channel` 字段做宽松处理，不要硬编码特定值。将它们视为透传字段。

---

## 快速开始

### 启动 Bridge

```bash
pnpm bridge:start
```

或：

```bash
cd bridge-node
node src/app/server.mjs
```

Bridge 启动时会先尝试自动拉起桌面微信，再连接 / 附加到 WeChat 进程，并在 `0.0.0.0:8000` 启动 HTTP 服务。

### 验证服务状态

```bash
curl http://localhost:8000/
```

### 发送一条消息

```bash
curl -X POST http://localhost:8000/send_text \
  -H "Content-Type: application/json" \
  -d '{"to_wxid": "filehelper", "content": "Hello from API"}'
```

### 发送群聊 @消息

```bash
curl -X POST http://localhost:8000/send_text \
  -H "Content-Type: application/json" \
  -d '{
    "to_wxid": "12345678@chatroom",
    "content": "你好",
    "at_list": ["wxid_target_user"]
  }'
```

### 查询联系人 / 群聊

```bash
curl http://localhost:8000/contacts
curl http://localhost:8000/contact_tags
curl http://localhost:8000/rooms
```

---

## 环境变量配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `VPS_WEBHOOK_URL` | string | `https://ivnsvps.tail19ac05.ts.net/webhook/ntchat` | Webhook 推送目标地址 |
| `AUTO_FETCH_MP` | bool-like | `"1"` | 是否自动抓取公众号文章内容。接受 `1`, `true`, `yes`, `on` |
| `MP_FETCH_TIMEOUT` | int | `12` | 公众号文章 HTTP 抓取超时 (秒) |
| `MP_PREVIEW_CHARS` | int | `280` | 控制台日志中公众号文章预览的字符数 |
| `MP_SAVE_DIR` | string | `mp_snapshots` | 公众号文章全文保存目录 |

---

## HTTP API 端点

所有端点返回 JSON。Content-Type 为 `application/json`。

---

### GET / — 健康检查

用于检测 Bridge 是否存活以及微信是否已登录。

**请求**: 无参数

**响应**:

```json
{
  "status": "ok",
  "login": true,
  "wxid": "wxid_xxxxxxxxxxxx"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | 固定为 `"ok"` |
| `login` | boolean | 微信是否已登录 (`wxid` 非空则为 `true`) |
| `wxid` | string | 当前登录的微信 ID，未登录时为空字符串 |

**状态码**: 始终返回 `200`

---

### GET /login_info — 获取登录身份

返回当前 Bot 的完整身份信息。

**请求**: 无参数

**响应 (成功)**:

```json
{
  "wxid": "wxid_xxxxxxxxxxxx",
  "nickname": "机器人昵称",
  "account": "wechat_account",
  ...
}
```

返回值为底层库提供的完整登录信息对象，至少包含 `wxid` 和 `nickname` 字段。

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `503` | 尚未登录 (`{"detail": "Not logged in yet"}`) |
| `500` | 内部错误 (`{"detail": "错误信息"}`) |

---

### GET /contacts — 获取联系人列表

返回当前微信账号的完整联系人列表。

**请求**: 无参数

**响应**:

```json
{
  "contacts": [
    {
      "wxid": "wxid_xxxxxxxxxxxx",
      "nickname": "联系人昵称",
      ...
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `contacts` | array | 联系人对象数组，无联系人时为空数组 `[]` |

每个联系人对象的字段由底层库决定，至少包含 `wxid`。

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `500` | 内部错误 (`{"detail": "错误信息"}`) |

---

### GET /contact_tags — 获取联系人标签

返回当前微信账号的联系人标签列表。

**请求**: 无参数

**响应**:

```json
{
  "tags": [
    {
      "id": "1",
      "name": "朋友"
    }
  ]
}
```

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `500` | 内部错误 (`{"detail": "错误信息"}`) |

---

### GET /rooms — 获取群聊列表

返回当前微信账号加入的群聊列表。

**请求**: 无参数

**响应**:

```json
{
  "rooms": [
    {
      "wxid": "12345678@chatroom",
      "nickname": "群名称",
      ...
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `rooms` | array | 群聊对象数组，无群聊时为空数组 `[]` |

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `500` | 内部错误 (`{"detail": "错误信息"}`) |

---

### GET /room_members — 获取群成员列表

返回指定群聊的成员列表。

**请求参数**:

| 参数名 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `room_wxid` | string | 是 | 群聊 wxid，例如 `12345678@chatroom` |

**示例**:

```bash
curl "http://localhost:8000/room_members?room_wxid=12345678@chatroom"
```

**响应**:

```json
{
  "room_wxid": "12345678@chatroom",
  "members": [
    {
      "wxid": "wxid_member1",
      "nickname": "成员昵称",
      "display_name": "群昵称",
      "remark": "备注",
      "small_head_img_url": "https://..."
    }
  ]
}
```

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `422` | 缺少 `room_wxid` |
| `500` | 内部错误 (`{"detail": "错误信息"}`) |

---

### GET /history — 获取历史消息

返回指定会话的历史消息，按时间倒序排列。

**请求参数**:

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|------|------|
| `chat_wxid` | string | 是 | - | 会话 wxid，可为好友 wxid 或群 wxid |
| `limit` | integer | 否 | `50` | 返回条数，上限 `200` |
| `before_create_time` | integer | 否 | - | 仅返回早于该时间戳的消息 |
| `db_number` | integer | 否 | - | 指定 `MSG{n}.db` 分表编号，不传则遍历全部分表 |

**示例**:

```bash
curl "http://localhost:8000/history?chat_wxid=wxid_xxx&limit=20"
```

**响应**:

```json
{
  "chat_wxid": "wxid_xxx",
  "history": [
    {
      "local_id": 123,
      "msgid": "987654321",
      "type": 1,
      "sub_type": 0,
      "is_self": false,
      "timestamp": 1709600000,
      "chat_wxid": "wxid_xxx",
      "room_wxid": "",
      "talker_wxid": "wxid_xxx",
      "content": "hello",
      "thumb_path": "",
      "extra_path": "",
      "xml": "",
      "media": null
    }
  ]
}
```

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `422` | 缺少 `chat_wxid` |
| `500` | 内部错误 (`{"detail": "错误信息"}`) |

---

### POST /send_text — 发送文本消息

发送文本消息到指定联系人或群聊。支持群聊 @提及。

**请求体**:

```json
{
  "to_wxid": "wxid_xxxxxxxxxxxx",
  "content": "消息内容",
  "at_list": ["wxid_user1", "wxid_user2"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to_wxid` | string | 是 | 目标微信 ID (个人 wxid 或群 wxid) |
| `content` | string | 是 | 消息文本内容 |
| `at_list` | string[] \| null | 否 | 群聊中需要 @提及的用户 wxid 列表。提供且非空时，以群 @消息 方式发送 |

**行为**:
- 当 `at_list` 为空或未提供时，调用普通文本发送
- 当 `at_list` 非空时，调用群 @消息 发送 (仅在群聊中有效)

**响应 (成功)**:

```json
{
  "status": "success",
  "message": "Message sent"
}
```

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `422` | 请求体校验失败 (缺少必填字段、类型错误等) |
| `503` | 微信未登录 |
| `500` | 发送失败 (`{"detail": "错误信息"}`) |

---

### POST /send_image — 发送图片消息

发送本地图片文件到指定联系人或群聊。

**请求体**:

```json
{
  "to_wxid": "wxid_xxxxxxxxxxxx",
  "image_path": "C:\\path\\to\\image.jpg"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to_wxid` | string | 是 | 目标微信 ID (个人 wxid 或群 wxid) |
| `image_path` | string | 是 | Windows 本地图片文件路径 |

**响应 (成功)**:

```json
{
  "status": "success",
  "message": "Image sent"
}
```

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `422` | 缺少字段、路径不存在、或路径不是文件 |
| `503` | 微信未登录 |
| `500` | 发送失败 (`{"detail": "错误信息"}`) |

---

### POST /send_file — 发送文件消息

发送本地文件到指定联系人或群聊。

**请求体**:

```json
{
  "to_wxid": "wxid_xxxxxxxxxxxx",
  "file_path": "C:\\path\\to\\document.pdf"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to_wxid` | string | 是 | 目标微信 ID (个人 wxid 或群 wxid) |
| `file_path` | string | 是 | Windows 本地文件路径 |

**响应 (成功)**:

```json
{
  "status": "success",
  "message": "File sent"
}
```

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `422` | 缺少字段、路径不存在、或路径不是文件 |
| `503` | 微信未登录 |
| `500` | 发送失败 (`{"detail": "错误信息"}`) |

---

### POST /send_media_upload — 上传并发送媒体

供远端插件把二进制文件内容直接上传到 Bridge，再由 Bridge 作为本机文件发送到微信。

这个端点主要用于 OpenClaw 运行在 VPS、Bridge 运行在 Windows 主机的场景，因为 `POST /send_image` 和 `POST /send_file` 只能接受 Windows 本地路径。

**请求体**:

```json
{
  "to_wxid": "wxid_xxxxxxxxxxxx",
  "media_kind": "image",
  "file_name": "chart.png",
  "content_base64": "iVBORw0KGgoAAAANSUhEUgAA..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to_wxid` | string | 是 | 目标微信 ID (个人 wxid 或群 wxid) |
| `media_kind` | string | 是 | 媒体类型。当前仅支持 `"image"` 或 `"file"` |
| `file_name` | string | 否 | 原始文件名，用于落盘命名；为空时自动生成 |
| `content_base64` | string | 是 | 文件内容的 Base64 编码，可带 `data:*;base64,` 前缀 |

当前实现对该端点的请求体大小限制为约 `25 MB`（含 Base64 编码后的体积）。

**响应 (成功)**:

```json
{
  "status": "success",
  "message": "Uploaded media sent",
  "upload": {
    "media_kind": "image",
    "upload_dir": "D:\\PycharmProjects\\wechat-gateway\\downloads\\outbound-upload",
    "file_name": "1741770000000-uuid-chart.png",
    "saved_path": "D:\\PycharmProjects\\wechat-gateway\\downloads\\outbound-upload\\1741770000000-uuid-chart.png",
    "bytes": 245671
  }
}
```

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `422` | 缺少必填字段、`media_kind` 非法、或 `content_base64` 非法 |
| `503` | 微信未登录 |
| `500` | 上传或发送失败 (`{"detail": "错误信息"}`) |

---

### POST /forward_message — 转发消息

转发一条已有消息到指定联系人或群聊。

**请求体**:

```json
{
  "to_wxid": "wxid_xxxxxxxxxxxx",
  "message_id": "987654321"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to_wxid` | string | 是 | 目标微信 ID (个人 wxid 或群 wxid) |
| `message_id` | string | 是 | 要转发的消息 ID |

**响应 (成功)**:

```json
{
  "status": "success",
  "message": "Message forwarded"
}
```

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `422` | 缺少 `to_wxid` 或 `message_id` |
| `503` | 微信未登录 |
| `500` | 转发失败 (`{"detail": "错误信息"}`) |

---

### POST /revoke_message — 撤回消息

撤回一条由当前账号发送的消息。

**请求体**:

```json
{
  "message_id": "987654321"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message_id` | string | 是 | 要撤回的消息 ID |

**响应 (成功)**:

```json
{
  "status": "success",
  "message": "Message revoked"
}
```

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `422` | 缺少 `message_id` |
| `503` | 微信未登录 |
| `500` | 撤回失败 (`{"detail": "错误信息"}`) |

---

### POST /download_media — 下载媒体消息

下载一条最近收到的媒体消息到 Bridge 本地磁盘。

当前版本只支持下载仍存在于 Bridge 近期入站缓存中的消息，因此它适合处理刚收到的图片、语音、视频和文件，不适合把 `message_id` 当成长期归档索引。

**请求体**:

```json
{
  "message_id": "987654321",
  "timeout_seconds": 30
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message_id` | string | 是 | 要下载的最近入站媒体消息 ID |
| `timeout_seconds` | integer | 否 | 下载等待秒数，默认 `30`，范围 `1-120` |

**响应 (成功)**:

```json
{
  "status": "success",
  "message": "Media downloaded",
  "download": {
    "message_id": "987654321",
    "media": {
      "kind": "image",
      "thumb_path": "C:\\temp\\thumb.dat",
      "extra_path": "C:\\temp\\img.dat"
    },
    "download_dir": "D:\\PycharmProjects\\wechat-gateway\\bridge-node\\downloads",
    "file_name": "image-987654321.jpg",
    "saved_path": "D:\\PycharmProjects\\wechat-gateway\\bridge-node\\downloads\\image-987654321.jpg"
  }
}
```

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| `404` | `message_id` 不在近期入站缓存中 |
| `422` | 缺少 `message_id`，或消息类型不是图片/语音/视频/文件 |
| `503` | 微信未登录 |
| `500` | 下载失败 (`{"detail": "错误信息"}`) |

---

## Webhook 推送 (Bridge → VPS)

Bridge 收到微信消息后，构建标准化载荷并通过 HTTP POST 推送至 `VPS_WEBHOOK_URL`。

推送在后台线程中异步执行，不阻塞消息接收。超时为 30 秒。

---

### 推送载荷结构

```json
{
  "channel": "ntchat",
  "msg_type": 11046,
  "self_info": {
    "wxid": "wxid_bot_xxxx",
    "nickname": "Bot昵称"
  },
  "data": {
    "from_wxid": "wxid_sender_xxxx",
    "to_wxid": "wxid_bot_xxxx",
    "room_wxid": "12345678@chatroom",
    "content": "消息文本内容",
    "at_user_list": ["wxid_bot_xxxx"],
    "msgid": "unique-message-id",
    "timestamp": 1709600000,
    "link_meta": null,
    "quoted_message": null,
    "media": null,
  "context_messages": [
    {
      "from_wxid": "wxid_sender_xxxx",
      "sender_display": "wxid_sender_xxxx",
      "content": "之前的消息内容",
      "timestamp": 1709590000,
      "msgid": "prev-message-id"
    }
  ]
  }
}
```

**顶层字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `channel` | string | 通道标识符。当前值为 `"ntchat"`，底层库变更后可能改变。请勿硬编码 |
| `msg_type` | integer | 消息类型常量，由底层库定义。具体数值可能随底层库变更 |
| `self_info` | object | Bot 自身身份信息 |
| `self_info.wxid` | string | Bot 的微信 ID |
| `self_info.nickname` | string | Bot 的昵称 |
| `data` | object | 消息详细数据 |

---

### data 字段详细说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `from_wxid` | string | 发送者的微信 ID |
| `to_wxid` | string | 接收者的微信 ID (通常是 Bot 自身) |
| `room_wxid` | string | 群聊 wxid。**私聊消息为空字符串 `""`**，群聊消息为群 wxid (如 `"12345678@chatroom"`) |
| `content` | string | 消息文本内容。对于非文本消息，为固定占位符文本 (见下方消息类型表) |
| `at_user_list` | string[] | 消息中被 @提及的用户 wxid 列表。无 @提及时为空数组 `[]` |
| `msgid` | string | 消息唯一标识符 |
| `timestamp` | integer | 消息时间戳 (Unix 秒) |
| `link_meta` | object \| null | 公众号文章元数据。仅当消息包含 `mp.weixin.qq.com` 链接且 `AUTO_FETCH_MP` 开启时存在，否则为 `null` |
| `quoted_message` | object \| null | 被引用消息的元数据。仅当消息是引用回复 (quoted reply) 类型时存在，否则为 `null`。见 `quoted_message 字段` 一节 |
| `media` | object \| null | 归一化后的媒体元数据。图片/语音/视频/文件消息时存在，其余为 `null` |
| `context_messages` | array | 群聊上下文快照。仅当消息来自群聊（`room_wxid` 非空）且 `groupContextEnabled` 为 `true` 时存在，否则不含此字段。数组中每条消息包含 `from_wxid`、`sender_display`、`content`、`timestamp`、`msgid`，按时间从旧到新排列。TTL 由 `groupContextTtlHours` 控制（默认 48 小时） |

**判断消息来源**:
- `room_wxid == ""` → 私聊 (DM)
- `room_wxid != ""` → 群聊，`from_wxid` 为群内发言者

**引用回复消息的特殊处理**:
对于引用回复 (quoted reply) 类型的消息 (`wx_sub_type == 57`)，Bridge 会从 XML 中提取被引用的文本作为 `content`。如果被引用的消息指向 Bot 自身，Bot 的 wxid 会被自动加入 `at_user_list`。同时，`quoted_message` 字段会被填充为被引用消息的元数据（见 `quoted_message 字段` 一节）。

---

### link_meta 字段 (公众号文章元数据)

当消息中包含微信公众号文章链接 (`mp.weixin.qq.com/s?...`) 时，Bridge 会自动抓取文章内容并附加到 `link_meta` 中。

```json
{
  "url": "https://mp.weixin.qq.com/s?__biz=...",
  "raw_title": "XML 中的原始标题",
  "raw_desc": "XML 中的原始摘要",
  "raw_sourceusername": "gh_xxxxxxxxxxxx",
  "raw_sourcedisplayname": "公众号名称",
  "fetch": {
    "url": "https://mp.weixin.qq.com/s?__biz=...",
    "status": 200,
    "final_url": "https://mp.weixin.qq.com/s/xxxxxx",
    "title": "文章标题",
    "author": "文章作者",
    "content_preview": "文章正文前 3000 字符...",
    "content_length": 12345,
    "error": "",
    "saved_path": "mp_snapshots/mp_1709600000000.txt"
  }
}
```

**link_meta 顶层字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string | 提取到的公众号文章 URL |
| `raw_title` | string | 微信消息 XML 中的原始标题 |
| `raw_desc` | string | 微信消息 XML 中的原始描述/摘要 |
| `raw_sourceusername` | string | 公众号原始 ID (如 `gh_xxxx`) |
| `raw_sourcedisplayname` | string | 公众号显示名称 |
| `fetch` | object | HTTP 抓取结果 |

**fetch 子对象字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string | 请求的 URL |
| `status` | integer \| null | HTTP 状态码。抓取失败时为 `null` |
| `final_url` | string | 重定向后的最终 URL |
| `title` | string | 从 HTML 中提取的文章标题 |
| `author` | string | 从 HTML 中提取的作者名 |
| `content_preview` | string | 文章正文前 3000 字符 (HTML 标签已清除) |
| `content_length` | integer | 文章正文总字符数 |
| `error` | string | 错误信息。成功时为空字符串 |
| `saved_path` | string (可选) | 文章全文保存路径。仅在成功抓取到正文时存在 |

**注意**: `link_meta` 的抓取是同步的，会增加 webhook 推送的延迟 (受 `MP_FETCH_TIMEOUT` 控制)。对于重复 URL，Bridge 使用内存缓存避免重复抓取。

---

### quoted_message 字段 (引用消息元数据)

当 `data.quoted_message` 非空时，结构如下：

```json
{
  "type": 49,
  "message_id": "1739449349566574535",
  "from_wxid": "wxid_spacebar",
  "display_name": "spacebar",
  "content": "被引用消息的文本内容",
  "link_meta": {
    "kind": "mp_article",
    "url": "https://mp.weixin.qq.com/s/...",
    "raw_title": "文章标题",
    "raw_desc": "文章摘要",
    "raw_sourceusername": "gh_xxxx",
    "raw_sourcedisplayname": "公众号名称"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | integer | 被引用消息的 `msg_type` |
| `message_id` | string | 被引用消息的 ID |
| `from_wxid` | string | 被引用消息的发送者 wxid |
| `display_name` | string | 被引用消息的发送者昵称 |
| `content` | string | 被引用消息的文本内容 |
| `link_meta` | object \| null | 当被引用消息本身是公众号文章分享时，包含从 XML 解析的元数据（`kind`、`url`、`raw_title`、`raw_desc`、`raw_sourceusername`、`raw_sourcedisplayname`），**不含** `fetch` 子对象。否则为 `null` |

---

### 支持的消息类型

以下是 Bridge 监听并推送的消息类型。`content` 字段对于非文本消息使用固定占位符。

| 消息类型 | 描述 | content 字段 |
|----------|------|-------------|
| 文本消息 | 普通文字聊天 | 原始文本内容 |
| 图片消息 | 收到图片 | `[收到一张图片，当前版本不支持解析]` |
| 链接消息 | 收到链接/分享 | `[收到一个链接或小程序分享]` |
| 语音消息 | 收到语音 | `[收到一条语音消息，当前版本不支持解析]` |
| 视频消息 | 收到视频 | `[收到一个视频，当前版本不支持解析]` |
| 文件消息 | 收到文件 | `[收到一个文件，当前版本不支持解析]` |
| 表情消息 | 收到表情 | `[收到一个表情]` |
| 小程序消息 | 收到小程序 | `[收到一个小程序分享]` |
| 系统消息 | 系统通知 (成员加入等) | `[系统消息]` |
| 引用回复 | 对消息的引用/回复 (sub_type=57) | 引用文本内容 (从 XML 提取) |

**关于 `msg_type` 数值**: 具体数值取决于底层微信 Hook 库。插件端不应依赖这些数值来判断消息类型 —— 应通过 `content` 字段的格式和内容来区分。

---

### 反回环保护

Bridge 在构建 webhook 载荷时会自动检测消息发送者:

- 如果 `from_wxid` 等于 Bot 自身的 `wxid`，该消息**不会**被推送到 VPS
- 这防止了 Bot 发送的消息被重新推送回插件端导致无限循环

此行为是内置的，无需额外配置。

---

## 错误处理

### HTTP API 错误格式

所有 API 端点的错误响应遵循 FastAPI 默认格式:

```json
{
  "detail": "错误描述信息"
}
```

### 通用错误状态码

| 状态码 | 含义 | 可能触发的端点 |
|--------|------|----------------|
| `200` | 成功 | 所有端点 |
| `404` | 请求的资源不存在或已不在缓存中 | `POST /download_media` |
| `422` | 请求体或查询参数校验失败 | `GET /room_members`, `GET /history`, `POST /send_text`, `POST /send_image`, `POST /send_file`, `POST /send_media_upload`, `POST /forward_message`, `POST /revoke_message`, `POST /download_media` |
| `500` | 内部服务器错误 | 所有端点 |
| `503` | 微信未登录 | `GET /login_info`, `POST /send_text`, `POST /send_image`, `POST /send_file`, `POST /send_media_upload`, `POST /forward_message`, `POST /revoke_message`, `POST /download_media` |

### Webhook 推送失败处理

- 推送超时: 30 秒
- 推送失败时仅打印日志，不影响消息接收
- 不进行重试 (fire-and-forget 模式)
- VPS 端返回非 200 状态码时记录警告日志

---

## 附录: 插件端快速集成参考

插件端与 Bridge 的交互汇总:

| 方向 | 方法 | 路径 | 用途 |
|------|------|------|------|
| 插件 → Bridge | `GET` | `/` | 健康检查 (Bridge 是否存活) |
| 插件 → Bridge | `GET` | `/login_info` | 查询 Bot 身份 |
| 插件 → Bridge | `GET` | `/contacts` | 查询联系人列表 |
| 插件 → Bridge | `GET` | `/rooms` | 查询群聊列表 |
| 插件 → Bridge | `GET` | `/room_members` | 查询指定群成员列表 |
| 插件 → Bridge | `GET` | `/history` | 查询历史消息 |
| 插件 → Bridge | `POST` | `/send_text` | 发送消息 |
| 插件 → Bridge | `POST` | `/send_image` | 发送图片 |
| 插件 → Bridge | `POST` | `/send_file` | 发送文件 |
| 插件 → Bridge | `POST` | `/send_media_upload` | 上传二进制后发送图片或文件 |
| 插件 → Bridge | `POST` | `/forward_message` | 转发消息 |
| 插件 → Bridge | `POST` | `/revoke_message` | 撤回消息 |
| 插件 → Bridge | `POST` | `/download_media` | 下载最近入站媒体到 Bridge 本地 |
| 插件 → Bridge | `POST` | `/decrypt_image` | 以二进制流拉取图片消息 |
| 插件 → Bridge | `POST` | `/download_audio` | 以二进制流拉取语音消息 |
| 插件 → Bridge | `POST` | `/resolve_mp_article` | 展开公众号文章卡片 |
| 插件 → Bridge | `POST` | `/set_webhook` | 自动注册 OpenClaw webhook |
| Bridge → 插件 | `POST` | (VPS webhook) | 推送收到的微信消息 |

插件端只需实现:
1. 一个 HTTP 客户端，用于调用上述多个 API 端点
   当前常用端点包括健康检查、联系人/群查询、历史消息查询、文本/图片/文件发送、转发、撤回、近期媒体下载。
2. 一个 HTTP 服务端 (webhook handler)，用于接收 Bridge 的消息推送
