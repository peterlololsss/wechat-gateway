const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let activeLogLevel = LOG_LEVELS.info;

function normalizeLogLevel(level) {
  const normalized = String(level || '').trim().toLowerCase();
  return LOG_LEVELS[normalized] ? normalized : 'info';
}

function formatValue(value) {
  if (value === undefined) {
    return '';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value.length > 200 ? `${value.slice(0, 197)}...` : value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatFields(fields) {
  if (!fields || typeof fields !== 'object') {
    return '';
  }

  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');
}

function writeLog(level, scope, message, fields) {
  const normalizedLevel = normalizeLogLevel(level);
  if (LOG_LEVELS[normalizedLevel] < activeLogLevel) {
    return;
  }

  const line = [
    new Date().toISOString(),
    normalizedLevel.toUpperCase(),
    `[${scope}]`,
    message,
    formatFields(fields),
  ].filter(Boolean).join(' ');

  if (normalizedLevel === 'error') {
    console.error(line);
    return;
  }
  if (normalizedLevel === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function configureLogger(options = {}) {
  const level = normalizeLogLevel(options.level);
  activeLogLevel = LOG_LEVELS[level];
  return { level };
}

export function createLogger(scope) {
  return {
    debug(message, fields) {
      writeLog('debug', scope, message, fields);
    },
    info(message, fields) {
      writeLog('info', scope, message, fields);
    },
    warn(message, fields) {
      writeLog('warn', scope, message, fields);
    },
    error(message, fields) {
      writeLog('error', scope, message, fields);
    },
    log(level, message, fields) {
      writeLog(level, scope, message, fields);
    },
  };
}
