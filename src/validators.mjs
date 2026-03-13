import { statSync } from 'node:fs';

const COMPAT_WXID_PREFIXES = new Set([
  'ntchat',
  'wechatferry',
]);

export function normalizeAtList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .map((entry) => normalizeConversationId(entry))
    .filter(Boolean))];
}

export function normalizeConversationId(value) {
  const normalized = resolveNonEmptyString(value);
  if (!normalized) {
    return '';
  }

  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex <= 0) {
    return normalized;
  }

  const prefix = normalized.slice(0, separatorIndex).toLowerCase();
  if (!COMPAT_WXID_PREFIXES.has(prefix)) {
    return normalized;
  }

  return normalized.slice(separatorIndex + 1).trim();
}

export function normalizeWxidList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .map((entry) => normalizeConversationId(entry))
    .filter(Boolean))];
}

export function resolveNonEmptyString(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

export function resolveBoundedInteger(value, { defaultValue, min = 1, max = Number.MAX_SAFE_INTEGER }) {
  const normalized = resolveNonEmptyString(value);
  if (!normalized) {
    return defaultValue;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.min(Math.max(parsed, min), max);
}

export function validateLocalFilePath(filePath, fieldName) {
  const normalizedPath = resolveNonEmptyString(filePath);
  if (!normalizedPath) {
    return { ok: false, detail: `${fieldName} is required` };
  }

  let stats;
  try {
    stats = statSync(normalizedPath);
  } catch {
    return { ok: false, detail: `${fieldName} does not exist` };
  }

  if (!stats.isFile()) {
    return { ok: false, detail: `${fieldName} must point to a file` };
  }

  return { ok: true, path: normalizedPath };
}
