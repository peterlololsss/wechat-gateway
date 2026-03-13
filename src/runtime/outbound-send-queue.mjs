import { createLogger } from '../logger.mjs';

const logger = createLogger('outbound');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function randomJitter(maxJitterMs) {
  if (maxJitterMs <= 0) {
    return 0;
  }
  return Math.floor(Math.random() * (maxJitterMs + 1));
}

export class OutboundSendQueue {
  constructor(config = {}) {
    this.throttleMs = clampInteger(config.outboundSendThrottleMs, {
      min: 0,
      max: 60_000,
      fallback: 800,
    });
    this.jitterMs = clampInteger(config.outboundSendJitterMs, {
      min: 0,
      max: 60_000,
      fallback: 400,
    });
    this.tail = Promise.resolve();
    this.lastStartedAt = 0;
  }

  schedule(operation, task, fields = {}) {
    const runTask = async () => {
      const now = Date.now();
      const targetDelayMs = this.throttleMs + randomJitter(this.jitterMs);
      const waitMs = this.lastStartedAt > 0
        ? Math.max(targetDelayMs - (now - this.lastStartedAt), 0)
        : 0;

      if (waitMs > 0) {
        logger.info('throttling send', {
          operation,
          wait_ms: waitMs,
          throttle_ms: this.throttleMs,
          jitter_ms: this.jitterMs,
          ...fields,
        });
        await sleep(waitMs);
      }

      this.lastStartedAt = Date.now();
      return task();
    };

    const scheduled = this.tail.then(runTask, runTask);
    this.tail = scheduled.catch(() => undefined);
    return scheduled;
  }
}
