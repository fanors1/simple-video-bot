const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('./logger');
const { withRetry } = require('./retry');

const BASE = 'https://zernio.com/api/v1';

async function subirVideoAZernio(localPath, apiKey) {
  const fileName = path.basename(localPath);
  const presign = await axios.post(
    `${BASE}/media/presign`,
    { filename: fileName, contentType: 'video/mp4' },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
  );

  const uploadUrl = presign.data.uploadUrl;
  const publicUrl = presign.data.publicUrl;
  if (!uploadUrl || !publicUrl) throw new Error('Zernio presign no devolvio URLs: ' + JSON.stringify(presign.data).slice(0, 200));

  const fileBuffer = fs.readFileSync(localPath);
  await axios.put(uploadUrl, fileBuffer, {
    headers: { 'Content-Type': 'video/mp4' },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 180000,
  });

  return publicUrl;
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

  const publicUrl = await withRetry(() => subirVideoAZernio(localPath, key), {
    label: 'Subir video a Zernio',
    maxRetries: 3,
    baseDelayMs: 5000,
  });

  logger.info('TikTok (Zernio): video subido a Zernio, publicando', { publicUrl });

  const resultado = await withRetry(
    async () => {
      try {
        const resp = await axios.post(
          `${BASE}/posts`,
          {
            content: titulo,
            mediaUrls: [publicUrl],
            platforms: [{ platform: 'tiktok', accountId: zernioAccountId }],
            publishNow: true,
          },
          { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 120000 }
        );
        return resp.data;
      } catch (err) {
        const detalle = err?.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : err.message;
        logger.warn('Zernio respondio con error', { status: err?.response?.status, detalle });
        throw new Error(`Zernio ${err?.response?.status || ''}: ${detalle}`);
      }
    },
    { label: 'Zernio publicar TikTok', maxRetries: 3, baseDelayMs: 5000 }
  );

  logger.info('TikTok (Zernio): publicado', { zernioAccountId, respuesta: JSON.stringify(resultado).slice(0, 300) });
  return { ok: true, respuesta: resultado };
}

module.exports = { publishVideo };
