const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const logger = require('./logger');

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function buildAuthClient({ credentialsPath, tokenPath }) {
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`No encuentro ${credentialsPath}. Descargalo de Google Cloud Console (OAuth client Desktop).`);
  }
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`No encuentro ${tokenPath}. Corre "npm run setup:youtube" una vez para generarlo.`);
  }

  const { client_id, client_secret } = JSON.parse(fs.readFileSync(credentialsPath)).installed;
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
  oauth2Client.setCredentials(JSON.parse(fs.readFileSync(tokenPath)));

  oauth2Client.on('tokens', (tokens) => {
    try {
      const current = JSON.parse(fs.readFileSync(tokenPath));
      fs.writeFileSync(tokenPath, JSON.stringify({ ...current, ...tokens }, null, 2));
      logger.info('Token de YouTube renovado y guardado', { tokenPath });
    } catch (err) {
      logger.warn('No se pudo persistir el token renovado de YouTube', { error: err.message });
    }
  });

  return oauth2Client;
}

async function publishShort({ localPath, title, description, tags = [], credentialsPath, tokenPath }) {
  if (DRY_RUN) {
    logger.info('[MOCK] Publicacion simulada en YouTube (sin llamada real)', { localPath, title });
    return { mock: true };
  }

  if (!localPath) throw new Error('publishShort requiere localPath (archivo de video local).');

  const CREDENTIALS_PATH = credentialsPath || process.env.YOUTUBE_CREDENTIALS_PATH || './youtube-credentials.json';
  const TOKEN_PATH = tokenPath || process.env.YOUTUBE_TOKEN_PATH || './youtube-token.json';

  const auth = buildAuthClient({ credentialsPath: CREDENTIALS_PATH, tokenPath: TOKEN_PATH });
  const youtube = google.youtube({ version: 'v3', auth });

  const finalTitle = /#shorts/i.test(title) ? title : `${title} #Shorts`;

  logger.info('Subiendo Short a YouTube', { title: finalTitle });

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: finalTitle.slice(0, 100),
        description: description || '',
        tags: tags.slice(0, 15),
        categoryId: '27', 
      },
      status: {
        privacyStatus: process.env.YOUTUBE_PRIVACY || 'public',
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
      },
    },
    media: {
      body: fs.createReadStream(localPath),
    },
  });

  logger.info('Short publicado en YouTube', { videoId: res.data.id });
  return { videoId: res.data.id };
}

async function publishVideo({ localPath, title, description, tags = [], credentialsPath, tokenPath }) {
  if (DRY_RUN) {
    logger.info('[MOCK] Publicacion simulada de video largo en YouTube', { localPath, title });
    return { mock: true };
  }

  if (!localPath) throw new Error('publishVideo requiere localPath (archivo de video local).');

  const CREDENTIALS_PATH = credentialsPath || process.env.YOUTUBE_CREDENTIALS_PATH || './youtube-credentials.json';
  const TOKEN_PATH = tokenPath || process.env.YOUTUBE_TOKEN_PATH || './youtube-token.json';

  const auth = buildAuthClient({ credentialsPath: CREDENTIALS_PATH, tokenPath: TOKEN_PATH });
  const youtube = google.youtube({ version: 'v3', auth });

  logger.info('Subiendo video largo a YouTube', { title: title.slice(0, 100) });

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.slice(0, 100),
        description: description || '',
        tags: tags.slice(0, 15),
        categoryId: '27',
      },
      status: {
        privacyStatus: process.env.YOUTUBE_PRIVACY || 'public',
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
      },
    },
    media: {
      body: fs.createReadStream(localPath),
    },
  });

  logger.info('Video largo publicado en YouTube', { videoId: res.data.id });
  return { videoId: res.data.id };
}

async function setThumbnail({ videoId, thumbnailPath, credentialsPath, tokenPath }) {
  if (DRY_RUN) {
    logger.info('[MOCK] Miniatura simulada para YouTube', { videoId, thumbnailPath });
    return { mock: true };
  }
  if (!videoId || !thumbnailPath || !fs.existsSync(thumbnailPath)) {
    logger.warn('setThumbnail: falta videoId o el archivo de miniatura no existe', { videoId, thumbnailPath });
    return { skipped: true };
  }

  const CREDENTIALS_PATH = credentialsPath || process.env.YOUTUBE_CREDENTIALS_PATH || './youtube-credentials.json';
  const TOKEN_PATH = tokenPath || process.env.YOUTUBE_TOKEN_PATH || './youtube-token.json';

  const auth = buildAuthClient({ credentialsPath: CREDENTIALS_PATH, tokenPath: TOKEN_PATH });
  const youtube = google.youtube({ version: 'v3', auth });

  try {
    await youtube.thumbnails.set({
      videoId,
      media: { body: fs.createReadStream(thumbnailPath) },
    });
    logger.info('Miniatura subida a YouTube', { videoId });
    return { ok: true };
  } catch (err) {
    const motivo = err?.errors?.[0]?.reason || err?.message || 'desconocido';
    if (/thumbnail|forbidden|verif/i.test(motivo)) {
      logger.warn('YouTube rechazo la miniatura. Probablemente el canal no esta verificado (se necesita verificacion con telefono en youtube.com/verify para subir miniaturas personalizadas).', { videoId, motivo });
    } else {
      logger.warn('No se pudo subir la miniatura a YouTube', { videoId, motivo });
    }
    return { skipped: true, motivo };
  }
}

module.exports = { publishShort, publishVideo, setThumbnail };
