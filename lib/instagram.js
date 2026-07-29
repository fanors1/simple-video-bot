const fs = require('fs');
const axios = require('axios');
const { withRetry } = require('./retry');
const logger = require('./logger');

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const GRAPH_URL = 'https://graph.facebook.com/v21.0';

async function publishReel({ pageId, pageAccessToken, localPath, description }) {
  if (DRY_RUN) {
    logger.info('[MOCK] Publicacion simulada en Instagram Reels (sin llamada real)', { localPath, description });
    return { mock: true };
  }

  if (!pageId || !pageAccessToken) throw new Error('Faltan FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN en .env (Instagram reutiliza estos mismos).');
  if (!localPath) throw new Error('publishReel de Instagram requiere localPath (archivo de video local).');

  const igAccountId = await getInstagramAccountId(pageId, pageAccessToken);
  logger.info('Cuenta de Instagram encontrada', { igAccountId });

  const createResp = await withRetry(
    () =>
      axios.post(`${GRAPH_URL}/${igAccountId}/media`, null, {
        params: {
          media_type: 'REELS',
          upload_type: 'resumable',
          caption: description || '',
          access_token: pageAccessToken,
        },
      }),
    { label: 'Instagram: crear contenedor' }
  );
  const containerId = createResp.data.id;
  logger.info('Contenedor de Instagram creado', { containerId });

  await uploadVideoInChunks(containerId, localPath, pageAccessToken);
  logger.info('Video subido a Instagram, esperando procesamiento', { containerId });

  await waitUntilReady(containerId, pageAccessToken);

  const publishResp = await withRetry(
    () =>
      axios.post(`${GRAPH_URL}/${igAccountId}/media_publish`, null, {
        params: { creation_id: containerId, access_token: pageAccessToken },
      }),
    { label: 'Instagram: publicar' }
  );

  logger.info('Reel publicado en Instagram', { mediaId: publishResp.data.id });
  return { mediaId: publishResp.data.id };
}

// Subimos el archivo en partes de a lo sumo 20MB en vez de mandarlo entero
// en una sola peticion. Con videos mas pesados una sola peticion gigante
// es fragil y puede toparse con limites de tamano/timeout del lado de Meta.
const IG_CHUNK_SIZE = 20 * 1024 * 1024; // 20MB

