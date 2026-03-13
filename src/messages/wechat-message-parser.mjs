import { WechatAppMessageType, WechatMessageType } from 'wechatferry';

const MESSAGE_PLACEHOLDERS = {
  [WechatMessageType.Image]: '[received an image]',
  [WechatMessageType.Voice]: '[received a voice message]',
  [WechatMessageType.Video]: '[received a video]',
  [WechatMessageType.MicroVideo]: '[received a video]',
  [WechatMessageType.File]: '[received a file]',
  [WechatMessageType.Emoticon]: '[received an emoticon]',
  [WechatMessageType.MiniProgram]: '[received a mini program share]',
  [WechatMessageType.Transfer]: '[received a transfer]',
  [WechatMessageType.RedEnvelope]: '[received a red envelope]',
  [WechatMessageType.Sys]: '[received a system message]',
  [WechatMessageType.SysNotice]: '[received a system notice]',
  [WechatMessageType.Recalled]: '[a message was recalled]',
  [WechatMessageType.App]: '[received a link or app share]',
};

function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function sanitizeText(value = '') {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function looksLikeXml(value = '') {
  const text = sanitizeText(value);
  return text.startsWith('<') && /<\/?[a-zA-Z]/.test(text);
}

function readXmlTag(xml = '', tag) {
  const cdataPattern = new RegExp(`<${tag}(?:\\s[^>]*)?><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const plainPattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(cdataPattern) || xml.match(plainPattern);
  return match ? decodeXmlEntities(match[1]) : '';
}

function readXmlBlock(xml = '', tag) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  return xml.match(pattern)?.[1] || '';
}

function parseCsvList(value = '') {
  return String(value || '')
    .split(/[;,ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼ÃƒÂ¢Ã¢â€šÂ¬Ã‚Âº]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function classifyAppLinkKind(url = '') {
  if (!url) {
    return '';
  }
  if (url.includes('mp.weixin.qq.com')) {
    return 'mp_article';
  }
  return 'link';
}

function buildLinkMeta(appPayload) {
  if (!appPayload?.url) {
    return null;
  }

  return {
    kind: classifyAppLinkKind(appPayload.url),
    url: appPayload.url,
    raw_title: appPayload.title || '',
    raw_desc: appPayload.description || '',
    raw_sourceusername: appPayload.sourceUsername || '',
    raw_sourcedisplayname: appPayload.sourceDisplayName || '',
  };
}

function summarizeAppType(appType) {
  switch (appType) {
    case WechatAppMessageType.Url:
      return 'link';
    case WechatAppMessageType.Attach:
      return 'file';
    case WechatAppMessageType.Open:
      return 'open app share';
    case WechatAppMessageType.VoiceRemind:
      return 'voice reminder';
    case WechatAppMessageType.ScanGood:
    case WechatAppMessageType.Good:
      return 'product share';
    case WechatAppMessageType.ChatHistory:
      return 'chat history';
    case WechatAppMessageType.MiniProgram:
    case WechatAppMessageType.MiniProgramApp:
      return 'mini program';
    case WechatAppMessageType.RealtimeShareLocation:
      return 'location share';
    case WechatAppMessageType.Transfers:
      return 'transfer';
    case WechatAppMessageType.RedEnvelopes:
      return 'red envelope';
    case WechatAppMessageType.GroupNote:
      return 'group note';
    case WechatAppMessageType.Channels:
      return 'channels share';
    default:
      return 'app share';
  }
}

function summarizeReferencedMessage(referMessage) {
  if (!referMessage) {
    return '';
  }

  switch (referMessage.type) {
    case WechatMessageType.Text:
      return sanitizeText(referMessage.content);
    case WechatMessageType.Image:
      return 'image';
    case WechatMessageType.Video:
    case WechatMessageType.MicroVideo:
      return 'video';
    case WechatMessageType.Emoticon:
      return 'emoticon';
    case WechatMessageType.Location:
      return 'location';
    case WechatMessageType.App: {
      const nestedAppPayload = parseAppMessagePayload(referMessage.content);
      return nestedAppPayload?.title || nestedAppPayload?.description || 'app share';
    }
    default:
      return 'message';
  }
}

function buildQuotedMessage(referMessage) {
  if (!referMessage) {
    return null;
  }

  const msgType = referMessage.type;
  let content = '';
  let linkMeta = null;

  switch (msgType) {
    case WechatMessageType.Text:
      content = sanitizeText(referMessage.content);
      break;
    case WechatMessageType.Image:
      content = '[image]';
      break;
    case WechatMessageType.Video:
    case WechatMessageType.MicroVideo:
      content = '[video]';
      break;
    case WechatMessageType.Emoticon:
      content = '[emoticon]';
      break;
    case WechatMessageType.Location:
      content = '[location]';
      break;
    case WechatMessageType.App: {
      const nestedPayload = parseAppMessagePayload(referMessage.content);
      content = nestedPayload?.title || nestedPayload?.description || '[app share]';
      linkMeta = buildLinkMeta(nestedPayload);
      break;
    }
    default:
      content = '[message]';
      break;
  }

  return {
    type: msgType,
    message_id: referMessage.messageId || '',
    from_wxid: referMessage.fromUser || '',
    display_name: referMessage.displayName || '',
    content,
    link_meta: linkMeta,
  };
}

function parseAppMessagePayload(xml = '') {
  const source = sanitizeText(xml);
  const appBlock = readXmlBlock(source, 'appmsg');
  if (!appBlock) {
    return null;
  }

  const referBlock = readXmlBlock(appBlock, 'refermsg');
  const miniProgramBlock = readXmlBlock(appBlock, 'weappinfo');
  const channelBlock = readXmlBlock(appBlock, 'finderFeed');
  const appType = Number.parseInt(readXmlTag(appBlock, 'type'), 10);

  return {
    type: Number.isFinite(appType) ? appType : 0,
    title: readXmlTag(appBlock, 'title'),
    description: readXmlTag(appBlock, 'des') || readXmlTag(appBlock, 'digest'),
    url: readXmlTag(appBlock, 'url'),
    thumbUrl: readXmlTag(appBlock, 'thumburl'),
    sourceUsername: readXmlTag(appBlock, 'sourceusername'),
    sourceDisplayName: readXmlTag(appBlock, 'sourcedisplayname'),
    miniProgram: miniProgramBlock
      ? {
          username: readXmlTag(miniProgramBlock, 'username'),
          appid: readXmlTag(miniProgramBlock, 'appid'),
          pagePath: readXmlTag(miniProgramBlock, 'pagepath'),
          iconUrl: readXmlTag(miniProgramBlock, 'weappiconurl'),
        }
      : null,
    channel: channelBlock
      ? {
          nickname: readXmlTag(channelBlock, 'nickname'),
          description: readXmlTag(channelBlock, 'desc'),
          username: readXmlTag(channelBlock, 'username'),
        }
      : null,
    referMessage: referBlock
      ? {
          type: Number.parseInt(readXmlTag(referBlock, 'type'), 10) || 0,
          messageId: readXmlTag(referBlock, 'svrid'),
          fromUser: readXmlTag(referBlock, 'fromusr'),
          chatUser: readXmlTag(referBlock, 'chatusr'),
          displayName: readXmlTag(referBlock, 'displayname'),
          content: readXmlTag(referBlock, 'content'),
        }
      : null,
  };
}

function extractAtUserList(xml = '', appPayload = null, selfWxid = '') {
  const messageSourceBlock = readXmlBlock(xml, 'msgsource');
  const mentionIds = parseCsvList(
    readXmlTag(messageSourceBlock, 'atuserlist') || readXmlTag(xml, 'atuserlist'),
  );

  if (selfWxid && appPayload?.referMessage?.fromUser === selfWxid) {
    mentionIds.push(selfWxid);
  }

  return uniqueStrings(mentionIds);
}

function placeholderForMessage(type) {
  return MESSAGE_PLACEHOLDERS[type] || '[received a non-text message]';
}

function normalizeSystemMessageContent(type, text, xml) {
  const cleanText = sanitizeText(text);
  if (cleanText && !looksLikeXml(cleanText)) {
    return cleanText;
  }

  if (type === WechatMessageType.Recalled) {
    const revokeBlock = readXmlBlock(xml, 'revokemsg');
    const replacement = readXmlTag(revokeBlock, 'replacemsg') || readXmlTag(xml, 'replacemsg');
    if (replacement) {
      return replacement;
    }
  }

  const templateText = readXmlTag(xml, 'template') || readXmlTag(xml, 'content_template');
  if (templateText) {
    return templateText;
  }

  const announcementText = readXmlTag(xml, 'textannouncement') || readXmlTag(xml, 'announcement');
  if (announcementText) {
    return announcementText;
  }

  const titledText = readXmlTag(xml, 'title') || readXmlTag(xml, 'des') || readXmlTag(xml, 'digest');
  if (titledText) {
    return titledText;
  }

  return placeholderForMessage(type);
}

function normalizeAppMessageContent(appPayload) {
  if (!appPayload) {
    return placeholderForMessage(WechatMessageType.App);
  }

  if (appPayload.type === WechatAppMessageType.ReferMsg) {
    return appPayload.title || summarizeReferencedMessage(appPayload.referMessage) || '[received a quote reply]';
  }

  if (appPayload.type === WechatAppMessageType.ChatHistory) {
    return appPayload.title || '[received a chat history share]';
  }

  if (appPayload.type === WechatAppMessageType.GroupNote) {
    return appPayload.title || appPayload.description || '[received a group note]';
  }

  if (appPayload.type === WechatAppMessageType.MiniProgram || appPayload.type === WechatAppMessageType.MiniProgramApp) {
    return appPayload.title || '[received a mini program share]';
  }

  if (appPayload.type === WechatAppMessageType.Attach) {
    return appPayload.title ? `[received a file share] ${appPayload.title}` : '[received a file share]';
  }

  if (appPayload.type === WechatAppMessageType.Open) {
    return appPayload.title || appPayload.description || '[received an open app share]';
  }

  if (appPayload.type === WechatAppMessageType.VoiceRemind) {
    return appPayload.title || appPayload.description || '[received a voice reminder]';
  }

  if (appPayload.type === WechatAppMessageType.ScanGood || appPayload.type === WechatAppMessageType.Good) {
    return appPayload.title || appPayload.description || '[received a product share]';
  }

  if (appPayload.type === WechatAppMessageType.RealtimeShareLocation) {
    return appPayload.title || appPayload.description || '[received a location share]';
  }

  if (appPayload.type === WechatAppMessageType.Transfers) {
    return appPayload.title || '[received a transfer]';
  }

  if (appPayload.type === WechatAppMessageType.RedEnvelopes) {
    return appPayload.title || '[received a red envelope]';
  }

  if (appPayload.type === WechatAppMessageType.CardTicket) {
    return appPayload.title || '[received a card share]';
  }

  if (appPayload.type === WechatAppMessageType.Emoji || appPayload.type === WechatAppMessageType.Emotion) {
    return appPayload.title || '[received an emoticon share]';
  }

  if (appPayload.type === WechatAppMessageType.ReaderType) {
    return appPayload.title || appPayload.description || '[received a reader share]';
  }

  if (appPayload.type === WechatAppMessageType.Channels) {
    return appPayload.title || appPayload.channel?.description || '[received a channels share]';
  }

  if (appPayload.url) {
    return appPayload.title || appPayload.description || '[received a link share]';
  }

  if (appPayload.title || appPayload.description) {
    return appPayload.title || appPayload.description;
  }

  return `[received a ${summarizeAppType(appPayload.type)}]`;
}

function normalizeTextContent(text) {
  const cleanText = sanitizeText(text);
  if (!cleanText || looksLikeXml(cleanText)) {
    return '';
  }
  return cleanText;
}

function hasStructuredPayloadXml(xml = '') {
  const source = sanitizeText(xml);
  return /<(msg|appmsg|sysmsg)(?:\s|>)/i.test(source);
}

function buildParseXml(text, rawXml) {
  const inlineXml = looksLikeXml(text) ? text : '';
  const normalizedRawXml = sanitizeText(rawXml);
  const primaryXml = hasStructuredPayloadXml(normalizedRawXml)
    ? normalizedRawXml
    : hasStructuredPayloadXml(inlineXml)
      ? inlineXml
      : (normalizedRawXml || inlineXml);
  const parts = [];

  if (primaryXml) {
    parts.push(primaryXml);
  }
  if (normalizedRawXml && normalizedRawXml !== primaryXml) {
    parts.push(normalizedRawXml);
  }
  if (inlineXml && inlineXml !== primaryXml) {
    parts.push(inlineXml);
  }

  return {
    rawXml: normalizedRawXml,
    parseXml: parts.join('\n'),
  };
}

export function classifyWechatMediaKind(type) {
  switch (Number(type || 0)) {
    case WechatMessageType.Image:
      return 'image';
    case WechatMessageType.Voice:
      return 'voice';
    case WechatMessageType.Video:
    case WechatMessageType.MicroVideo:
      return 'video';
    case WechatMessageType.File:
      return 'file';
    default:
      return '';
  }
}

export function normalizeMediaDescriptor(message) {
  const kind = classifyWechatMediaKind(message?.type);
  if (!kind) {
    return null;
  }

  return {
    kind,
    thumb_path: message?.thumb || message?.thumb_path || '',
    extra_path: message?.extra || message?.extra_path || '',
  };
}

export function normalizeWechatMessage(message, { selfWxid = '' } = {}) {
  const messageType = Number(message?.type || 0);
  const text = sanitizeText(message?.content);
  const { rawXml, parseXml } = buildParseXml(text, message?.xml);
  const media = normalizeMediaDescriptor(message);
  const appPayload = messageType === WechatMessageType.App || messageType === WechatMessageType.MiniProgram
    ? parseAppMessagePayload(parseXml)
    : null;
  const placeholder = placeholderForMessage(messageType);

  let content = '';
  if (messageType === WechatMessageType.Text) {
    content = normalizeTextContent(text);
  } else if (media) {
    content = placeholder;
  } else if (messageType === WechatMessageType.App || messageType === WechatMessageType.MiniProgram) {
    content = normalizeAppMessageContent(appPayload);
  } else if (
    messageType === WechatMessageType.Sys
    || messageType === WechatMessageType.SysNotice
    || messageType === WechatMessageType.Recalled
  ) {
    content = normalizeSystemMessageContent(messageType, text, parseXml);
  } else {
    content = normalizeTextContent(text);
  }

  if (!content) {
    content = placeholder;
  }

  const quotedMessage = appPayload?.type === WechatAppMessageType.ReferMsg
    ? buildQuotedMessage(appPayload.referMessage)
    : null;

  return {
    content,
    linkMeta: buildLinkMeta(appPayload),
    atUserList: extractAtUserList(parseXml, appPayload, selfWxid),
    media,
    quotedMessage,
    rawContent: text,
    rawXml,
    contentFallback: !media && Boolean(parseXml) && (
      content === placeholder
      || (
        (messageType === WechatMessageType.App || messageType === WechatMessageType.MiniProgram)
        && Boolean(appPayload)
        && !appPayload.title
        && !appPayload.description
        && !appPayload.url
        && !appPayload.channel?.description
        && /^\[received a .+\]$/.test(content)
      )
    ),
  };
}