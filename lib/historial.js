const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Guardamos el historial de temas publicados POR CANAL, en archivos JSON
// separados dentro de ./data/. Asi cada canal recuerda lo suyo y no repite.
// En GitHub Actions este directorio se puede commitear de vuelta para
// persistir entre corridas (o usar cache); localmente persiste en disco.
const DATA_DIR = process.env.HISTORY_DIR || path.join(__dirname, '..', 'data');

// Cuantos temas recientes recordamos y pasamos a Agnes como "no repitas".
// Un numero alto obliga a mas variedad, pero si es demasiado el prompt crece
// mucho; 40 es un buen equilibrio.
const MAX_HISTORIAL = Number(process.env.MAX_HISTORIAL_TEMAS) || 40;

function rutaHistorial(canal) {
  return path.join(DATA_DIR, `historial-${canal}.json`);
}

/**
 * Lee la lista de temas ya publicados para un canal (los mas recientes primero).
 * @param {string} canal - nombre de la cuenta (ej. "curious4d", "canal2")
 * @returns {string[]}
 */
function leerHistorial(canal) {
  try {
    const ruta = rutaHistorial(canal);
    if (!fs.existsSync(ruta)) return [];
    const data = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return Array.isArray(data.temas) ? data.temas : [];
  } catch (err) {
    logger.warn('No se pudo leer el historial de temas, se continua sin el', { canal, error: err.message });
    return [];
  }
}

/**
 * Agrega un tema nuevo al historial del canal (al principio), recorta a
 * MAX_HISTORIAL, y guarda. Best-effort: si falla, no rompe el pipeline.
 * @param {string} canal
 * @param {string} tema - el "topic" o "titulo" del contenido recien generado
 */
function agregarAlHistorial(canal, tema) {
  if (!tema || !tema.trim()) return;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const actuales = leerHistorial(canal);
    // Evitar duplicado exacto y poner el nuevo al frente
    const sinDuplicado = actuales.filter((t) => t.toLowerCase().trim() !== tema.toLowerCase().trim());
    const nuevos = [tema.trim(), ...sinDuplicado].slice(0, MAX_HISTORIAL);
    fs.writeFileSync(rutaHistorial(canal), JSON.stringify({ temas: nuevos, actualizado: new Date().toISOString() }, null, 2));
    logger.info('Tema agregado al historial del canal', { canal, tema, totalHistorial: nuevos.length });
  } catch (err) {
    logger.warn('No se pudo guardar el historial de temas', { canal, error: err.message });
  }
}

/**
 * Construye un bloque de texto para inyectar en el prompt de Agnes, listando
 * los temas ya usados que NO debe repetir. Si no hay historial, devuelve ''.
 * @param {string} canal
 * @returns {string}
 */
function bloqueEvitarRepeticion(canal) {
  const temas = leerHistorial(canal);
  if (temas.length === 0) return '';
  const lista = temas.map((t) => `- ${t}`).join('\n');
  return `\n\nTEMAS YA PUBLICADOS RECIENTEMENTE (NO los repitas ni generes algo muy parecido; busca un angulo o tema completamente distinto y fresco):\n${lista}\n`;
}

module.exports = { leerHistorial, agregarAlHistorial, bloqueEvitarRepeticion };
