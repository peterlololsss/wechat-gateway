import { resolveNonEmptyString } from '../validators.mjs';

export class InboundMessageStore {
  constructor({
    dedupWindowMs = 30 * 60 * 1000,
    maxEntries = 1000,
    cleanupIntervalMs = 5 * 60 * 1000,
  } = {}) {
    this.dedupWindowMs = dedupWindowMs;
    this.maxEntries = maxEntries;
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.entries = new Map();
    this.lastCleanupAt = Date.now();
  }

  remember(rawMessage, payload) {
    const messageId = resolveNonEmptyString(rawMessage?.id || payload?.data?.msgid);
    if (!messageId) {
      return { accepted: true, messageId: '' };
    }

    this.cleanup();

    if (this.entries.has(messageId)) {
      return { accepted: false, messageId };
    }

    if (this.entries.size >= this.maxEntries) {
      const oldestId = this.entries.keys().next().value;
      if (oldestId) {
        this.entries.delete(oldestId);
      }
    }

    this.entries.set(messageId, {
      rawMessage,
      payload,
      seenAt: Date.now(),
    });

    return { accepted: true, messageId };
  }

  get(messageId) {
    const normalizedId = resolveNonEmptyString(messageId);
    if (!normalizedId) {
      return undefined;
    }
    this.cleanup();
    return this.entries.get(normalizedId);
  }

  cleanup() {
    const now = Date.now();
    if (now - this.lastCleanupAt < this.cleanupIntervalMs) {
      return;
    }

    this.lastCleanupAt = now;
    for (const [messageId, entry] of this.entries) {
      if (now - entry.seenAt > this.dedupWindowMs) {
        this.entries.delete(messageId);
      }
    }
  }
}
