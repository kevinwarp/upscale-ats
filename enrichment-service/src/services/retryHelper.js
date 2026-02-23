const logger = require('../utils/logger');

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;

/**
 * Execute an async function with exponential backoff retry.
 *
 * @param {Function} fn - Async function to execute
 * @param {object} [opts]
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.baseDelayMs=1000]
 * @param {number} [opts.maxDelayMs=30000]
 * @param {string} [opts.label='operation'] - Label for log messages
 * @param {Function} [opts.shouldRetry] - Predicate (err) => bool; defaults to always retry
 * @returns {Promise<*>} Result of fn()
 */
async function withRetry(fn, opts = {}) {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    label = 'operation',
    shouldRetry = () => true,
  } = opts;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries || !shouldRetry(err)) {
        break;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = Math.floor(Math.random() * delay * 0.2);

      logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay + jitter}ms`, {
        error: err.message,
        attempt: attempt + 1,
      });

      await sleep(delay + jitter);
    }
  }

  logger.error(`${label} failed after ${maxRetries + 1} attempts`, {
    error: lastError?.message,
  });

  throw lastError;
}

/**
 * Check if an HTTP error is retryable (5xx or network error).
 */
function isRetryableHttpError(err) {
  if (!err) return false;

  // Network errors
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
    return true;
  }

  // HTTP 5xx or 429 (rate limit)
  const status = err.response?.status || err.statusCode;
  if (status >= 500 || status === 429) {
    return true;
  }

  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { withRetry, isRetryableHttpError, sleep };
