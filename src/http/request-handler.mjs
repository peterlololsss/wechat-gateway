import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WechatMessageType } from 'wechatferry';
import { streamLocalFileResponse } from './file-response.mjs';
import { getPathname, getRequestUrl, isJsonRequest, readJsonBody, writeJson } from './http-utils.mjs';
import { createLogger } from '../logger.mjs';
import { normalizeOcrResult } from '../media/ocr-result.mjs';
import {
  normalizeAtList,
  normalizeConversationId,
  normalizeWxidList,
  resolveBoundedInteger,
  resolveNonEmptyString,
  validateLocalFilePath,
} from '../validators.mjs';

const logger = createLogger('http');

function requireJson(req, res) {
  if (isJsonRequest(req)) {
    return true;
  }
  writeJson(res, 415, { detail: 'Content-Type must be application/json' });
  return false;
}

function requireLogin(bridge, res) {
  if (bridge.isLogin()) {
    return true;
  }
  writeJson(res, 503, { detail: 'Not logged in yet' });
  return false;
}

function requireAdminApi(req, config, res) {
  if (!config.enableRoomMemberManagement) {
    writeJson(res, 404, { detail: 'Not found' });
    return false;
  }

  if (!config.adminApiToken) {
    writeJson(res, 503, { detail: 'adminApiToken is not configured' });
    return false;
  }

  const providedToken = resolveNonEmptyString(req.headers['x-bridge-admin-token']);
  if (!providedToken || providedToken !== config.adminApiToken) {
    writeJson(res, 403, { detail: 'Forbidden' });
    return false;
  }

  return true;
}

function parseHistoryParams(req) {
  const url = getRequestUrl(req);
  return {
    chatWxid: normalizeConversationId(url.searchParams.get('chat_wxid') || url.searchParams.get('peer_wxid')),
    limit: resolveBoundedInteger(url.searchParams.get('limit'), { defaultValue: 50, min: 1, max: 200 }),
    beforeCreateTime: resolveBoundedInteger(url.searchParams.get('before_create_time'), {
      defaultValue: undefined,
      min: 1,
    }),
    dbNumber: resolveBoundedInteger(url.searchParams.get('db_number'), {
      defaultValue: undefined,
      min: 0,
      max: 999,
    }),
  };
}

function selectRequestLogLevel(method, pathname, statusCode) {
  if (statusCode >= 500) {
    return 'error';
  }
  if (statusCode >= 400) {
    return 'warn';
  }
  if (method === 'GET' && pathname === '/') {
    return 'debug';
  }
  return 'info';
}

function resolveDownloadResponseMode(value) {
  const normalized = resolveNonEmptyString(value).toLowerCase();
  return normalized === 'binary' ? 'binary' : 'json';
}

function resolveUploadMediaKind(value) {
  const normalized = resolveNonEmptyString(value).toLowerCase();
  return normalized === 'image' ? 'image' : normalized === 'file' ? 'file' : '';
}

function sanitizeUploadFileName(value, mediaKind) {
  const fallbackName = mediaKind === 'image' ? 'upload-image.bin' : 'upload-file.bin';
  const candidate = path.basename(resolveNonEmptyString(value) || fallbackName).trim();
  const sanitized = candidate.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ');
  return sanitized || fallbackName;
}

function decodeUploadBase64(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    return null;
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.length === 0) {
    return null;
  }

  return buffer;
}

async function saveUploadedOutboundMedia({ mediaDownloadDir, mediaKind, fileName, contentBase64 }) {
  const content = decodeUploadBase64(contentBase64);
  if (!content) {
    throw new Error('content_base64 must be a valid non-empty base64 string');
  }

  const uploadDir = path.resolve(mediaDownloadDir, 'outbound-upload');
  await fs.mkdir(uploadDir, { recursive: true });

  const normalizedName = sanitizeUploadFileName(fileName, mediaKind);
  const savedName = `${Date.now()}-${randomUUID()}-${normalizedName}`;
  const savedPath = path.join(uploadDir, savedName);

  await fs.writeFile(savedPath, content);

  return {
    upload_dir: uploadDir,
    file_name: savedName,
    saved_path: savedPath,
    bytes: content.length,
  };
}

