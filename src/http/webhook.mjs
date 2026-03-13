import { createLogger } from '../logger.mjs';

const logger = createLogger('webhook');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  if (!(error instanceof Error)) {
    return true;
  }
  const message = error.message || '';
  return !message.includes('status 4') || message.includes('status 429');
}

export async function postWebhook(targetUrl, payload, secret, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 30_000;
  const retryCount = Number.isFinite(Number(options.retryCount)) ? Math.max(Number(options.retryCount), 0) : 0;
  const retryBackoffMs = Number.isFinite(Number(options.retryBackoffMs)) ? Math.max(Number(options.retryBackoffMs), 0) : 0;
  const retryBackoffMultiplier = Number.isFinite(Number(options.retryBackoffMultiplier))
    ? Math.max(Number(options.retryBackoffMultiplier), 1)
    : 1;
  const headers = {
    'content-type': 'application/json; charset=utf-8',
  };

  if (secret) {
    headers['x-ntchat-secret'] = secret;
  }

  if (options.authToken) {
    headers['authorization'] = `Bearer ${options.authToken}`;
  }

  let attempt = 0;
  let nextBackoffMs = retryBackoffMs;
  while (true) {
    attempt += 1;

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Webhook push failed with status ${response.status}`);
      }

      logger.info('delivered', {
        status: response.status,
        attempt,
        duration_ms: Date.now() - startedAt,
        target_url: targetUrl,
        message_id: payload?.data?.msgid || '',
      });

      return response.status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldRetry = attempt <= retryCount && isRetryableError(error);

      if (shouldRetry) {
        logger.warn('retrying', {
          error: message,
          attempt,
          backoff_ms: nextBackoffMs,
          target_url: targetUrl,
          message_id: payload?.data?.msgid || '',
        });
        if (nextBackoffMs > 0) {
          await sleep(nextBackoffMs);
        }
        nextBackoffMs = Math.max(Math.round(nextBackoffMs * retryBackoffMultiplier), nextBackoffMs);
        continue;
      }

      logger.error('failed', {
        error: message,
        attempt,
        duration_ms: Date.now() - startedAt,
        target_url: targetUrl,
        message_id: payload?.data?.msgid || '',
      });
      throw error;
    }
  }
}