async function uploadVideoInChunks(containerId, localPath, pageAccessToken) {
  const fileBuffer = fs.readFileSync(localPath);
  const fileSize = fileBuffer.length;
  const totalChunks = Math.ceil(fileSize / IG_CHUNK_SIZE);

  logger.info('Subiendo video a Instagram por partes', { fileSizeMB: (fileSize / 1024 / 1024).toFixed(1), totalChunks });

  for (let i = 0; i < totalChunks; i++) {
    const start = i * IG_CHUNK_SIZE;
    const end = Math.min(start + IG_CHUNK_SIZE, fileSize);
    const chunk = fileBuffer.subarray(start, end);

    await withRetry(
      () =>
        axios.post(`https://rupload.facebook.com/ig-api-upload/v21.0/${containerId}`, chunk, {
          headers: {
            Authorization: `OAuth ${pageAccessToken}`,
            'Content-Type': 'application/octet-stream',
            offset: start,
            file_size: fileSize,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      { label: `Instagram: subir parte ${i + 1}/${totalChunks}` }
    );
  }
}

async function getInstagramAccountId(pageId, pageAccessToken) {
  const resp = await withRetry(
    () =>
      axios.get(`${GRAPH_URL}/${pageId}`, {
        params: { fields: 'instagram_business_account', access_token: pageAccessToken },
      }),
    { label: 'Instagram: obtener cuenta vinculada' }
  );

  const igAccount = resp.data.instagram_business_account;
  if (!igAccount) {
    throw new Error('Esta Pagina de Facebook no tiene una cuenta de Instagram Business/Creator vinculada. Revisa Meta Business Suite > Cuentas de Instagram.');
  }
  return igAccount.id;
}

async function waitUntilReady(containerId, pageAccessToken, { intervalMs = 5000, timeoutMs = 300000 } = {}) {
  const start = Date.now();
  while (true) {
    const resp = await withRetry(
      () =>
        axios.get(`${GRAPH_URL}/${containerId}`, {
          params: { fields: 'status_code', access_token: pageAccessToken },
        }),
      { label: 'Instagram: consultar estado' }
    );

    const status = resp.data.status_code;
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error(`Instagram reporto error al procesar el video (contenedor ${containerId}).`);

    if (Date.now() - start > timeoutMs) throw new Error(`Timeout esperando que Instagram procese el video (contenedor ${containerId}).`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Publica el mismo video final como Historia de Instagram (ademas del Reel).
// Nota: las Historias publicadas por API no admiten stickers/encuestas
// interactivos — solo el video simple, que es justo lo que necesitamos.
async function publishStory({ pageId, pageAccessToken, localPath }) {
  if (DRY_RUN) {
    logger.info('[MOCK] Publicacion simulada de Historia en Instagram (sin llamada real)', { localPath });
    return { mock: true };
  }

  if (!pageId || !pageAccessToken) throw new Error('Faltan FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN en .env (Instagram reutiliza estos mismos).');
  if (!localPath) throw new Error('publishStory de Instagram requiere localPath (archivo de video local).');

  const igAccountId = await getInstagramAccountId(pageId, pageAccessToken);

  const createResp = await withRetry(
    () =>
      axios.post(`${GRAPH_URL}/${igAccountId}/media`, null, {
        params: {
          media_type: 'STORIES',
          upload_type: 'resumable',
          access_token: pageAccessToken,
        },
      }),
    { label: 'Instagram: crear contenedor de historia' }
  );
  const containerId = createResp.data.id;
  logger.info('Contenedor de historia de Instagram creado', { containerId });

  await uploadVideoInChunks(containerId, localPath, pageAccessToken);
  await waitUntilReady(containerId, pageAccessToken);

  const publishResp = await withRetry(
    () =>
      axios.post(`${GRAPH_URL}/${igAccountId}/media_publish`, null, {
        params: { creation_id: containerId, access_token: pageAccessToken },
      }),
    { label: 'Instagram: publicar historia' }
  );

  logger.info('Historia publicada en Instagram', { mediaId: publishResp.data.id });
  return { mediaId: publishResp.data.id };
}

// Publica una foto como post normal en el feed de Instagram.
// IMPORTANTE: Instagram exige que la imagen este en una URL PUBLICA accesible
// (no admite subir el archivo local directo como si fuera video). Por eso
// publishPhoto recibe imageUrl (la URL publica que devuelve Agnes al generar
// la imagen), no un archivo local. Si en el futuro se necesita hostear una
// imagen editada localmente, habria que subirla antes a un hosting publico.
async function publishPhoto({ pageId, pageAccessToken, imageUrl, caption }) {
  if (DRY_RUN) {
    logger.info('[MOCK] Publicacion simulada de foto en Instagram (sin llamada real)', { imageUrl, caption });
    return { mock: true };
  }

  if (!pageId || !pageAccessToken) throw new Error('Faltan FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN en .env (Instagram reutiliza estos).');
  if (!imageUrl) throw new Error('publishPhoto de Instagram requiere imageUrl (URL publica de la imagen).');

  const igAccountId = await getInstagramAccountId(pageId, pageAccessToken);

  const createResp = await withRetry(
    () =>
      axios.post(`${GRAPH_URL}/${igAccountId}/media`, null, {
        params: { image_url: imageUrl, caption: caption || '', access_token: pageAccessToken },
      }),
    { label: 'Instagram: crear contenedor de foto' }
  );
  const containerId = createResp.data.id;

  await waitUntilReady(containerId, pageAccessToken);

  const publishResp = await withRetry(
    () =>
      axios.post(`${GRAPH_URL}/${igAccountId}/media_publish`, null, {
        params: { creation_id: containerId, access_token: pageAccessToken },
      }),
    { label: 'Instagram: publicar foto' }
  );

  logger.info('Foto publicada en Instagram', { mediaId: publishResp.data.id });
  return { mediaId: publishResp.data.id };
}

module.exports = { publishReel, publishStory, publishPhoto };
