const fs = require('fs');
const path = require('path');
const { Communicate } = require('edge-tts-universal');
const logger = require('./logger');

const VOICE = process.env.TTS_VOICE || 'es-MX-JorgeNeural';

const TTS_MAX_RETRIES = Number(process.env.TTS_MAX_RETRIES) || 4;
const TTS_RETRY_DELAY_MS = Number(process.env.TTS_RETRY_DELAY_MS) || 3000;

async function textToSpeech(text, outputPath, options = {}) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error(`textToSpeech recibio un texto vacio/invalido para ${outputPath}. No se puede narrar un segmento sin texto.`);
  }

  const voice = options.voice || VOICE;
  const rate = options.rate || null;
  const pitch = options.pitch || null;

  const communicateOpts = { voice };
  if (rate) communicateOpts.rate = rate;
  if (pitch) communicateOpts.pitch = pitch;

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  let ultimoError;
  for (let intento = 1; intento <= TTS_MAX_RETRIES; intento++) {
    try {
      logger.info('Generando audio de narracion', { chars: text.length, outputPath, intento, voice });

      const communicate = new Communicate(text, communicateOpts);
      const chunks = [];

      for await (const chunk of communicate.stream()) {
        if (chunk.type === 'audio' && chunk.data) {
          chunks.push(chunk.data);
        }
      }

      if (chunks.length === 0) {
        throw new Error('Edge TTS no devolvio audio (0 chunks). Puede ser un rechazo silencioso del servidor.');
      }

      const audioBuffer = Buffer.concat(chunks);
      fs.writeFileSync(outputPath, audioBuffer);

      if (audioBuffer.length < 500) {
        throw new Error(`El audio generado es sospechosamente chico (${audioBuffer.length} bytes), probablemente corrupto.`);
      }

      return outputPath;
    } catch (err) {
      const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      ultimoError = new Error(msg);

      const quedanIntentos = intento < TTS_MAX_RETRIES;
      logger.warn(
        quedanIntentos
          ? `TTS fallo en intento ${intento}/${TTS_MAX_RETRIES}, reintentando en ${TTS_RETRY_DELAY_MS}ms`
          : `TTS fallo en el ultimo intento (${intento}/${TTS_MAX_RETRIES}), no quedan mas reintentos`,
        { error: msg }
      );

      if (quedanIntentos) {
        await new Promise((r) => setTimeout(r, TTS_RETRY_DELAY_MS));
      }
    }
  }

  throw new Error(
    `Edge TTS fallo ${TTS_MAX_RETRIES} veces seguidas al narrar. Ultimo error: ${ultimoError.message}. ` +
      'Esto suele pasar cuando Microsoft rota el token de su servicio gratuito de voz.'
  );
}

module.exports = { textToSpeech };
