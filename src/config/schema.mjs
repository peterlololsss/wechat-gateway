const DEFAULT_STARTUP_CONFIG = {
  host: '0.0.0.0',
  port: 8000,
  webhookSecret: '',
  webhookAuthToken: '',
  channelName: 'wechatferry',
  logLevel: 'info',
  debugRawInbound: false,
  webhookTimeoutMs: 30_000,
  webhookRetryCount: 2,
  webhookRetryBackoffMs: 1_000,
  webhookRetryBackoffMultiplier: 2,
  keepalive: true,
  outboundSendThrottleMs: 800,
  outboundSendJitterMs: 400,
  autoLaunchWeChat: true,
  wechatExecutablePath: '',
  wechatLaunchTimeoutMs: 10_000,
  supportedWeChatVersionPrefix: '',
  mediaDownloadDir: 'downloads',
  enableRoomMemberManagement: false,
  adminApiToken: '',
  groupContextTtlHours: 48,
  groupContextMaxMessages: 200,
  groupContextEnabled: true,
};

const DEFAULT_RUNTIME_STATE = {
  webhookUrl: '',
};

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseLogLevel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['debug', 'info', 'warn', 'error'].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_STARTUP_CONFIG.logLevel;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumber(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseKeepalive(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_STARTUP_CONFIG.keepalive;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed >= 10 ? parsed : DEFAULT_STARTUP_CONFIG.keepalive;
}

export function normalizeStartupConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

  return {
    host: typeof config.host === 'string' && config.host.trim() ? config.host.trim() : DEFAULT_STARTUP_CONFIG.host,
    port: parseInteger(config.port, DEFAULT_STARTUP_CONFIG.port),
    webhookSecret: typeof config.webhookSecret === 'string'
      ? config.webhookSecret.trim()
      : DEFAULT_STARTUP_CONFIG.webhookSecret,
    webhookAuthToken: typeof config.webhookAuthToken === 'string'
      ? config.webhookAuthToken.trim()
      : DEFAULT_STARTUP_CONFIG.webhookAuthToken,
    channelName: typeof config.channelName === 'string' && config.channelName.trim()
      ? config.channelName.trim()
      : DEFAULT_STARTUP_CONFIG.channelName,
    logLevel: parseLogLevel(config.logLevel),
    debugRawInbound: parseBoolean(config.debugRawInbound, DEFAULT_STARTUP_CONFIG.debugRawInbound),
    webhookTimeoutMs: parseInteger(config.webhookTimeoutMs, DEFAULT_STARTUP_CONFIG.webhookTimeoutMs),
    webhookRetryCount: Math.max(parseInteger(config.webhookRetryCount, DEFAULT_STARTUP_CONFIG.webhookRetryCount), 0),
    webhookRetryBackoffMs: Math.max(
      parseInteger(config.webhookRetryBackoffMs, DEFAULT_STARTUP_CONFIG.webhookRetryBackoffMs),
      0,
    ),
    webhookRetryBackoffMultiplier: Math.max(
      parseNumber(config.webhookRetryBackoffMultiplier, DEFAULT_STARTUP_CONFIG.webhookRetryBackoffMultiplier),
      1,
    ),
    keepalive: parseKeepalive(config.keepalive),
    outboundSendThrottleMs: Math.max(
      parseInteger(config.outboundSendThrottleMs, DEFAULT_STARTUP_CONFIG.outboundSendThrottleMs),
      0,
    ),
    outboundSendJitterMs: Math.max(
      parseInteger(config.outboundSendJitterMs, DEFAULT_STARTUP_CONFIG.outboundSendJitterMs),
      0,
    ),
    autoLaunchWeChat: config.autoLaunchWeChat !== false,
    wechatExecutablePath: typeof config.wechatExecutablePath === 'string'
      ? config.wechatExecutablePath.trim()
      : DEFAULT_STARTUP_CONFIG.wechatExecutablePath,
    wechatLaunchTimeoutMs: parseInteger(config.wechatLaunchTimeoutMs, DEFAULT_STARTUP_CONFIG.wechatLaunchTimeoutMs),
    supportedWeChatVersionPrefix: typeof config.supportedWeChatVersionPrefix === 'string'
      ? config.supportedWeChatVersionPrefix.trim()
      : DEFAULT_STARTUP_CONFIG.supportedWeChatVersionPrefix,
    mediaDownloadDir: typeof config.mediaDownloadDir === 'string' && config.mediaDownloadDir.trim()
      ? config.mediaDownloadDir.trim()
      : DEFAULT_STARTUP_CONFIG.mediaDownloadDir,
    enableRoomMemberManagement: parseBoolean(
      config.enableRoomMemberManagement,
      DEFAULT_STARTUP_CONFIG.enableRoomMemberManagement,
    ),
    adminApiToken: typeof config.adminApiToken === 'string'
      ? config.adminApiToken.trim()
      : DEFAULT_STARTUP_CONFIG.adminApiToken,
    groupContextEnabled: parseBoolean(config.groupContextEnabled, DEFAULT_STARTUP_CONFIG.groupContextEnabled),
    groupContextTtlHours: Math.max(
      parseInteger(config.groupContextTtlHours, DEFAULT_STARTUP_CONFIG.groupContextTtlHours),
      1,
    ),
    groupContextMaxMessages: Math.max(
      parseInteger(config.groupContextMaxMessages, DEFAULT_STARTUP_CONFIG.groupContextMaxMessages),
      10,
    ),
  };
}

export function normalizeRuntimeState(rawState, fallbackState = DEFAULT_RUNTIME_STATE) {
  const state = rawState && typeof rawState === 'object' ? rawState : {};
  const fallback = fallbackState && typeof fallbackState === 'object' ? fallbackState : DEFAULT_RUNTIME_STATE;

  return {
    webhookUrl: typeof state.webhookUrl === 'string'
      ? state.webhookUrl.trim()
      : (typeof fallback.webhookUrl === 'string' ? fallback.webhookUrl.trim() : DEFAULT_RUNTIME_STATE.webhookUrl),
  };
}

export { DEFAULT_RUNTIME_STATE, DEFAULT_STARTUP_CONFIG };
