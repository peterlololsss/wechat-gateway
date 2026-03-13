/**
 * GroupContextStore — per-room rolling message buffer for group chat context.
 *
 * Maintains a time-bounded, count-bounded buffer of recent messages per room wxid.
 * Only stores text-bearing messages (skips pure media with no content).
 * Designed for small, low-frequency groups where full recent history fits comfortably
 * in an LLM context window.
 *
 * Each entry shape:
 *   { from_wxid, sender_display, content, timestamp, msgid }
 *
 * Entries are evicted when:
 *   - They exceed the TTL (contextTtlMs, default 48h)
 *   - The per-room buffer exceeds maxMessagesPerRoom (default 200)
 * Global cleanup runs on an interval (cleanupIntervalMs, default 10min).
 */
export class GroupContextStore {
  constructor({
    contextTtlMs = 48 * 60 * 60 * 1000,
    maxMessagesPerRoom = 200,
    cleanupIntervalMs = 10 * 60 * 1000,
  } = {}) {
    this.contextTtlMs = contextTtlMs;
    this.maxMessagesPerRoom = maxMessagesPerRoom;
    this.cleanupIntervalMs = cleanupIntervalMs;
    /** @type {Map<string, Array<{from_wxid:string, sender_display:string, content:string, timestamp:number, msgid:string}>>} */
    this.rooms = new Map();
    this.lastCleanupAt = Date.now();
  }

  /**
   * Push a message into the buffer for the given room.
   * Silently ignored if roomWxid is empty or content is empty/whitespace.
   *
   * @param {string} roomWxid
   * @param {{ from_wxid: string, sender_display: string, content: string, timestamp: number, msgid: string }} entry
   */
  push(roomWxid, entry) {
    if (!roomWxid || typeof roomWxid !== 'string') {
      return;
    }
    const content = typeof entry?.content === 'string' ? entry.content.trim() : '';
    if (!content) {
      return;
    }

    this._maybeCleanup();

    if (!this.rooms.has(roomWxid)) {
      this.rooms.set(roomWxid, []);
    }

    const buf = this.rooms.get(roomWxid);
    buf.push({
      from_wxid: typeof entry.from_wxid === 'string' ? entry.from_wxid : '',
      sender_display: typeof entry.sender_display === 'string' ? entry.sender_display : '',
      content,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Math.floor(Date.now() / 1000),
      msgid: typeof entry.msgid === 'string' ? entry.msgid : '',
    });

    // Trim to maxMessagesPerRoom (drop oldest from front)
    if (buf.length > this.maxMessagesPerRoom) {
      buf.splice(0, buf.length - this.maxMessagesPerRoom);
    }
  }

  /**
   * Return recent messages for a room, ordered oldest→newest.
   * Automatically excludes entries older than contextTtlMs.
   *
   * @param {string} roomWxid
   * @param {number} [limit] — cap on returned entries (default: all within TTL)
   * @returns {Array<{from_wxid:string, sender_display:string, content:string, timestamp:number, msgid:string}>}
   */
  getContext(roomWxid, limit) {
    if (!roomWxid || typeof roomWxid !== 'string') {
      return [];
    }

    const buf = this.rooms.get(roomWxid);
    if (!buf || buf.length === 0) {
      return [];
    }

    const cutoff = Math.floor((Date.now() - this.contextTtlMs) / 1000);
    const fresh = buf.filter((e) => e.timestamp >= cutoff);

    if (typeof limit === 'number' && limit > 0 && fresh.length > limit) {
      return fresh.slice(fresh.length - limit);
    }

    return fresh.slice();
  }

  /**
   * Evict TTL-expired entries from all rooms. Removes empty room buffers.
   * Called automatically on push(); can also be called manually.
   */
  cleanup() {
    const cutoffSec = Math.floor((Date.now() - this.contextTtlMs) / 1000);
    for (const [roomWxid, buf] of this.rooms) {
      // Remove expired entries from the front (buffer is insertion-ordered)
      let i = 0;
      while (i < buf.length && buf[i].timestamp < cutoffSec) {
        i++;
      }
      if (i > 0) {
        buf.splice(0, i);
      }
      if (buf.length === 0) {
        this.rooms.delete(roomWxid);
      }
    }
    this.lastCleanupAt = Date.now();
  }

  _maybeCleanup() {
    if (Date.now() - this.lastCleanupAt >= this.cleanupIntervalMs) {
      this.cleanup();
    }
  }
}
