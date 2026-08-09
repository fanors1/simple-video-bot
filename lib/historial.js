const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = process.env.HISTORY_DIR || path.join(__dirname, '..', 'data');

const MAX_HISTORIAL = Number(process.env.MAX_HISTORIAL_TEMAS) || 40;

function rutaHistorial(canal) {
  return path.join(DATA_DIR, `historial-${canal}.json`);
}

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

function agregarAlHistorial(canal, tema) {
  if (!tema || !tema.trim()) return;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const actuales = leerHistorial(canal);
    const sinDuplicado = actuales.filter((t) => t.toLowerCase().trim() !== tema.toLowerCase().trim());
    const nuevos = [tema.trim(), ...sinDuplicado].slice(0, MAX_HISTORIAL);
    fs.writeFileSync(rutaHistorial(canal), JSON.stringify({ temas: nuevos, actualizado: new Date().toISOString() }, null, 2));
    logger.info('Tema agregado al historial del canal', { canal, tema, totalHistorial: nuevos.length });
  } catch (err) {
    logger.warn('No se pudo guardar el historial de temas', { canal, error: err.message });
  }
}

function bloqueEvitarRepeticion(canal) {
  const temas = leerHistorial(canal);
  if (temas.length === 0) return '';
  const lista = temas.map((t) => `- ${t}`).join('\n');
  return `\n\nTEMAS YA PUBLICADOS RECIENTEMENTE (prohibido repetirlos o generar algo del mismo tema, sujeto o concepto, aunque sea con otro enfoque). Genera un tema COMPLETAMENTE DISTINTO, sobre otro sujeto y otra idea, que no se solape con ninguno de estos:\n${lista}\n\nSi el tema que ibas a elegir se parece aunque sea un poco a alguno de la lista, DESCARTALO y elige otro totalmente diferente.\n`;
}

module.exports = { leerHistorial, agregarAlHistorial, bloqueEvitarRepeticion };
