const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const logger = require('./logger');
const { withRetry } = require('./retry');

const ZERNIO_URL = 'https://zernio.com/api/v1/posts';
const CATBOX_URL = 'https://catbox.moe/user/api.php';

async function subirVideoHosting(localPath) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(localPath));

  const resp = await axios.post(CATBOX_URL, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 180000,
  });

  const url = typeof resp.data === 'string' ? resp.data.trim() : '';
  if (!url.startsWith('http')) throw new Error('Hosting no devolvio una URL valida: ' + String(resp.data).slice(0, 120));
  return url;
}

async function publishVideo({ localPath, title, zernioAccountId, apiKey }) {
  const key = apiKey || process.env.ZERNIO_API_KEY;
  if (!key) {
    logger.info('TikTok (Zernio): sin API key, se omite');
    return { skipped: true };
  }
  if (!zernioAccountId) {
    logger.info('TikTok (Zernio): sin accountId configurado, se omite');
    return { skipped: true };
  }
  if (!localPath || !fs.existsSync(localPath)) {
    logger.info('TikTok (Zernio): archivo de video no encontrado, se omite', { localPath });
    return { skipped: true };
  }

  const titulo = (title || '').slice(0, 2000);

  const videoUrl = await withRetry(() => subirVideoHosting(localPath), {
    label: 'Subir video a hosting temporal',
    maxRetries: 3,
    baseDelayMs: 5000,
  });

  logger.info('TikTok (Zernio): video alojado, enviando a Zernio', { videoUrl });

  const resultado = await withRetry(
    async () => {
      const resp = await axios.post(
        ZERNIO_URL,
        {
          platforms: [{ platform: 'tiktok', accountId: zernioAccountId }],
          content: titulo,
          mediaItems: [{ type: 'video', url: videoUrl }],
        },
        {
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          timeout: 120000,
        }
      );
      return resp.data;
    },
    {
      label: 'Zernio publicar TikTok',
      maxRetries: 3,
      baseDelayMs: 5000,
    }
  );

  logger.info('TikTok (Zernio): publicado', { zernioAccountId, respuesta: JSON.stringify(resultado).slice(0, 300) });
  return { ok: true, respuesta: resultado };
}

module.exports = { publishVideo };
