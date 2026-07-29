const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { withRetry } = require('./retry');
const logger = require('./logger');

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const BASE_URL = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com';
const API_KEY = process.env.AGNES_API_KEY || '';

// Modelo de imagen de Agnes. Segun la doc oficial, agnes-image-2.1-flash es el
// recomendado para texto-a-imagen con alta densidad visual. Se puede cambiar
// con la variable de entorno AGNES_IMAGE_MODEL.
const IMAGE_MODEL = process.env.AGNES_IMAGE_MODEL || 'agnes-image-2.1-flash';

// Reintentamos ante los mismos codigos que el resto de llamadas a Agnes.
const shouldRetryImageCall = (err) => {
  const status = err.response?.status;
  return !status || [400, 404, 429, 500, 502, 503, 504].includes(status);
};

/**
 * Genera una imagen fotorrealista con Agnes a partir de un prompt en ingles,
 * y la descarga a un archivo local.
 *
 * @param {string} prompt - descripcion de la imagen (en ingles, fotorrealista)
 * @param {object} [opts]
 * @param {string} [opts.outputDir='./output']
 * @param {string} [opts.size='1024x1024'] - tamaño; para post cuadrado de feed
 *   usar 1024x1024, para vertical 1024x1280 (no todos los tamaños se soportan).
 * @returns {Promise<{ imageUrl: string|null, localPath: string, prompt: string }>}
 */
async function generateImage(prompt, { outputDir = './output', size = '1024x1024' } = {}) {
  if (!prompt || !prompt.trim()) {
    throw new Error('generateImage requiere un prompt no vacio.');
  }
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  if (DRY_RUN) {
    logger.info('[MOCK] Generando imagen simulada (0 costo, sin llamada real a Agnes)', { prompt, size });
    const localPath = path.join(outputDir, `mock-image-${Date.now()}.png`);
    // PNG 1x1 transparente minimo valido
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    fs.writeFileSync(localPath, Buffer.from(pngBase64, 'base64'));
    return { imageUrl: null, localPath, prompt };
  }

  if (!API_KEY) throw new Error('Falta AGNES_API_KEY en .env');

  logger.info('Generando imagen con Agnes', { prompt, size, model: IMAGE_MODEL });

  const resp = await withRetry(
    () =>
      axios.post(
        `${BASE_URL}/v1/images/generations`,
        {
          model: IMAGE_MODEL,
          prompt,
          size,
          // Segun la doc: response_format NO va al nivel superior, va dentro de extra_body.
          extra_body: { response_format: 'url' },
        },
        { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } }
      ),
    {
      label: 'Agnes generar imagen',
      maxRetries: 6,
      baseDelayMs: 3000,
      shouldRetry: shouldRetryImageCall,
    }
  );

  // La respuesta sigue el formato estilo OpenAI: { data: [ { url } ] } o { data: [ { b64_json } ] }
  const item = resp.data?.data?.[0];
  if (!item) {
    logger.error('Respuesta de imagen de Agnes sin data reconocible', { respuesta: JSON.stringify(resp.data).slice(0, 300) });
    throw new Error('Agnes no devolvio una imagen reconocible.');
  }

  const safeName = `image-${Date.now()}`;
  const localPath = path.join(outputDir, `${safeName}.png`);

  if (item.url) {
    const fileResp = await withRetry(
      () => axios.get(item.url, { responseType: 'arraybuffer', timeout: 60000 }),
      { label: 'Descarga de imagen Agnes' }
    );
    fs.writeFileSync(localPath, Buffer.from(fileResp.data));
    logger.info('Imagen generada y descargada', { localPath, imageUrl: item.url });
    return { imageUrl: item.url, localPath, prompt };
  }

  if (item.b64_json) {
    fs.writeFileSync(localPath, Buffer.from(item.b64_json, 'base64'));
    logger.info('Imagen generada (base64) y guardada', { localPath });
    return { imageUrl: null, localPath, prompt };
  }

  throw new Error('Agnes devolvio un item de imagen sin url ni b64_json.');
}

/**
 * Re-aloja una imagen local en Agnes usando image-to-image, para obtener una
 * URL publica (necesaria para publicar en Instagram, que no acepta archivos
 * locales). Se le pide a Agnes que NO modifique la imagen, solo re-alojarla.
 *
 * IMPORTANTE: esto es experimental — Agnes podria alterar levemente la imagen
 * al procesarla. Por eso el prompt insiste en preservarla exacta. Verificar
 * el resultado en las primeras pruebas.
 *
 * @param {string} localImagePath - imagen editada local (con texto encima)
 * @returns {Promise<string>} URL publica de la imagen en Agnes
 */
async function rehostImage(localImagePath) {
  if (DRY_RUN) {
    logger.info('[MOCK] Re-alojado simulado de imagen (sin llamada real)', { localImagePath });
    return 'https://mock.agnes-ai.example/mock-image.png';
  }
  if (!API_KEY) throw new Error('Falta AGNES_API_KEY en .env');
  if (!fs.existsSync(localImagePath)) throw new Error(`No existe la imagen a re-alojar: ${localImagePath}`);

  const imageBuffer = fs.readFileSync(localImagePath);
  const dataUri = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  logger.info('Re-alojando imagen editada en Agnes (image-to-image)', { localImagePath });

  const resp = await withRetry(
    () =>
      axios.post(
        `${BASE_URL}/v1/images/generations`,
        {
          model: process.env.AGNES_IMAGE_EDIT_MODEL || 'agnes-image-2.0-flash',
          prompt: 'Return this exact image completely unchanged. Do not modify, redraw, restyle, add, or remove anything. Preserve every pixel, all existing text overlays, and the exact composition as-is.',
          size: '1024x1024',
          extra_body: {
            image: [dataUri],
            response_format: 'url',
          },
        },
        { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, timeout: 120000 }
      ),
    { label: 'Agnes re-alojar imagen', maxRetries: 5, baseDelayMs: 3000, shouldRetry: shouldRetryImageCall }
  );

  const url = resp.data?.data?.[0]?.url;
  if (!url) throw new Error('Agnes no devolvio una URL al re-alojar la imagen.');

  logger.info('Imagen re-alojada, URL publica obtenida', { url });
  return url;
}

module.exports = { generateImage, rehostImage };
