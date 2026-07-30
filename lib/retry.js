const logger = require('./logger');

async function withRetry(fn, opts = {}) {
  const {
    label = 'operacion',
    maxRetries = 4,
    baseDelayMs = 2000,
    maxDelayMs = 30000,
    shouldRetry = defaultShouldRetry,
  } = opts;

  let lastError;
  for (let intento = 0; intento <= maxRetries; intento++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (intento === maxRetries || !shouldRetry(err)) {
        throw err;
      }
      const backoff = Math.min(baseDelayMs * Math.pow(2, intento), maxDelayMs);
      const jitter = Math.random() * baseDelayMs;
      const delay = Math.round(Math.min(backoff + jitter, maxDelayMs));
      logger.warn(`${label}: fallo (intento ${intento + 1}/${maxRetries + 1}), reintentando en ${delay}ms`, {
        error: err.response?.status || err.message,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function defaultShouldRetry(err) {
  const status = err.response?.status;
  return !status || [429, 500, 502, 503, 504].includes(status);
}

module.exports = { withRetry };
