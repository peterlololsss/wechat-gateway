import http from 'node:http';
import process from 'node:process';
import { loadConfig, loadRuntimeState, saveRuntimeState } from './config/store.mjs';
import { InboundMessageStore } from './runtime/inbound-message-store.mjs';
import { GroupContextStore } from './runtime/group-context-store.mjs';
import { configureLogger, createLogger } from './logger.mjs';
import { OutboundSendQueue } from './runtime/outbound-send-queue.mjs';
import { createBridgeRequestHandler } from './http/request-handler.mjs';
import { ensureWeChatRunning } from './bridge/wechat-launcher.mjs';
import { postWebhook } from './http/webhook.mjs';
import { WechatFerryBridge } from './bridge/wechatferry-adapter.mjs';
import { shouldAllowSelfInboundMessage } from './messages/self-message-policy.mjs';

// Load mutable runtime state first so a legacy webhookUrl can be migrated out of config.json.
const runtimeState = loadRuntimeState();
const config = loadConfig();
const loggerConfig = configureLogger({ level: config.logLevel });
const logger = createLogger('bridge');
const bridge = new WechatFerryBridge(config);
const inboundMessages = new InboundMessageStore();
const groupContextStore = new GroupContextStore({
  contextTtlMs: config.groupContextTtlHours * 60 * 60 * 1000,
  maxMessagesPerRoom: config.groupContextMaxMessages,
});
const outboundSendQueue = new OutboundSendQueue(config);
const server = http.createServer(createBridgeRequestHandler({
  bridge,
  config,
  runtimeState,
  saveRuntimeState,
  inboundMessages,
  outboundSendQueue,
}));

function summarizeContentPreview(value) {
  const content = String(value || '').replace(/\s+/g, ' ').trim();
  if (!content) {
    return '';
  }
  return content.length > 80 ? `${content.slice(0, 77)}...` : content;
}

bridge.on('login', (selfInfo) => {
  logger.info('login', {
    wxid: selfInfo.wxid || '',
    nickname: selfInfo.nickname || '',
  });
});

bridge.on('logout', () => {
  logger.warn('logout');
});

bridge.on('error', (error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('runtime error', { error: message });
});

