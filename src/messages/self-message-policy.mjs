import { WechatMessageType } from 'wechatferry';

function normalizeText(value) {
  return String(value || '').trim();
}

function hasRecallXmlMarker(values) {
  return values.some((value) => /<(revokemsg|replacemsg)\b/i.test(normalizeText(value)));
}

function hasRecallNoticeText(values) {
  return values.some((value) => /(\u64a4\u56de|recalled)/i.test(normalizeText(value)));
}

export function shouldAllowSelfInboundMessage(raw, payload) {
  if (!raw?.is_self) {
    return false;
  }

  const messageType = Number(payload?.msg_type || raw?.type || 0);
  if (messageType === WechatMessageType.Recalled) {
    return true;
  }

  const xmlCandidates = [
    payload?.data?.raw_xml,
    payload?.data?.raw_content,
    raw?.xml,
    raw?.content,
  ];
  if (hasRecallXmlMarker(xmlCandidates)) {
    return true;
  }

  if (messageType !== WechatMessageType.Sys && messageType !== WechatMessageType.SysNotice) {
    return false;
  }

  const textCandidates = [
    payload?.data?.content,
    payload?.data?.raw_content,
    raw?.content,
  ];
  return hasRecallNoticeText(textCandidates);
}