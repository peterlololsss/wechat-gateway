import EventEmitter from 'node:events';
import { access, copyFile } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Wechatferry, WechatferrySDK } from 'wechatferry';
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
import { findMatchingSelfHistoryMessage, hasReadyMessageId } from './self-message-matcher.mjs';

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

function escapeSqlStringLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function compareCreateTimeDesc(left, right) {
  return Number(right?.createTime || 0) - Number(left?.createTime || 0);
}

function buildHistorySelectSql({ whereClause, limit, beforeCreateTime }) {
  const beforeClause = beforeCreateTime
    ? ` AND MSG.CreateTime < ${beforeCreateTime}`
    : '';

  return `
    SELECT
      MSG.localId AS localId,
      TalkerId.TalkerId AS talkerId,
      MSG.MsgSvrID AS msgSvrId,
      CAST(MSG.MsgSvrID AS TEXT) AS msgSvrIdStr,
      MSG.Type AS type,
      MSG.SubType AS subType,
      MSG.IsSender AS isSender,
      MSG.CreateTime AS createTime,
      MSG.Sequence AS sequence,
      MSG.StatusEx AS statusEx,
      MSG.FlagEx AS flagEx,
      MSG.Status AS status,
      MSG.MsgServerSeq AS msgServerSeq,
      MSG.MsgSequence AS msgSequence,
      MSG.StrTalker AS strTalker,
      MSG.StrContent AS strContent,
      MSG.BytesExtra AS bytesExtra,
      MSG.CompressContent AS compressContent
    FROM MSG
    JOIN (
      SELECT ROW_NUMBER() OVER (ORDER BY (SELECT 0)) AS TalkerId, UsrName
      FROM Name2ID
    ) AS TalkerId
      ON MSG.TalkerId = TalkerId.TalkerId
    WHERE ${whereClause}${beforeClause}
    ORDER BY MSG.CreateTime DESC
    LIMIT ${limit}
  `;
}

function normalizeCandidateIdentifier(value) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized !== '0' ? normalized : '';
}

function buildRevokeCandidateIds(record, preferredId) {
  const candidates = [
    preferredId,
    record?.msgSvrIdStr,
    record?.msgSvrId,
    record?.msgServerSeq,
    record?.msgSequence,
    record?.sequence,
    record?.localId,
  ]
    .map(normalizeCandidateIdentifier)
    .filter(Boolean);

  return [...new Set(candidates)];
}

