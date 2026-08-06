const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { withRetry } = require('./retry');
const logger = require('./logger');

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const BASE_URL = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com';
const API_KEY = process.env.AGNES_API_KEY || '';

const POLL_INTERVAL_MS = Number(process.env.AGNES_POLL_INTERVAL_MS) || 15000;

const shouldRetryVideoCall = (err) => {
  const status = err.response?.status;
  return !status || [400, 404, 429, 500, 502, 503, 504].includes(status);
};

async function generateVideo(theme, { outputDir = './output', rawPrompt = null, horizontal = false } = {}) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const prompt = rawPrompt || buildPromptFromTheme(theme);

  if (DRY_RUN) {
    logger.info('[MOCK] Generando video simulado (0 costo, sin llamada real a Agnes)', { theme, prompt });
    const localPath = path.join(outputDir, `mock-${Date.now()}.mp4`);
    fs.writeFileSync(localPath, buildFakeMp4());
    return { videoUrl: null, localPath, prompt };
  }

  if (!API_KEY) throw new Error('Falta AGNES_API_KEY en .env');

  const MAX_INTENTOS_VIDEO = 3;
  let ultimoError;
  for (let intento = 1; intento <= MAX_INTENTOS_VIDEO; intento++) {
    try {
      return await intentarGenerarVideo(prompt, outputDir, horizontal);
    } catch (err) {
      ultimoError = err;
      const quedanIntentos = intento < MAX_INTENTOS_VIDEO;
      logger.warn(
        quedanIntentos
          ? `Generacion de video fallo en intento ${intento}/${MAX_INTENTOS_VIDEO}, creando tarea nueva`
          : `Generacion de video fallo en el ultimo intento (${intento}/${MAX_INTENTOS_VIDEO})`,
        { error: err.message }
      );
      if (quedanIntentos) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw ultimoError;
}

async function intentarGenerarVideo(prompt, outputDir, horizontal = false) {
  logger.info('Creando tarea de video en Agnes AI', { prompt, horizontal });
  const dimensiones = horizontal ? { height: 720, width: 1280 } : { height: 1280, width: 720 };
  const numFrames = Number(process.env.AGNES_NUM_FRAMES) || 121;
  const createResp = await withRetry(
    () =>
      axios.post(
        `${BASE_URL}/v1/videos`,
        { model: 'agnes-video-v2.0', prompt, ...dimensiones, num_frames: numFrames, frame_rate: 24 },
        { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } }
      ),
    {
      label: 'Agnes crear tarea',
      maxRetries: 6,
      baseDelayMs: 3000,
      shouldRetry: shouldRetryVideoCall,
    }
  );

  const videoId = createResp.data.video_id || createResp.data.id;
  logger.info('Tarea creada, esperando resultado', { videoId });

  const result = await pollUntilComplete(videoId);

  const videoUrl = result.video_url || result.url || result.remixed_from_video_id || result.output?.url;

  if (!videoUrl) {
    logger.error('No encontre la URL del video en la respuesta de Agnes. Respuesta completa:', { result });
    throw new Error('Agnes marco el video como completado pero no devolvio una URL reconocible.');
  }

  const safeFilename = videoId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || `video-${Date.now()}`;
  const localPath = path.join(outputDir, `${safeFilename}.mp4`);

  const fileResp = await withRetry(
    () => axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 60000 }),
    { label: 'Descarga de video Agnes' }
  );
  fs.writeFileSync(localPath, Buffer.from(fileResp.data));

  logger.info('Video generado y descargado', { localPath, videoUrl });
  return { videoUrl, localPath, prompt };
}

async function pollUntilComplete(videoId, { intervalMs = POLL_INTERVAL_MS, timeoutMs = 600000 } = {}) {
  const start = Date.now();
  while (true) {
    const resp = await withRetry(
      () =>
        axios.get(`${BASE_URL}/agnesapi`, {
          params: { video_id: videoId },
          headers: { Authorization: `Bearer ${API_KEY}` },
        }),
      {
        label: 'Agnes consultar estado',
        maxRetries: 4,
        baseDelayMs: 4000,
        shouldRetry: shouldRetryVideoCall,
      }
    );

    const data = resp.data;
    if (data.status === 'completed') return data;
    if (data.status === 'failed') throw new Error(`Agnes reporto fallo: ${JSON.stringify(data)}`);

    if (Date.now() - start > timeoutMs) throw new Error(`Timeout esperando video ${videoId}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function buildPromptFromTheme(theme) {
  return `Cinematic vertical short-form video about: ${theme}. Dynamic camera movement, high visual quality, engaging for social media, 9:16 aspect ratio, no text overlays.`;
}

function buildFakeMp4() {
  const box = (type, payload = Buffer.alloc(0)) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload.length, 0);
    header.write(type, 4, 'ascii');
    return Buffer.concat([header, payload]);
  };
  const ftyp = box('ftyp', Buffer.from('isom\x00\x00\x02\x00isomiso2avc1mp41'));
  const mdat = box('mdat', Buffer.alloc(20000));
  return Buffer.concat([ftyp, mdat]);
}

module.exports = { generateVideo };