bridge.on('message', ({ payload, raw }) => {
  const allowSelfInbound = shouldAllowSelfInboundMessage(raw, payload);
  if (raw?.is_self && !allowSelfInbound) {
    logger.info('self message', {
      raw_id: raw?.id || '',
      payload_msgid: payload?.data?.msgid || '',
      to_wxid: raw?.roomid || raw?.sender || '',
      content_preview: summarizeContentPreview(raw?.content),
    });
    return;
  }

  if (raw?.is_self) {
    logger.info('self notice', {
      message_id: payload?.data?.msgid || raw?.id || '',
      msg_type: payload?.msg_type || raw?.type || 0,
      content_preview: summarizeContentPreview(payload?.data?.content || raw?.content),
    });
  }

  const inboundLogFields = {
    message_id: payload?.data?.msgid || raw?.id || '',
    from_wxid: payload?.data?.from_wxid || raw?.sender || '',
    room_wxid: payload?.data?.room_wxid || '',
    msg_type: payload?.msg_type || raw?.type || 0,
    content_preview: summarizeContentPreview(payload?.data?.content),
  };

  if (payload?.data?.quoted_message) {
    inboundLogFields.quoted_from_wxid = payload.data.quoted_message.from_wxid || '';
    inboundLogFields.quoted_preview = summarizeContentPreview(payload.data.quoted_message.content);
  }

  logger.info('inbound_message', inboundLogFields);

  if (config.debugRawInbound) {
    logger.debug('inbound_message_raw', {
      message_id: payload?.data?.msgid || raw?.id || '',
      raw_message: {
        id: raw?.id || '',
        type: raw?.type || 0,
        sender: raw?.sender || '',
        roomid: raw?.roomid || '',
        is_self: Boolean(raw?.is_self),
        content: raw?.content || '',
        xml: raw?.xml || '',
        thumb: raw?.thumb || raw?.thumb_path || '',
        extra: raw?.extra || raw?.extra_path || '',
      },
      normalized_data: {
        content: payload?.data?.content || '',
        raw_content: payload?.data?.raw_content || '',
        raw_xml: payload?.data?.raw_xml || '',
        content_fallback: Boolean(payload?.data?.content_fallback),
        at_user_list: Array.isArray(payload?.data?.at_user_list) ? payload.data.at_user_list : [],
        link_meta: payload?.data?.link_meta || null,
        quoted_message: payload?.data?.quoted_message || null,
        media: payload?.data?.media || null,
      },
    });
  }

  const record = inboundMessages.remember(raw, payload);
  if (!record.accepted) {
    logger.debug('skip duplicate inbound message', {
      message_id: record.messageId,
    });
    return;
  }

  // Push into group context buffer (only for group messages with text content)
  const roomWxid = payload?.data?.room_wxid || '';
  if (config.groupContextEnabled && roomWxid) {
    groupContextStore.push(roomWxid, {
      from_wxid: payload?.data?.from_wxid || '',
      sender_display: payload?.data?.from_wxid || '',
      content: payload?.data?.content || '',
      timestamp: payload?.data?.timestamp || Math.floor(Date.now() / 1000),
      msgid: payload?.data?.msgid || '',
    });
  }

  const targetUrl = runtimeState.webhookUrl;
  if (!targetUrl) {
    logger.debug('skip webhook push because target is empty', {
      message_id: record.messageId,
    });
    return;
  }

  // Attach group context snapshot to the payload (non-mutating: build a new object)
  let pushPayload = payload;
  if (config.groupContextEnabled && roomWxid) {
    const contextMessages = groupContextStore.getContext(roomWxid);
    pushPayload = { ...payload, context_messages: contextMessages };
  }

  void postWebhook(targetUrl, pushPayload, config.webhookSecret, {
    timeoutMs: config.webhookTimeoutMs,
    retryCount: config.webhookRetryCount,
    retryBackoffMs: config.webhookRetryBackoffMs,
    retryBackoffMultiplier: config.webhookRetryBackoffMultiplier,
    authToken: config.webhookAuthToken,
  }).catch(() => {});
});

async function bootstrap() {
  logger.info('booting', {
    log_level: loggerConfig.level,
  });
  const launchResult = await ensureWeChatRunning(config);
  if (launchResult.reason === 'launched') {
    logger.info('launched WeChat', {
      executable_path: launchResult.executablePath,
    });
  } else if (launchResult.reason === 'already_running') {
    logger.info('WeChat already running');
  } else if (launchResult.reason === 'disabled') {
    logger.info('auto-launch disabled');
  } else if (launchResult.reason === 'not_found') {
    logger.warn('unable to locate WeChat executable, continuing without auto-launch', launchResult.diagnostics);
  } else if (launchResult.reason === 'launch_timeout') {
    logger.warn('WeChat launch timed out, continuing bridge startup', launchResult.diagnostics);
  }

  if (launchResult.diagnostics?.detectedVersion && launchResult.diagnostics.versionSupported === false) {
    logger.warn('detected unsupported WeChat version', {
      detected_version: launchResult.diagnostics.detectedVersion,
      supported_version_prefix: launchResult.diagnostics.supportedVersionPrefix,
      executable_path: launchResult.executablePath || '',
    });
  }

  bridge.start();

  server.listen(config.port, config.host, () => {
    logger.info('listening', {
      url: `http://${config.host}:${config.port}`,
    });
    if (runtimeState.webhookUrl) {
      logger.info('webhook target configured', {
        target_url: runtimeState.webhookUrl,
      });
    }
  });
}

bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('bootstrap failed', { error: message });
  process.exit(1);
});

function shutdown(signal) {
  logger.info('shutting down', { signal });
  server.close(() => {
    bridge.stop();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
