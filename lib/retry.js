const logger = require('./logger');

/**
 * Ejecuta fn() con reintentos y backoff exponencial + jitter.
 * Solo reintenta si shouldRetry(error) devuelve true.
 *
 * NUNCA usar esto para envolver la creacion de un job de video sin
 * garantizar idempotencia: si el job ya se creo, reintentar podria
 * generar un segundo job y cobrar creditos duplicados. Para esos casos
 * usar shouldRetry acotado a codigos de error de red/limite, no a exito.
 *
 * @param {Function} fn - funcion async a ejecutar
 * @param {object} [opts]
 * @param {string} [opts.label] - etiqueta para los logs
 * @param {number} [opts.maxRetries=4] - cantidad maxima de reintentos
 * @param {number} [opts.baseDelayMs=2000] - retardo base (crece exponencial)
 * @param {Function} [opts.shouldRetry] - (err) => bool; por defecto reintenta
 *   ante fallos de red o codigos 429/500/502/503/504
 */
async function withRetry(fn, opts = {}) {
  const {
    label = 'operacion',
    maxRetries = 4,
    baseDelayMs = 2000,
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
      const backoff = baseDelayMs * Math.pow(2, intento);
      const jitter = Math.random() * baseDelayMs;
      const delay = Math.round(backoff + jitter);
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