function normalizeWindowsPath(value) {
  return String(value ?? '').trim().replace(/\//g, '\\');
}

function extractWechatFilesRoot(filePath) {
  const normalized = normalizeWindowsPath(filePath);
  if (!normalized) {
    return '';
  }

  const marker = '\\wechat files\\';
  const markerIndex = normalized.toLowerCase().indexOf(marker);
  if (markerIndex === -1) {
    return '';
  }

  return normalized.slice(0, markerIndex + marker.length - 1);
}

function buildDefaultWechatFilesRoots() {
  const candidates = [];
  const userProfile = String(process.env.USERPROFILE || '').trim();
  const oneDrive = String(process.env.OneDrive || '').trim();

  if (userProfile) {
    candidates.push(resolve(userProfile, 'Documents', 'WeChat Files'));
  }
  if (oneDrive) {
    candidates.push(resolve(oneDrive, 'Documents', 'WeChat Files'));
  }

  return [...new Set(candidates.map(normalizeWindowsPath).filter(Boolean))];
}

export class WechatFerryBridge extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    const agentOptions = { keepalive: config.keepalive };
    if (config.sdkRoot) {
      agentOptions.wcf = new Wechatferry({
        sdk: new WechatferrySDK({ sdkRoot: config.sdkRoot }),
      });
    }
    this.agent = new WechatferryAgent(agentOptions);
    this.selfInfoRaw = null;
    this.selfInfo = normalizeSelfInfo(null);
    this.wechatFilesRoots = new Set(buildDefaultWechatFilesRoots());
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
      this.observeWechatMediaPath(message?.thumb || message?.thumb_path || '');
      this.observeWechatMediaPath(message?.extra || message?.extra_path || '');
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
    return this.revokeMessageCandidates([messageId]);
  }

  revokeMessageByLocalId(localId) {
    const record = this.lookupMessageIdentifiersByLocalId(localId);
    const candidates = buildRevokeCandidateIds(record);
    if (candidates.length === 0) {
      return {
        ok: false,
        status: -2,
        attempted_ids: [],
      };
    }

    return this.revokeMessageCandidates(candidates);
  }

  lookupHistoryMessageBySvrId(svrId, chatWxid) {
    if (!chatWxid) return null;
    // Search recent history for this chatWxid and find the message with matching svrid
    const history = this.getHistory(chatWxid, { limit: 100 });
    return history.find(m => m.msgid === String(svrId)) ?? null;
  }

  observeWechatMediaPath(filePath) {
    const root = extractWechatFilesRoot(filePath);
    if (root) {
      this.wechatFilesRoots.add(root);
    }
  }

  async resolveHistoryMediaPath(filePath) {
    const normalizedPath = normalizeWindowsPath(filePath);
    if (!normalizedPath) {
      return '';
    }
    if (isAbsolute(normalizedPath)) {
      this.observeWechatMediaPath(normalizedPath);
      return normalizedPath;
    }

    const candidateRoots = [...this.wechatFilesRoots];
    const candidates = candidateRoots.map((root) => normalizeWindowsPath(resolve(root, normalizedPath)));
    for (const candidate of candidates) {
      try {
        await access(candidate);
        this.observeWechatMediaPath(candidate);
        return candidate;
      } catch {
        // Keep trying other known roots; the file may not exist until downloadAttach finishes.
      }
    }

    return candidates[0] || normalizedPath;
  }

  async decryptImageBySvrId(svrId, chatWxid, options = {}) {
    const historyMsg = this.lookupHistoryMessageBySvrId(svrId, chatWxid);
    if (!historyMsg) {
      throw new Error(`Message not found in history for svrid ${svrId}`);
    }
    if (!historyMsg.extra_path) {
      throw new Error('Image extra path is unavailable in history record');
    }

    const timeoutSeconds = Number.isFinite(Number(options.timeoutSeconds))
      ? Math.min(Math.max(Number(options.timeoutSeconds), 1), 120)
      : 30;
    const downloadConfig = {
      mediaDownloadDir: options.downloadDir || this.config.mediaDownloadDir,
    };
    const outputDir = await ensureMediaStorageDir(downloadConfig, 'images');

    const messageId = String(svrId || '');
    const thumbPath = await this.resolveHistoryMediaPath(historyMsg.thumb_path || '');
    const extraPath = await this.resolveHistoryMediaPath(historyMsg.extra_path);
    let hadSourceFile = false;
    try {
      await access(extraPath);
      hadSourceFile = true;
    } catch {
      hadSourceFile = false;
    }

    const downloadStatus = this.agent.wcf.downloadAttach(messageId, thumbPath, extraPath);
    if (downloadStatus !== 0 && !hadSourceFile) {
      throw new Error(`Image download failed with status ${downloadStatus}`);
    }

    for (let attempt = 0; attempt < timeoutSeconds; attempt += 1) {
      const sourcePath = this.agent.wcf.decryptImage(extraPath, outputDir);
      if (sourcePath) {
        const saved = await saveGeneratedLocalFile(sourcePath, {
          id: messageId,
          type: historyMsg.type,
          thumb: thumbPath,
          extra: extraPath,
        }, downloadConfig, {
          subdir: 'images',
        });

        return {
          message_id: messageId,
          local_id: historyMsg.local_id,
          media: {
            kind: 'image',
            thumb_path: thumbPath,
            extra_path: extraPath,
          },
          ...saved,
        };
      }
      await sleep(1000);
    }

    throw new Error('Image decrypt timeout');
  }

  lookupLocalIdBySvrId(svrId) {
    const normalizedSvrId = String(svrId ?? '').trim();
    if (!normalizedSvrId) {
      return null;
    }

    const rows = this.queryMessageRows(`
      SELECT localId AS localId, CreateTime AS createTime
      FROM MSG
      WHERE CAST(MsgSvrID AS TEXT) = ${escapeSqlStringLiteral(normalizedSvrId)}
      ORDER BY CreateTime DESC
      LIMIT 1
    `);
    const [match] = rows.sort(compareCreateTimeDesc);
    return match?.localId ? Number(match.localId) : null;
  }

  lookupSvrIdByLocalId(localId) {
    const record = this.lookupMessageIdentifiersByLocalId(localId);
    return String(record?.msgSvrIdStr || '').trim();
  }

  lookupMessageIdentifiersByLocalId(localId) {
    const normalizedLocalId = clampPositiveInteger(localId, 0, { min: 0 });
    if (!normalizedLocalId) {
      return null;
    }

    const rows = this.queryMessageRows(`
      SELECT
        localId AS localId,
        MsgSvrID AS msgSvrId,
        CAST(MsgSvrID AS TEXT) AS msgSvrIdStr,
        Sequence AS sequence,
        MsgServerSeq AS msgServerSeq,
        MsgSequence AS msgSequence,
        CreateTime AS createTime
      FROM MSG
      WHERE localId = ${normalizedLocalId}
      ORDER BY CreateTime DESC
      LIMIT 1
    `);
    const [match] = rows.sort(compareCreateTimeDesc);
    return match || null;
  }

  queryMessageRows(sql, dbNumber) {
    const rows = this.agent.dbSqlQueryMSG?.(sql, dbNumber);
    return Array.isArray(rows) ? rows : [];
  }

  revokeMessageCandidates(candidateIds = []) {
    const attemptedIds = [];
    let lastStatus = -1;

    for (const candidateId of candidateIds.map(normalizeCandidateIdentifier)) {
      if (!candidateId || attemptedIds.includes(candidateId)) {
        continue;
      }

      attemptedIds.push(candidateId);
      const status = this.agent.revokeMsg(candidateId);
      if (status === 1) {
        return {
          ok: true,
          status,
          attempted_ids: attemptedIds,
          revoked_id: candidateId,
        };
      }

      lastStatus = status;
    }

    return {
      ok: false,
      status: attemptedIds.length === 0 ? -2 : lastStatus,
      attempted_ids: attemptedIds,
    };
  }

  formatHistoryRow(message) {
    if (!message) {
      return null;
    }

    if (typeof this.agent.formatHistoryMessage === 'function') {
      return this.agent.formatHistoryMessage(message);
    }

    return message;
  }

  getHistory(chatWxid, options = {}) {
    const normalizedChatWxid = String(chatWxid ?? '').trim();
    if (!normalizedChatWxid) {
      return [];
    }

    const limit = Number.isFinite(Number(options.limit))
      ? Math.min(Math.max(Number(options.limit), 1), 200)
      : 50;
    const beforeCreateTime = Number.isFinite(Number(options.beforeCreateTime))
      ? Number(options.beforeCreateTime)
      : undefined;
    const dbNumber = Number.isFinite(Number(options.dbNumber))
      ? Number(options.dbNumber)
      : undefined;

    const history = this.queryMessageRows(buildHistorySelectSql({
      whereClause: `TalkerId.UsrName = ${escapeSqlStringLiteral(normalizedChatWxid)}`,
      limit,
      beforeCreateTime,
    }), dbNumber)
      .map((message) => this.formatHistoryRow(message))
      .filter(Boolean);

    return history
      .sort(compareCreateTimeDesc)
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

    const [message] = this.queryMessageRows(`
      SELECT
        localId AS localId,
        TalkerId AS talkerId,
        MsgSvrID AS msgSvrId,
        CAST(MsgSvrID AS TEXT) AS msgSvrIdStr,
        Type AS type,
        SubType AS subType,
        IsSender AS isSender,
        CreateTime AS createTime,
        Sequence AS sequence,
        StatusEx AS statusEx,
        FlagEx AS flagEx,
        Status AS status,
        MsgServerSeq AS msgServerSeq,
        MsgSequence AS msgSequence,
        StrTalker AS strTalker,
        StrContent AS strContent,
        BytesExtra AS bytesExtra,
        CompressContent AS compressContent
      FROM MSG
      WHERE IsSender = 1 AND localId = ${normalizedLocalId}
      ORDER BY CreateTime DESC
      LIMIT 1
    `)
      .sort(compareCreateTimeDesc)
      .map((entry) => this.formatHistoryRow(entry))
      .filter(Boolean);

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
      if (message && (!requireMessageId || hasReadyMessageId(message.msgid))) {
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
        if (!requireMessageId || hasReadyMessageId(match.msgid)) {
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

