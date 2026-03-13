import { normalizeWechatMessage, classifyWechatMediaKind, normalizeMediaDescriptor } from './wechat-message-parser.mjs';

export { classifyWechatMediaKind, normalizeMediaDescriptor };

export function normalizeSelfInfo(userInfo) {
  return {
    wxid: userInfo?.wxid || '',
    nickname: userInfo?.name || '',
    account: userInfo?.home || userInfo?.mobile || '',
  };
}

export function normalizeContact(contact) {
  return {
    wxid: contact?.userName || '',
    nickname: contact?.nickName || '',
    alias: contact?.alias || '',
    remark: contact?.remark || '',
    tags: Array.isArray(contact?.tags) ? contact.tags : [],
    small_head_img_url: contact?.smallHeadImgUrl || '',
  };
}

export function normalizeRoom(room) {
  return {
    wxid: room?.userName || '',
    nickname: room?.nickName || '',
    owner_wxid: room?.ownerUserName || '',
    announcement: room?.announcement || '',
    member_wxids: Array.isArray(room?.memberIdList) ? room.memberIdList : [],
    small_head_img_url: room?.smallHeadImgUrl || '',
  };
}

export function normalizeRoomMember(member) {
  return {
    wxid: member?.userName || '',
    nickname: member?.nickName || '',
    display_name: member?.displayName || '',
    remark: member?.remark || '',
    small_head_img_url: member?.smallHeadImgUrl || '',
  };
}

export function normalizeHistoryMessage(message) {
  const chatWxid = message?.strTalker || '';
  const talkerWxid = message?.talkerWxid || '';
  const parsedBytesExtra = message?.parsedBytesExtra && typeof message.parsedBytesExtra === 'object'
    ? message.parsedBytesExtra
    : {};
  const normalizedMessage = normalizeWechatMessage({
    type: message?.type,
    content: message?.strContent,
    xml: parsedBytesExtra.xml,
    thumb_path: parsedBytesExtra.thumb,
    extra_path: parsedBytesExtra.extra,
  });

  return {
    local_id: Number(message?.localId || 0),
    msgid: message?.msgSvrId ? String(message.msgSvrId) : '',
    type: Number(message?.type || 0),
    sub_type: Number(message?.subType || 0),
    is_self: Boolean(message?.isSender),
    timestamp: Number(message?.createTime || 0),
    chat_wxid: chatWxid,
    room_wxid: chatWxid.endsWith('@chatroom') ? chatWxid : '',
    talker_wxid: talkerWxid,
    content: normalizedMessage.content,
    raw_content: normalizedMessage.rawContent,
    raw_xml: normalizedMessage.rawXml,
    content_fallback: normalizedMessage.contentFallback,
    at_user_list: normalizedMessage.atUserList,
    link_meta: normalizedMessage.linkMeta,
    quoted_message: normalizedMessage.quotedMessage,
    thumb_path: parsedBytesExtra.thumb || '',
    extra_path: parsedBytesExtra.extra || '',
    xml: parsedBytesExtra.xml || '',
    media: normalizedMessage.media,
  };
}

export function buildWebhookPayload(message, selfInfo, channelName) {
  const normalizedMessage = normalizeWechatMessage(message, { selfWxid: selfInfo?.wxid || '' });
  const isGroup = Boolean(message?.is_group);

  return {
    channel: channelName,
    msg_type: Number(message?.type || 0),
    self_info: {
      wxid: selfInfo?.wxid || '',
      nickname: selfInfo?.nickname || '',
    },
    data: {
      from_wxid: message?.sender || '',
      to_wxid: selfInfo?.wxid || '',
      room_wxid: isGroup ? (message?.roomid || '') : '',
      content: normalizedMessage.content,
      raw_content: normalizedMessage.rawContent,
      raw_xml: normalizedMessage.rawXml,
      content_fallback: normalizedMessage.contentFallback,
      at_user_list: normalizedMessage.atUserList,
      msgid: message?.id || '',
      timestamp: Number(message?.ts || Date.now()),
      link_meta: normalizedMessage.linkMeta,
      quoted_message: normalizedMessage.quotedMessage,
      media: normalizedMessage.media,
    },
  };
}