function getRecentInboundRawMessage(inboundMessages, messageId) {
  return inboundMessages?.get?.(messageId)?.rawMessage;
}

function requireRecentInboundRawMessage(inboundMessages, messageId, res, logger, operation) {
  const rawMessage = getRecentInboundRawMessage(inboundMessages, messageId);
  if (rawMessage) {
    return rawMessage;
  }

  logger.warn(`${operation} cache miss`, {
    message_id: messageId,
  });
  writeJson(res, 404, { detail: 'message_id not found in recent inbound cache' });
  return null;
}

async function handleRoomMemberMutation({
  req,
  res,
  bridge,
  config,
  operation,
  action,
  successMessage,
  logger,
  dispatchOutbound,
}) {
  if (!requireJson(req, res) || !requireAdminApi(req, config, res)) {
    return;
  }

  const body = await readJsonBody(req);
  const roomWxid = normalizeConversationId(body?.room_wxid);
  const memberWxids = normalizeWxidList(body?.member_wxids);

  if (!roomWxid || memberWxids.length === 0) {
    writeJson(res, 422, { detail: 'room_wxid and non-empty member_wxids are required' });
    return;
  }
  if (!requireLogin(bridge, res)) {
    return;
  }

  const result = await dispatchOutbound(operation, () => action(roomWxid, memberWxids), {
    room_wxid: roomWxid,
    member_count: memberWxids.length,
  });
  if (!result.ok) {
    logger.error(`${operation} failed`, {
      room_wxid: roomWxid,
      member_count: memberWxids.length,
      status: result.status,
    });
    writeJson(res, 500, { detail: `${operation} failed with status ${result.status}` });
    return;
  }

  logger.info(operation, {
    room_wxid: roomWxid,
    member_count: memberWxids.length,
  });
  writeJson(res, 200, { status: 'success', message: successMessage });
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function buildSendSuccessBody(message, sentMessage, extra = {}) {
  const body = {
    status: 'success',
    message,
    ...extra,
  };

  if (sentMessage?.local_id) {
    body.local_id = sentMessage.local_id;
  }

  if (sentMessage) {
    body.sent_message = sentMessage;
  }

  if (sentMessage?.msgid) {
    body.message_id = sentMessage.msgid;
  }

  return body;
}

export function createBridgeRequestHandler({ bridge, config, runtimeState, saveRuntimeState, inboundMessages, outboundSendQueue }) {
  async function dispatchOutbound(operation, task, fields) {
    if (!outboundSendQueue) {
      return task();
    }

    return outboundSendQueue.schedule(operation, () => Promise.resolve(task()), fields);
  }

  async function dispatchTrackedSend(operation, chatWxid, task, fields) {
    return dispatchOutbound(operation, async () => {
      let sentMessageBaseline = null;
      if (typeof bridge.getLatestSelfHistoryMessage === 'function') {
        try {
          sentMessageBaseline = bridge.getLatestSelfHistoryMessage(chatWxid, {
            requireMessageId: false,
          });
        } catch (error) {
          logger.warn(`${operation} sent message baseline failed`, {
            to_wxid: chatWxid,
            error: formatErrorMessage(error),
          });
        }
      }

      const sendStartedAtMs = Date.now();
      const result = await Promise.resolve(task());

      return {
        ...result,
        sentMessageBaseline,
        sendStartedAtMs,
      };
    }, fields);
  }

  async function resolveSentMessage(operation, chatWxid, trackedResult, criteria = {}) {
    if (!trackedResult?.ok || typeof bridge.waitForSentMessage !== 'function') {
      return null;
    }

    try {
      const sentMessage = await bridge.waitForSentMessage(chatWxid, {
        ...criteria,
        afterLocalId: Number(trackedResult?.sentMessageBaseline?.local_id || 0),
        minTimestamp: Math.max(Math.floor(Number(trackedResult?.sendStartedAtMs || Date.now()) / 1000) - 1, 0),
      }, {
        timeoutMs: 8000,
        pollIntervalMs: 200,
        limit: 20,
        requireMessageId: true,
      });

      if (!sentMessage) {
        logger.warn(`${operation} sent message lookup missed`, {
          to_wxid: chatWxid,
          after_local_id: Number(trackedResult?.sentMessageBaseline?.local_id || 0),
          expected_type: Number.isFinite(Number(criteria.expectedType)) ? Number(criteria.expectedType) : '',
          expected_media_kind: resolveNonEmptyString(criteria.expectedMediaKind),
        });
      }

      return sentMessage;
    } catch (error) {
      logger.warn(`${operation} sent message lookup failed`, {
        to_wxid: chatWxid,
        error: formatErrorMessage(error),
      });
      return null;
    }
  }

  async function resolveFallbackSentMessage(operation, chatWxid, trackedResult, criteria = {}) {
    if (!trackedResult?.ok || typeof bridge.waitForSentMessage !== 'function') {
      return null;
    }

    try {
      return await bridge.waitForSentMessage(chatWxid, {
        ...criteria,
        afterLocalId: Number(trackedResult?.sentMessageBaseline?.local_id || 0),
        minTimestamp: Math.max(Math.floor(Number(trackedResult?.sendStartedAtMs || Date.now()) / 1000) - 1, 0),
      }, {
        timeoutMs: 1500,
        pollIntervalMs: 200,
        limit: 20,
        requireMessageId: false,
      });
    } catch (error) {
      logger.warn(`${operation} sent message local lookup failed`, {
        to_wxid: chatWxid,
        error: formatErrorMessage(error),
      });
      return null;
    }
  }

  const routes = new Map([
    ['GET /', async (_req, res) => {
      writeJson(res, 200, await bridge.getHealth());
    }],
    ['GET /login_info', async (_req, res) => {
      const loginInfo = await bridge.getLoginInfo();
      if (!loginInfo.wxid) {
        writeJson(res, 503, { detail: 'Not logged in yet' });
        return;
      }
      writeJson(res, 200, loginInfo);
    }],
    ['GET /contacts', async (_req, res) => {
      writeJson(res, 200, { contacts: bridge.getContacts() });
    }],
    ['GET /contact_tags', async (_req, res) => {
      writeJson(res, 200, { tags: bridge.getContactTags() });
    }],
    ['GET /rooms', async (_req, res) => {
      writeJson(res, 200, { rooms: bridge.getRooms() });
    }],
    ['GET /room_members', async (req, res) => {
      const roomWxid = normalizeConversationId(getRequestUrl(req).searchParams.get('room_wxid'));
      if (!roomWxid) {
        writeJson(res, 422, { detail: 'room_wxid is required' });
        return;
      }

      writeJson(res, 200, {
        room_wxid: roomWxid,
        members: bridge.getRoomMembers(roomWxid),
      });
    }],
    ['POST /rooms/invite_members', async (req, res) => handleRoomMemberMutation({
      req,
      res,
      bridge,
      config,
      operation: 'invite_room_members',
      action: (roomWxid, memberWxids) => bridge.inviteRoomMembers(roomWxid, memberWxids),
      successMessage: 'Members invited',
      logger,
      dispatchOutbound,
    })],
    ['POST /rooms/add_members', async (req, res) => handleRoomMemberMutation({
      req,
      res,
      bridge,
      config,
      operation: 'add_room_members',
      action: (roomWxid, memberWxids) => bridge.addRoomMembers(roomWxid, memberWxids),
      successMessage: 'Members added',
      logger,
      dispatchOutbound,
    })],
    ['POST /rooms/remove_members', async (req, res) => handleRoomMemberMutation({
      req,
      res,
      bridge,
      config,
      operation: 'remove_room_members',
      action: (roomWxid, memberWxids) => bridge.removeRoomMembers(roomWxid, memberWxids),
      successMessage: 'Members removed',
      logger,
      dispatchOutbound,
    })],
    ['GET /history', async (req, res) => {
      const params = parseHistoryParams(req);
      if (!params.chatWxid) {
        writeJson(res, 422, { detail: 'chat_wxid is required' });
        return;
      }

      writeJson(res, 200, {
        chat_wxid: params.chatWxid,
        history: bridge.getHistory(params.chatWxid, params),
      });
    }],
    ['POST /send_text', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const toWxid = normalizeConversationId(body?.to_wxid);
      const content = typeof body?.content === 'string' ? body.content : '';
      const atList = normalizeAtList(body?.at_list);

      if (!toWxid || !content) {
        writeJson(res, 422, { detail: 'to_wxid and content are required' });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      const result = await dispatchTrackedSend('send_text', toWxid, () => bridge.sendText(toWxid, content, atList), {
        to_wxid: toWxid,
        at_count: atList.length,
      });
      if (!result.ok) {
        logger.error('send_text failed', {
          to_wxid: toWxid,
          status: result.status,
          at_count: atList.length,
        });
        writeJson(res, 500, { detail: `send_text failed with status ${result.status}` });
        return;
      }

      const sendTextCriteria = {
        expectedType: WechatMessageType.Text,
        expectedContent: content,
      };
      const sentMessage = await resolveSentMessage('send_text', toWxid, result, sendTextCriteria)
        || await resolveFallbackSentMessage('send_text', toWxid, result, sendTextCriteria);

      logger.info('send_text', {
        to_wxid: toWxid,
        content_length: content.length,
        at_count: atList.length,
        message_id: sentMessage?.msgid || '',
      });
      writeJson(res, 200, buildSendSuccessBody('Message sent', sentMessage));
    }],
    ['POST /send_rich_text', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const toWxid = normalizeConversationId(body?.to_wxid);
      const title = resolveNonEmptyString(body?.title);
      const url = resolveNonEmptyString(body?.url);
      const digest = resolveNonEmptyString(body?.digest);
      const thumbUrl = resolveNonEmptyString(body?.thumb_url);
      const name = resolveNonEmptyString(body?.name);
      const account = resolveNonEmptyString(body?.account);

      if (!toWxid || !title || !url) {
        writeJson(res, 422, { detail: 'to_wxid, title, and url are required' });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      const result = await dispatchTrackedSend('send_rich_text', toWxid, () => bridge.sendRichText(toWxid, {
        title,
        url,
        digest,
        thumburl: thumbUrl,
        name,
        account,
      }), {
        to_wxid: toWxid,
        title,
        url,
      });
      if (!result.ok) {
        logger.error('send_rich_text failed', {
          to_wxid: toWxid,
          title,
          url,
          status: result.status,
        });
        writeJson(res, 500, { detail: `send_rich_text failed with status ${result.status}` });
        return;
      }

      const sendRichTextCriteria = {
        expectedType: WechatMessageType.App,
        expectedContent: title,
      };
      const sentMessage = await resolveSentMessage('send_rich_text', toWxid, result, sendRichTextCriteria)
        || await resolveFallbackSentMessage('send_rich_text', toWxid, result, sendRichTextCriteria);

      logger.info('send_rich_text', {
        to_wxid: toWxid,
        title,
        url,
        message_id: sentMessage?.msgid || '',
      });
      writeJson(res, 200, buildSendSuccessBody('Rich text sent', sentMessage));
    }],
    ['POST /send_image', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const toWxid = normalizeConversationId(body?.to_wxid);
      const imagePathResult = validateLocalFilePath(body?.image_path, 'image_path');

      if (!toWxid || !imagePathResult.ok) {
        writeJson(res, 422, { detail: !toWxid ? 'to_wxid is required' : imagePathResult.detail });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      const result = await dispatchTrackedSend('send_image', toWxid, () => bridge.sendImage(toWxid, imagePathResult.path), {
        to_wxid: toWxid,
        image_path: imagePathResult.path,
      });
      if (!result.ok) {
        logger.error('send_image failed', {
          to_wxid: toWxid,
          image_path: imagePathResult.path,
          status: result.status,
        });
        writeJson(res, 500, { detail: `send_image failed with status ${result.status}` });
        return;
      }

      const sendImageCriteria = {
        expectedType: WechatMessageType.Image,
        expectedMediaKind: 'image',
      };
      const sentMessage = await resolveSentMessage('send_image', toWxid, result, sendImageCriteria)
        || await resolveFallbackSentMessage('send_image', toWxid, result, sendImageCriteria);

      logger.info('send_image', {
        to_wxid: toWxid,
        image_path: imagePathResult.path,
        message_id: sentMessage?.msgid || '',
      });
      writeJson(res, 200, buildSendSuccessBody('Image sent', sentMessage));
    }],
    ['POST /decrypt_image', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const messageId = resolveNonEmptyString(body?.message_id);
      const timeoutSeconds = resolveBoundedInteger(body?.timeout_seconds, {
        defaultValue: 30,
        min: 1,
        max: 120,
      });
      const responseMode = resolveDownloadResponseMode(body?.response_mode);

      if (!messageId) {
        writeJson(res, 422, { detail: 'message_id is required' });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      const rawMessage = requireRecentInboundRawMessage(
        inboundMessages,
        messageId,
        res,
        logger,
        'decrypt_image',
      );
      if (!rawMessage) {
        return;
      }

      try {
        const image = await bridge.decryptImage(rawMessage, {
          timeoutSeconds,
          downloadDir: config.mediaDownloadDir,
        });

        logger.info('decrypt_image', {
          message_id: messageId,
          saved_path: image.saved_path,
          response_mode: responseMode,
        });

        if (responseMode === 'binary') {
          await streamLocalFileResponse(res, {
            filePath: image.saved_path,
            fileName: image.file_name,
            mediaKind: image.media?.kind || 'image',
            messageId,
          });
          return;
        }

        writeJson(res, 200, {
          status: 'success',
          message: 'Image decrypted',
          image,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message === 'Unsupported image message type'
          || message === 'Image extra path is unavailable'
        ) {
          logger.warn('decrypt_image unsupported', {
            message_id: messageId,
            error: message,
          });
          writeJson(res, 422, { detail: message });
          return;
        }

        logger.error('decrypt_image failed', {
          message_id: messageId,
          error: message,
        });
        throw error;
      }
    }],
    ['POST /ocr_image', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const messageId = resolveNonEmptyString(body?.message_id);

      if (!messageId) {
        writeJson(res, 422, { detail: 'message_id is required' });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      const rawMessage = requireRecentInboundRawMessage(
        inboundMessages,
        messageId,
        res,
        logger,
        'ocr_image',
      );
      if (!rawMessage) {
        return;
      }

      try {
        const ocr = bridge.ocrImage(rawMessage);
        const normalizedResult = normalizeOcrResult(ocr.result);

        logger.info('ocr_image', {
          message_id: messageId,
          text_length: normalizedResult.text.length,
          line_count: normalizedResult.lines.length,
        });
        writeJson(res, 200, {
          status: 'success',
          message: 'Image OCR completed',
          ocr: {
            message_id: ocr.message_id,
            media: ocr.media,
            extra_path: ocr.extra_path,
            ...normalizedResult,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message === 'Unsupported image message type'
          || message === 'Image extra path is unavailable for OCR'
        ) {
          logger.warn('ocr_image unsupported', {
            message_id: messageId,
            error: message,
          });
          writeJson(res, 422, { detail: message });
          return;
        }

        logger.error('ocr_image failed', {
          message_id: messageId,
          error: message,
        });
        throw error;
      }
    }],
    ['POST /send_file', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const toWxid = normalizeConversationId(body?.to_wxid);
      const filePathResult = validateLocalFilePath(body?.file_path, 'file_path');

      if (!toWxid || !filePathResult.ok) {
        writeJson(res, 422, { detail: !toWxid ? 'to_wxid is required' : filePathResult.detail });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      const result = await dispatchTrackedSend('send_file', toWxid, () => bridge.sendFile(toWxid, filePathResult.path), {
        to_wxid: toWxid,
        file_path: filePathResult.path,
      });
      if (!result.ok) {
        logger.error('send_file failed', {
          to_wxid: toWxid,
          file_path: filePathResult.path,
          status: result.status,
        });
        writeJson(res, 500, { detail: `send_file failed with status ${result.status}` });
        return;
      }

      const sendFileCriteria = {
        expectedType: WechatMessageType.File,
        expectedMediaKind: 'file',
      };
      const sentMessage = await resolveSentMessage('send_file', toWxid, result, sendFileCriteria)
        || await resolveFallbackSentMessage('send_file', toWxid, result, sendFileCriteria);

      logger.info('send_file', {
        to_wxid: toWxid,
        file_path: filePathResult.path,
        message_id: sentMessage?.msgid || '',
      });
      writeJson(res, 200, buildSendSuccessBody('File sent', sentMessage));
    }],
    ['POST /send_media_upload', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req, {
        maxBodyBytes: 25 * 1024 * 1024,
      });
      const toWxid = normalizeConversationId(body?.to_wxid);
      const mediaKind = resolveUploadMediaKind(body?.media_kind);
      const fileName = sanitizeUploadFileName(body?.file_name, mediaKind);
      const contentBase64 = resolveNonEmptyString(body?.content_base64);

      if (!toWxid || !mediaKind || !contentBase64) {
        writeJson(res, 422, {
          detail: 'to_wxid, media_kind ("image" or "file"), and content_base64 are required',
        });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      let upload;
      try {
        upload = await saveUploadedOutboundMedia({
          mediaDownloadDir: config.mediaDownloadDir,
          mediaKind,
          fileName,
          contentBase64,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeJson(res, message.includes('content_base64') ? 422 : 500, { detail: message });
        return;
      }
      const sendOperation = mediaKind === 'image'
        ? () => bridge.sendImage(toWxid, upload.saved_path)
        : () => bridge.sendFile(toWxid, upload.saved_path);
      const result = await dispatchTrackedSend('send_media_upload', toWxid, sendOperation, {
        to_wxid: toWxid,
        media_kind: mediaKind,
        file_name: upload.file_name,
        bytes: upload.bytes,
      });
      if (!result.ok) {
        logger.error('send_media_upload failed', {
          to_wxid: toWxid,
          media_kind: mediaKind,
          file_name: upload.file_name,
          saved_path: upload.saved_path,
          bytes: upload.bytes,
          status: result.status,
        });
        writeJson(res, 500, { detail: `send_media_upload failed with status ${result.status}` });
        return;
      }

      const sendMediaUploadCriteria = {
        expectedType: mediaKind === 'image' ? WechatMessageType.Image : WechatMessageType.File,
        expectedMediaKind: mediaKind,
      };
      const sentMessage = await resolveSentMessage('send_media_upload', toWxid, result, sendMediaUploadCriteria)
        || await resolveFallbackSentMessage('send_media_upload', toWxid, result, sendMediaUploadCriteria);

      logger.info('send_media_upload', {
        to_wxid: toWxid,
        media_kind: mediaKind,
        file_name: upload.file_name,
        saved_path: upload.saved_path,
        bytes: upload.bytes,
        message_id: sentMessage?.msgid || '',
      });
      writeJson(res, 200, buildSendSuccessBody('Uploaded media sent', sentMessage, {
        upload: {
          media_kind: mediaKind,
          ...upload,
        },
      }));
    }],
    ['POST /download_audio', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const messageId = resolveNonEmptyString(body?.message_id);
      const timeoutSeconds = resolveBoundedInteger(body?.timeout_seconds, {
        defaultValue: 30,
        min: 1,
        max: 120,
      });
      const responseMode = resolveDownloadResponseMode(body?.response_mode);

      if (!messageId) {
        writeJson(res, 422, { detail: 'message_id is required' });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      const rawMessage = requireRecentInboundRawMessage(
        inboundMessages,
        messageId,
        res,
        logger,
        'download_audio',
      );
      if (!rawMessage) {
        return;
      }

      try {
        const audio = await bridge.extractAudio(rawMessage, {
          timeoutSeconds,
          downloadDir: config.mediaDownloadDir,
        });

        logger.info('download_audio', {
          message_id: messageId,
          saved_path: audio.saved_path,
          response_mode: responseMode,
        });

        if (responseMode === 'binary') {
          await streamLocalFileResponse(res, {
            filePath: audio.saved_path,
            fileName: audio.file_name,
            mediaKind: audio.media?.kind || 'voice',
            messageId,
          });
          return;
        }

        writeJson(res, 200, {
          status: 'success',
          message: 'Audio downloaded',
          audio,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'Unsupported audio message type') {
          logger.warn('download_audio unsupported', {
            message_id: messageId,
            error: message,
          });
          writeJson(res, 422, { detail: message });
          return;
        }

        logger.error('download_audio failed', {
          message_id: messageId,
          error: message,
        });
        throw error;
      }
    }],
    ['POST /forward_message', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const toWxid = normalizeConversationId(body?.to_wxid);
      const messageId = resolveNonEmptyString(body?.message_id);

      if (!toWxid || !messageId) {
        writeJson(res, 422, { detail: 'to_wxid and message_id are required' });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      const result = await dispatchTrackedSend('forward_message', toWxid, () => bridge.forwardMessage(toWxid, messageId), {
        to_wxid: toWxid,
        message_id: messageId,
      });
      if (!result.ok) {
        logger.error('forward_message failed', {
          to_wxid: toWxid,
          message_id: messageId,
          status: result.status,
        });
        writeJson(res, 500, { detail: `forward_message failed with status ${result.status}` });
        return;
      }

      const sentMessage = await resolveSentMessage('forward_message', toWxid, result)
        || await resolveFallbackSentMessage('forward_message', toWxid, result);

      logger.info('forward_message', {
        to_wxid: toWxid,
        message_id: messageId,
        forwarded_message_id: sentMessage?.msgid || '',
      });
      writeJson(res, 200, buildSendSuccessBody('Message forwarded', sentMessage));
    }],
    ['POST /revoke_message', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const messageId = resolveNonEmptyString(body?.message_id);
      const localId = resolveBoundedInteger(body?.local_id, {
        defaultValue: undefined,
        min: 1,
      });

      if (!messageId && !localId) {
        writeJson(res, 422, { detail: 'message_id or local_id is required' });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      // Resolve local_id from svrid via DB lookup to avoid uint64 precision loss.
      let resolvedLocalId = localId;
      if (!resolvedLocalId && messageId && typeof bridge.lookupLocalIdBySvrId === 'function') {
        resolvedLocalId = bridge.lookupLocalIdBySvrId(messageId);
      }

      const result = resolvedLocalId
        ? await dispatchOutbound('revoke_message', () => bridge.revokeMessageByLocalId(resolvedLocalId), {
            message_id: messageId ?? '',
            local_id: resolvedLocalId,
          })
        : await dispatchOutbound('revoke_message', () => bridge.revokeMessage(messageId), {
            message_id: messageId,
            local_id: '',
          });
      if (!result.ok) {
        logger.error('revoke_message failed', {
          message_id: messageId ?? '',
          local_id: localId ?? '',
          status: result.status,
        });
        writeJson(res, 500, { detail: `revoke_message failed with status ${result.status}` });
        return;
      }

      logger.info('revoke_message', {
        message_id: messageId ?? '',
        local_id: localId ?? '',
      });
      writeJson(res, 200, { status: 'success', message: 'Message revoked' });
    }],
    ['POST /download_media', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const messageId = resolveNonEmptyString(body?.message_id);
      const timeoutSeconds = resolveBoundedInteger(body?.timeout_seconds, {
        defaultValue: 30,
        min: 1,
        max: 120,
      });
      const responseMode = resolveDownloadResponseMode(body?.response_mode);

      if (!messageId) {
        writeJson(res, 422, { detail: 'message_id is required' });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      const rawMessage = requireRecentInboundRawMessage(
        inboundMessages,
        messageId,
        res,
        logger,
        'download_media',
      );
      if (!rawMessage) {
        return;
      }

      try {
        const download = await bridge.downloadMedia(rawMessage, {
          timeoutSeconds,
          downloadDir: config.mediaDownloadDir,
        });

        logger.info('download_media', {
          message_id: messageId,
          media_kind: download.media?.kind || '',
          saved_path: download.saved_path,
          response_mode: responseMode,
        });

        if (responseMode === 'binary') {
          await streamLocalFileResponse(res, {
            filePath: download.saved_path,
            fileName: download.file_name,
            mediaKind: download.media?.kind || '',
            messageId,
          });
          return;
        }

        writeJson(res, 200, {
          status: 'success',
          message: 'Media downloaded',
          download,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'Unsupported media message type') {
          logger.warn('download_media unsupported', {
            message_id: messageId,
          });
          writeJson(res, 422, { detail: message });
          return;
        }

        logger.error('download_media failed', {
          message_id: messageId,
          error: message,
        });
        throw error;
      }
    }],
    ['POST /resolve_mp_article', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const messageId = resolveNonEmptyString(body?.message_id);
      const timeoutSeconds = resolveBoundedInteger(body?.timeout_seconds, {
        defaultValue: 30,
        min: 5,
        max: 120,
      });
      let url = resolveNonEmptyString(body?.url);

      if (!url && messageId) {
        const record = inboundMessages.get(messageId);
        if (!record) {
          logger.warn('resolve_mp_article cache miss', {
            message_id: messageId,
          });
          writeJson(res, 404, { detail: 'message_id not found in recent inbound cache' });
          return;
        }
        url = resolveNonEmptyString(record?.payload?.data?.link_meta?.url);
      }

      if (!url) {
        writeJson(res, 422, { detail: 'message_id or url is required' });
        return;
      }
      if (!requireLogin(bridge, res)) {
        return;
      }

      try {
        const article = await bridge.resolveMpArticle(url, {
          timeoutSeconds,
        });
        logger.info('resolve_mp_article', {
          message_id: messageId,
          url,
          title: article?.title || '',
        });
        writeJson(res, 200, {
          status: 'success',
          article,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('resolve_mp_article failed', {
          message_id: messageId,
          url,
          error: message,
        });
        writeJson(res, message.includes('Playwright is not installed') ? 503 : 500, {
          detail: message,
        });
      }
    }],
    ['POST /set_webhook', async (req, res) => {
      if (!requireJson(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const targetUrl = resolveNonEmptyString(body?.target_url);
      runtimeState.webhookUrl = targetUrl;
      saveRuntimeState(runtimeState);
      logger.info('set_webhook', {
        webhook_url: runtimeState.webhookUrl,
      });
      writeJson(res, 200, {
        status: 'success',
        webhook_url: runtimeState.webhookUrl,
      });
    }],
  ]);

  return async function handleBridgeRequest(req, res) {
    const pathname = getPathname(req);
    const routeKey = `${req.method} ${pathname}`;
    const handler = routes.get(routeKey);
    const startedAt = Date.now();

    try {
      if (!handler) {
        writeJson(res, 404, { detail: 'Not found' });
        return;
      }

      await handler(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'Invalid JSON'
        ? 400
        : message === 'Request body too large'
          ? 413
          : 500;
      writeJson(res, status, { detail: message });
    } finally {
      const statusCode = res.statusCode || 200;
      logger.log(selectRequestLogLevel(req.method || 'GET', pathname, statusCode), 'request', {
        method: req.method || 'GET',
        path: pathname,
        status: statusCode,
        duration_ms: Date.now() - startedAt,
      });
    }
  };
}

