import EventEmitter from 'node:events';
import { copyFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { WechatferryAgent } from 'wechatferry/agent';
import {
  buildWebhookPayload,
  normalizeMediaDescriptor,
  normalizeContact,
  normalizeHistoryMessage,
  normalizeRoomMember,
  normalizeRoom,
  normalizeSelfInfo,
} from '../messages/contract.mjs';
import {
  ensureMediaStorageDir,
  saveDownloadedFileBox,
  saveGeneratedLocalFile,
} from '../media/media-downloads.mjs';
import { resolveMpArticleWithBrowser } from '../media/mp-article-resolver.mjs';
import { findMatchingSelfHistoryMessage } from './self-message-matcher.mjs';

function createLocalFileBox(filePath) {
  return {
    name: basename(filePath),
    async toFile(targetPath) {
      await copyFile(filePath, targetPath);
    },
  };
}

function wrapStatus(status, successStatus = 0) {
  return {
    ok: status === successStatus,
    status,
  };
}

function clampPositiveInteger(value, defaultValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return defaultValue;
  }

  return Math.min(Math.max(Math.trunc(normalized), min), max);
}

export class WechatFerryBridge extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.agent = new WechatferryAgent({ keepalive: config.keepalive });
    this.selfInfoRaw = null;
    this.selfInfo = normalizeSelfInfo(null);
    this.started = false;

    this.handleLogin = this.handleLogin.bind(this);
    this.handleLogout = this.handleLogout.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.agent.on('login', this.handleLogin);
    this.agent.on('logout', this.handleLogout);
    this.agent.on('error', this.handleError);
    this.agent.on('message', this.handleMessage);
    this.agent.start();
  }

  stop() {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.agent.off('login', this.handleLogin);
    this.agent.off('logout', this.handleLogout);
    this.agent.off('error', this.handleError);
    this.agent.off('message', this.handleMessage);
    this.agent.stop();
  }

  handleLogin(userInfo) {
    this.selfInfoRaw = userInfo;
    this.selfInfo = normalizeSelfInfo(userInfo);
    this.emit('login', this.selfInfo);
  }

  handleLogout() {
    this.selfInfoRaw = null;
    this.selfInfo = normalizeSelfInfo(null);
    this.emit('logout');
  }

  handleError(error) {
    this.emit('error', error);
  }

  async handleMessage(message) {
    try {
      const selfInfo = await this.getLoginInfo();
      const payload = buildWebhookPayload(message, selfInfo, this.config.channelName);
      this.emit('message', { payload, raw: message });
    } catch (error) {
      this.emit('error', error);
    }
  }

  isLogin() {
    try {
      return Boolean(this.agent.wcf.isLogin());
    } catch {
      return false;
    }
  }

  async getLoginInfo() {
    if (!this.isLogin()) {
      this.selfInfoRaw = null;
      this.selfInfo = normalizeSelfInfo(null);
      return this.selfInfo;
    }

    if (this.selfInfoRaw?.wxid) {
      return this.selfInfo;
    }

    this.selfInfoRaw = this.agent.wcf.getUserInfo();
    this.selfInfo = normalizeSelfInfo(this.selfInfoRaw);
    return this.selfInfo;
  }

  async getHealth() {
    const selfInfo = await this.getLoginInfo();
    return {
      status: 'ok',
      login: Boolean(selfInfo.wxid),
      wxid: selfInfo.wxid,
    };
  }

  getContacts() {
    return this.agent.getContactList().map(normalizeContact);
  }

  getContactTags() {
    return this.agent.getContactTagList().map((tag) => ({
      id: String(tag?.labelId || ''),
      name: String(tag?.labelName || ''),
    }));
  }

  getRooms() {
    return this.agent.getChatRoomList().map(normalizeRoom);
  }

  getRoomMembers(roomWxid) {
    const members = this.agent.getChatRoomMembers(roomWxid);
    return Array.isArray(members) ? members.map(normalizeRoomMember) : [];
  }

  inviteRoomMembers(roomWxid, memberWxids) {
    return wrapStatus(this.agent.inviteChatRoomMembers(roomWxid, memberWxids), 1);
  }

  addRoomMembers(roomWxid, memberWxids) {
    return wrapStatus(this.agent.addChatRoomMembers(roomWxid, memberWxids), 1);
  }

  removeRoomMembers(roomWxid, memberWxids) {
    return wrapStatus(this.agent.removeChatRoomMembers(roomWxid, memberWxids), 1);
  }

  sendText(toWxid, content, atList = []) {
    return wrapStatus(this.agent.sendText(toWxid, content, atList), 0);
  }

  sendRichText(toWxid, payload) {
    return wrapStatus(this.agent.sendRichText(toWxid, payload), 0);
  }

  async sendImage(toWxid, imagePath) {
    return wrapStatus(await this.agent.sendImage(toWxid, createLocalFileBox(imagePath)), 0);
  }

  async sendFile(toWxid, filePath) {
    return wrapStatus(await this.agent.sendFile(toWxid, createLocalFileBox(filePath)), 0);
  }

  forwardMessage(toWxid, messageId) {
    return wrapStatus(this.agent.forwardMsg(toWxid, String(messageId)), 1);
  }

  revokeMessage(messageId) {
    return wrapStatus(this.agent.revokeMsg(String(messageId)), 1);
  }

  revokeMessageByLocalId(localId) {
    return wrapStatus(this.agent.revokeMsg(String(localId)), 1);
  }

  getHistory(chatWxid, options = {}) {
    const limit = Number.isFinite(Number(options.limit))
      ? Math.min(Math.max(Number(options.limit), 1), 200)
      : 50;
    const beforeCreateTime = Number.isFinite(Number(options.beforeCreateTime))
      ? Number(options.beforeCreateTime)
      : undefined;
    const dbNumber = Number.isFinite(Number(options.dbNumber))
      ? Number(options.dbNumber)
      : undefined;

    const history = this.agent.getHistoryMessageList(
      chatWxid,
      (sql) => {
        if (beforeCreateTime) {
          sql.andWhere('MSG.CreateTime', '<', beforeCreateTime);
        }
        sql.limit(limit);
      },
      dbNumber,
    );

    return history
      .sort((left, right) => Number(right?.createTime || 0) - Number(left?.createTime || 0))
      .slice(0, limit)
      .map(normalizeHistoryMessage);
  }

  getLatestSelfHistoryMessage(chatWxid, options = {}) {
    const history = this.getHistory(chatWxid, {
      limit: clampPositiveInteger(options.limit, 20, { min: 1, max: 200 }),
      dbNumber: options.dbNumber,
    });

    return findMatchingSelfHistoryMessage(history, {
      expectedChatWxid: chatWxid,
      requireMessageId: options.requireMessageId,
    });
  }

  getSelfMessageByLocalId(localId) {
    const normalizedLocalId = clampPositiveInteger(localId, 0, { min: 0 });
    if (!normalizedLocalId) {
      return null;
    }

    const message = this.agent.getLastSelfMessage(normalizedLocalId);
    if (!message?.localId) {
      return null;
    }

    return normalizeHistoryMessage(message);
  }

  async waitForSelfMessageByLocalId(localId, options = {}) {
    const normalizedLocalId = clampPositiveInteger(localId, 0, { min: 0 });
    if (!normalizedLocalId) {
      return null;
    }

    const timeoutMs = clampPositiveInteger(options.timeoutMs, 5000, { min: 200, max: 30000 });
    const pollIntervalMs = clampPositiveInteger(options.pollIntervalMs, 250, { min: 50, max: 5000 });
    const requireMessageId = options.requireMessageId !== false;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const message = this.getSelfMessageByLocalId(normalizedLocalId);
      if (message && (!requireMessageId || message.msgid)) {
        return message;
      }

      if (Date.now() >= deadline) {
        break;
      }

      await sleep(pollIntervalMs);
    }

    return null;
  }

  async waitForSentMessage(chatWxid, criteria = {}, options = {}) {
    const timeoutMs = clampPositiveInteger(options.timeoutMs, 5000, { min: 200, max: 30000 });
    const pollIntervalMs = clampPositiveInteger(options.pollIntervalMs, 250, { min: 50, max: 5000 });
    const limit = clampPositiveInteger(options.limit, 20, { min: 1, max: 200 });
    const requireMessageId = options.requireMessageId !== false;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const history = this.getHistory(chatWxid, {
        limit,
        dbNumber: options.dbNumber,
      });
      const match = findMatchingSelfHistoryMessage(history, {
        ...criteria,
        expectedChatWxid: chatWxid,
        requireMessageId: false,
      });

      if (match) {
        if (!requireMessageId || match.msgid) {
          return match;
        }

        const remainingMs = Math.max(deadline - Date.now(), 0);
        const upgraded = await this.waitForSelfMessageByLocalId(match.local_id, {
          timeoutMs: remainingMs || pollIntervalMs,
          pollIntervalMs,
          requireMessageId: true,
        });

        if (upgraded?.msgid) {
          return upgraded;
        }
      }

      if (Date.now() >= deadline) {
        break;
      }

      await sleep(pollIntervalMs);
    }

    return null;
  }

  async downloadMedia(rawMessage, options = {}) {
    const media = normalizeMediaDescriptor(rawMessage);
    if (!media) {
      throw new Error('Unsupported media message type');
    }

    const timeoutSeconds = Number.isFinite(Number(options.timeoutSeconds))
      ? Math.min(Math.max(Number(options.timeoutSeconds), 1), 120)
      : 30;
    const fileBox = await this.agent.downloadFile(rawMessage, timeoutSeconds);
    const saved = await saveDownloadedFileBox(fileBox, rawMessage, {
      mediaDownloadDir: options.downloadDir || this.config.mediaDownloadDir,
    });

    return {
      message_id: String(rawMessage?.id || ''),
      media,
      ...saved,
    };
  }

  async decryptImage(rawMessage, options = {}) {
    const media = normalizeMediaDescriptor(rawMessage);
    if (media?.kind !== 'image') {
      throw new Error('Unsupported image message type');
    }

    const timeoutSeconds = Number.isFinite(Number(options.timeoutSeconds))
      ? Math.min(Math.max(Number(options.timeoutSeconds), 1), 120)
      : 30;
    const downloadConfig = {
      mediaDownloadDir: options.downloadDir || this.config.mediaDownloadDir,
    };
    const outputDir = await ensureMediaStorageDir(downloadConfig, 'images');
    const messageId = String(rawMessage?.id || '');
    const thumbPath = rawMessage?.thumb || rawMessage?.thumb_path || '';
    const extraPath = rawMessage?.extra || rawMessage?.extra_path || '';

    if (!extraPath) {
      throw new Error('Image extra path is unavailable');
    }
    if (this.agent.wcf.downloadAttach(messageId, thumbPath, extraPath) !== 0) {
      throw new Error('Image download failed');
    }

    for (let attempt = 0; attempt < timeoutSeconds; attempt += 1) {
      const sourcePath = this.agent.wcf.decryptImage(extraPath, outputDir);
      if (sourcePath) {
        const saved = await saveGeneratedLocalFile(sourcePath, rawMessage, downloadConfig, {
          subdir: 'images',
        });

        return {
          message_id: messageId,
          media,
          ...saved,
        };
      }

      await sleep(1000);
    }

    throw new Error('Image decrypt timeout');
  }

  async extractAudio(rawMessage, options = {}) {
    const media = normalizeMediaDescriptor(rawMessage);
    if (media?.kind !== 'voice') {
      throw new Error('Unsupported audio message type');
    }

    const timeoutSeconds = Number.isFinite(Number(options.timeoutSeconds))
      ? Math.min(Math.max(Number(options.timeoutSeconds), 1), 120)
      : 30;
    const downloadConfig = {
      mediaDownloadDir: options.downloadDir || this.config.mediaDownloadDir,
    };
    const outputDir = await ensureMediaStorageDir(downloadConfig, 'audio');
    const messageId = String(rawMessage?.id || '');

    for (let attempt = 0; attempt < timeoutSeconds; attempt += 1) {
      const sourcePath = this.agent.wcf.getAudioMsg(messageId, outputDir);
      if (sourcePath) {
        const saved = await saveGeneratedLocalFile(sourcePath, rawMessage, downloadConfig, {
          subdir: 'audio',
          preferredName: `voice-${messageId}.mp3`,
        });

        return {
          message_id: messageId,
          media,
          format: 'mp3',
          ...saved,
        };
      }

      await sleep(1000);
    }

    throw new Error('Audio extraction timeout');
  }

  ocrImage(rawMessage) {
    const media = normalizeMediaDescriptor(rawMessage);
    if (media?.kind !== 'image') {
      throw new Error('Unsupported image message type');
    }

    const extraPath = rawMessage?.extra || rawMessage?.extra_path || '';
    if (!extraPath) {
      throw new Error('Image extra path is unavailable for OCR');
    }

    const result = this.agent.wcf.execOCR(extraPath);
    if (!result) {
      throw new Error('OCR returned empty result');
    }

    return {
      message_id: String(rawMessage?.id || ''),
      media,
      extra_path: extraPath,
      result,
    };
  }

  async resolveMpArticle(url, options = {}) {
    return resolveMpArticleWithBrowser({
      url,
      timeoutMs: Number.isFinite(Number(options.timeoutSeconds))
        ? Number(options.timeoutSeconds) * 1000
        : undefined,
    });
  }


}

