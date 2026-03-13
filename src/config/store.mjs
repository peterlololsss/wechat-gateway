import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_RUNTIME_STATE,
  normalizeRuntimeState,
  normalizeStartupConfig,
} from './schema.mjs';

const CONFIG_FILE_URL = new URL('../../config.json', import.meta.url);
const LEGACY_RUNTIME_STATE_FILE_URL = new URL('../../runtime-state.json', import.meta.url);

function readJsonFile(fileUrl, label) {
  if (!existsSync(fileUrl)) {
    return null;
  }

  const raw = readFileSync(fileUrl, 'utf8');
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${message}`);
  }
}

function readLegacyRuntimeState(fileUrl = LEGACY_RUNTIME_STATE_FILE_URL) {
  const rawState = readJsonFile(fileUrl, 'bridge-node/runtime-state.json');
  if (!rawState || typeof rawState !== 'object') {
    return DEFAULT_RUNTIME_STATE;
  }

  return normalizeRuntimeState(rawState);
}

function buildNormalizedDocument(rawDocument, legacyRuntimeState) {
  if (rawDocument && typeof rawDocument === 'object' && ('startup' in rawDocument || 'runtime' in rawDocument)) {
    const hasRuntimeSection = rawDocument.runtime && typeof rawDocument.runtime === 'object';
    const normalizedRuntime = normalizeRuntimeState(
      hasRuntimeSection ? rawDocument.runtime : {},
      hasRuntimeSection ? DEFAULT_RUNTIME_STATE : legacyRuntimeState,
    );

    return {
      startup: normalizeStartupConfig(rawDocument.startup),
      runtime: normalizedRuntime,
      needsRewrite: !hasRuntimeSection && Boolean(legacyRuntimeState.webhookUrl),
    };
  }

  const flatConfig = rawDocument && typeof rawDocument === 'object' ? rawDocument : {};
  const runtimeFallback = typeof flatConfig.webhookUrl === 'string'
    ? { webhookUrl: flatConfig.webhookUrl }
    : legacyRuntimeState;

  return {
    startup: normalizeStartupConfig(flatConfig),
    runtime: normalizeRuntimeState({}, runtimeFallback),
    needsRewrite: true,
  };
}

function saveConfigDocument(document, options = {}) {
  const fileUrl = options.fileUrl ?? CONFIG_FILE_URL;
  const normalized = {
    startup: normalizeStartupConfig(document?.startup ?? document?.config),
    runtime: normalizeRuntimeState(document?.runtime ?? document?.runtimeState),
  };
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  writeFileSync(fileUrl, serialized, 'utf8');
  return normalized;
}

function loadConfigDocument(options = {}) {
  const fileUrl = options.fileUrl ?? CONFIG_FILE_URL;
  const legacyRuntimeStateFileUrl = options.legacyRuntimeStateFileUrl ?? LEGACY_RUNTIME_STATE_FILE_URL;
  const rawDocument = readJsonFile(fileUrl, 'bridge-node/config.json');
  const legacyRuntimeState = readLegacyRuntimeState(legacyRuntimeStateFileUrl);
  const document = buildNormalizedDocument(rawDocument, legacyRuntimeState);

  if (rawDocument === null || document.needsRewrite) {
    saveConfigDocument(document, { fileUrl });
  }

  return document;
}

export function saveConfig(config, options = {}) {
  const fileUrl = options.fileUrl ?? CONFIG_FILE_URL;
  const document = loadConfigDocument(options);
  return saveConfigDocument({
    startup: config,
    runtime: document.runtime,
  }, { fileUrl }).startup;
}

export function loadConfig(options = {}) {
  return loadConfigDocument(options).startup;
}

export function saveRuntimeState(state, options = {}) {
  const fileUrl = options.fileUrl ?? CONFIG_FILE_URL;
  const document = loadConfigDocument(options);
  return saveConfigDocument({
    startup: document.startup,
    runtime: state,
  }, { fileUrl }).runtime;
}

export function loadRuntimeState(options = {}) {
  return loadConfigDocument(options).runtime;
}
