const fs = require('fs');
const axios = require('axios');
const { withRetry } = require('./retry');
const logger = require('./logger');

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const GRAPH_URL = 'https://graph.facebook.com/v21.0';

async function publishReel({ pageId, pageAccessToken, localPath, description }) {
  if (DRY_RUN) {
    logger.info('[MOCK] Publicacion simulada en Facebook Reels (sin llamada real)', { localPath, description });
    return { mock: true };
  }

  if (!pageId || !pageAccessToken) throw new Error('Faltan FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN en .env');
  if (!localPath) throw new Error('publishReel requiere localPath (archivo de video local).');

  const startResp = await withRetry(
    () =>
      axios.post(`${GRAPH_URL}/${pageId}/video_reels`, null, {
        params: { upload_phase: 'start', access_token: pageAccessToken },
      }),
    { label: 'Facebook Reels: start' }
  );
  const { video_id: videoId, upload_url: uploadUrl } = startResp.data;
  logger.info('Sesion de subida de Reel iniciada', { videoId });

  const fileBuffer = fs.readFileSync(localPath);
  await withRetry(
    () =>
      axios.post(uploadUrl, fileBuffer, {
        headers: {
          Authorization: `OAuth ${pageAccessToken}`,
          'Content-Type': 'application/octet-stream',
          offset: 0,
          file_size: fileBuffer.length,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }),
    { label: 'Facebook Reels: subir video' }
  );
  logger.info('Video subido, finalizando publicacion', { videoId });

  const finishResp = await withRetry(
    () =>
      axios.post(`${GRAPH_URL}/${pageId}/video_reels`, null, {
        params: {
          upload_phase: 'finish',
          video_id: videoId,
          description: description || '',
          video_state: 'PUBLISHED',
          access_token: pageAccessToken,
        },
      }),
    { label: 'Facebook Reels: finish' }
  );

  logger.info('Reel publicado en Facebook', { videoId, success: finishResp.data.success });
  return { videoId };
}

// Publica el mismo video final como Historia de Facebook (ademas del Reel).
// Mismo patron de 3 fases (start/upload/finish) que usa Reels, pero
// apuntando al endpoint de video_stories en vez de video_reels.
async function publishStory({ pageId, pageAccessToken, localPath }) {
  if (DRY_RUN) {
    logger.info('[MOCK] Publicacion simulada de Historia en Facebook (sin llamada real)', { localPath });
    return { mock: true };
  }

  if (!pageId || !pageAccessToken) throw new Error('Faltan FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN en .env');
  if (!localPath) throw new Error('publishStory requiere localPath (archivo de video local).');

  const startResp = await withRetry(
    () =>
      axios.post(`${GRAPH_URL}/${pageId}/video_stories`, null, {
        params: { upload_phase: 'start', access_token: pageAccessToken },
      }),
    { label: 'Facebook Historia: start' }
  );
  const { video_id: videoId, upload_url: uploadUrl } = startResp.data;
  logger.info('Sesion de subida de Historia iniciada', { videoId });

  const fileBuffer = fs.readFileSync(localPath);
  await withRetry(
    () =>
      axios.post(uploadUrl, fileBuffer, {
        headers: {
          Authorization: `OAuth ${pageAccessToken}`,
          'Content-Type': 'application/octet-stream',
          offset: 0,
          file_size: fileBuffer.length,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }),
    { label: 'Facebook Historia: subir video' }
  );
  logger.info('Video subido, finalizando publicacion de historia', { videoId });

  const finishResp = await withRetry(
    () =>
      axios.post(`${GRAPH_URL}/${pageId}/video_stories`, null, {
        params: {
          upload_phase: 'finish',
          video_id: videoId,
          access_token: pageAccessToken,
        },
      }),
    { label: 'Facebook Historia: finish' }
  );

  logger.info('Historia publicada en Facebook', { videoId, success: finishResp.data.success });
  return { videoId };
}

// Publica una foto como post normal en el feed de la Pagina de Facebook
// (no es Reel ni Historia). El texto largo va en "message".
async function publishPhoto({ pageId, pageAccessToken, localPath, message }) {
  if (DRY_RUN) {
    logger.info('[MOCK] Publicacion simulada de foto en Facebook (sin llamada real)', { localPath, message });
    return { mock: true };
  }

  if (!pageId || !pageAccessToken) throw new Error('Faltan FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN en .env');
  if (!localPath) throw new Error('publishPhoto requiere localPath (archivo de imagen local).');

  const FormData = require('form-data');
  const form = new FormData();
  form.append('source', fs.createReadStream(localPath));
  form.append('caption', message || '');
  form.append('access_token', pageAccessToken);

  const resp = await withRetry(
    () =>
      axios.post(`${GRAPH_URL}/${pageId}/photos`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }),
    { label: 'Facebook: publicar foto' }
  );

  logger.info('Foto publicada en Facebook', { postId: resp.data.post_id || resp.data.id });
  return { postId: resp.data.post_id || resp.data.id };
}

module.exports = { publishReel, publishStory, publishPhoto };
