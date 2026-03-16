import { resolveNonEmptyString } from '../validators.mjs';

function normalizeInteger(value, defaultValue = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : defaultValue;
}

export function findMatchingSelfHistoryMessage(history, criteria = {}) {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }

  const afterLocalId = Math.max(normalizeInteger(criteria.afterLocalId, 0), 0);
  const minTimestamp = Math.max(normalizeInteger(criteria.minTimestamp, 0), 0);
  const expectedType = Number.isFinite(Number(criteria.expectedType))
    ? Number(criteria.expectedType)
    : undefined;
  const expectedChatWxid = resolveNonEmptyString(criteria.expectedChatWxid);
  const expectedContent = resolveNonEmptyString(criteria.expectedContent);
  const expectedMediaKind = resolveNonEmptyString(criteria.expectedMediaKind);
  const requireMessageId = criteria.requireMessageId !== false;

  for (const entry of history) {
    if (!entry?.is_self) {
      continue;
    }

    const localId = normalizeInteger(entry.local_id, 0);
    if (afterLocalId && localId <= afterLocalId) {
      continue;
    }

    const timestamp = normalizeInteger(entry.timestamp, 0);
    if (minTimestamp && timestamp < minTimestamp) {
      continue;
    }

    if (expectedChatWxid && resolveNonEmptyString(entry.chat_wxid) !== expectedChatWxid) {
      continue;
    }

    if (expectedType !== undefined && normalizeInteger(entry.type, -1) !== expectedType) {
      continue;
    }

    if (expectedMediaKind && resolveNonEmptyString(entry?.media?.kind) !== expectedMediaKind) {
      continue;
    }

    if (requireMessageId && !resolveNonEmptyString(entry.msgid)) {
      continue;
    }

    if (expectedContent) {
      const content = resolveNonEmptyString(entry.content);
      const rawContent = resolveNonEmptyString(entry.raw_content);
      if (content !== expectedContent && rawContent !== expectedContent) {
        continue;
      }
    }

    return entry;
  }

  return null;
}
