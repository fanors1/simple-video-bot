const fs = require('fs');
const path = require('path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const logDir = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFile = path.join(logDir, `run-${new Date().toISOString().slice(0, 10)}.log`);

function write(level, message, meta = {}) {
  if (LEVELS[level] > currentLevel) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const line = JSON.stringify(entry);

  // Consola: legible para humanos
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`, Object.keys(meta).length ? meta : '');

  // Archivo: JSON estructurado para trazabilidad completa
  fs.appendFile(logFile, line + '\n', (err) => {
    if (err) console.error('No se pudo escribir el log:', err.message);
  });
}

module.exports = {
  error: (msg, meta) => write('error', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  debug: (msg, meta) => write('debug', msg, meta),
};
