const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { withRetry } = require('./retry');
const logger = require('./logger');

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const BASE_URL = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com';
const API_KEY = process.env.AGNES_API_KEY || '';

// El plan de Agnes AI que uses define cuantas solicitudes de video por
// minuto (RPM) tenes disponibles:
//   - Free/default: 1 RPM efectivo (muy estricto)
//   - Token Plan (Starter/Plus/Pro): 5 RPM efectivo
// Este intervalo de consulta de estado (poll) esta pensado para no pasarse
// de ninguno de los dos casos. Si ya tenes un Token Plan activo, podes
// bajarlo con la variable de entorno AGNES_POLL_INTERVAL_MS (ej: 8000).
const POLL_INTERVAL_MS = Number(process.env.AGNES_POLL_INTERVAL_MS) || 15000;

// Ante volumen alto, Agnes a veces devuelve 400 en vez del 429 estandar
// para indicar que se supero el limite de RPM. Por eso, ademas de los
// codigos usuales, tambien reintentamos ante 400 en las llamadas al
// modelo de video (creacion y consulta de estado).
const shouldRetryVideoCall = (err) => {
  const status = err.response?.status;
  return !status || [400, 404, 429, 500, 502, 503, 504].includes(status);
};

async function generateVideo(theme, { outputDir = './output', rawPrompt = null } = {}) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const prompt = rawPrompt || buildPromptFromTheme(theme);

  if (DRY_RUN) {
    logger.info('[MOCK] Generando video simulado (0 costo, sin llamada real a Agnes)', { theme, prompt });
    const localPath = path.join(outputDir, `mock-${Date.now()}.mp4`);
    fs.writeFileSync(localPath, buildFakeMp4());
    return { videoUrl: null, localPath, prompt };
  }

  if (!API_KEY) throw new Error('Falta AGNES_API_KEY en .env');

  logger.info('Creando tarea de video en Agnes AI', { prompt });
  const createResp = await withRetry(
    () =>
      axios.post(
        `${BASE_URL}/v1/videos`,
        { model: 'agnes-video-v2.0', prompt, height: 1280, width: 720, num_frames: 121, frame_rate: 24 },
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
        maxRetries: 8,
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
