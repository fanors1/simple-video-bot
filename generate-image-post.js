const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');

process.env.ACCOUNTS_PATH = process.env.ACCOUNTS_PATH || path.join(__dirname, 'accounts.json');

const logger = require('./lib/logger');
const { generateImagePostScript } = require('./lib/script');
const { generateImage, rehostImage } = require('./lib/agnesImage');
const { overlayTitle } = require('./lib/imagePost');
const { corregirOrtografia } = require('./lib/ortografia');
const { agregarAlHistorial } = require('./lib/historial');
const { publishPhoto: publishFacebookPhoto } = require('./lib/facebook');
const { publishPhoto: publishInstagramPhoto } = require('./lib/instagram');
const { loadAccount } = require('./lib/accounts');

process.on('unhandledRejection', (reason) => logger.error('Unhandled Rejection', { reason: reason?.message || reason }));
process.on('uncaughtException', (err) => logger.error('Uncaught Exception', { error: err.message }));

// ============================================================
//  Genera y publica un POST DE IMAGEN impactante (foto fotorrealista de
//  Agnes + titular grande encima) en el feed de Facebook e Instagram.
//  Corre para todas las cuentas de accounts.json.
//
//  Flujo:
//   1. Agnes genera el dato impactante + titular + descripcion (por nicho)
//   2. Agnes genera la imagen fotorrealista
//   3. Se superpone el titular grande encima (ffmpeg), + watermark
//   4. Facebook: publica la imagen editada local
//      Instagram: se re-aloja la imagen en Agnes (URL publica) y se publica
// ============================================================

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

async function generarPostParaCuenta(accountName) {
  const account = loadAccount(accountName);
  const contentProfile = account.contentProfile || 'curious4d';

  const workDir = path.join(__dirname, 'output', `imgpost-${accountName}-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  // 1) Generar el dato impactante + titular + descripcion
  const post = await generateImagePostScript({ profile: contentProfile, account: accountName });
  // Corregir errores ortograficos comunes de Agnes en el titular (queda en
  // letras grandes sobre la imagen, asi que un error se ve mucho).
  post.titulo = corregirOrtografia(post.titulo);
  // Guardar el tema en el historial del canal para no repetirlo en el futuro.
  agregarAlHistorial(accountName, post.titulo || post.topic);
  logger.info('Post de imagen: guion listo', {
    account: accountName,
    titulo: post.titulo,
    topic: post.topic,
  });

  // 2) Generar la imagen fotorrealista
  const { localPath: rawImagePath, imageUrl: rawImageUrl } = await generateImage(post.imagePrompt, {
    outputDir: workDir,
    size: '1024x1024',
  });

  // 3) Superponer el titular grande + watermark
  const WATERMARK_PATH = path.resolve(__dirname, account.watermarkPath || process.env.WATERMARK_PATH || './assets/logo.png');
  const finalImagePath = path.join(workDir, 'post-final.png');

  if (DRY_RUN) {
    fs.copyFileSync(rawImagePath, finalImagePath);
    logger.info('[MOCK] Post de imagen simulado (sin overlay real)', { finalImagePath });
  } else {
    await overlayTitle(rawImagePath, post.titulo, finalImagePath, {
      watermarkPath: fs.existsSync(WATERMARK_PATH) ? WATERMARK_PATH : null,
      width: 1024,
      height: 1024,
    });
  }

  logger.info('Post de imagen: imagen final lista', { account: accountName, finalImagePath });

  // 4) Publicar. Facebook con archivo local; Instagram con URL publica (re-alojada).
  const descripcion = construirDescripcionConHashtags(post, contentProfile);

  // Facebook (archivo local directo)
  const fbPromise = publishFacebookPhoto({
    pageId: account.facebookPageId,
    pageAccessToken: account.facebookPageAccessToken,
    localPath: finalImagePath,
    message: descripcion,
  });

  // Instagram (necesita URL publica: re-alojamos la imagen final en Agnes)
  const igPromise = (async () => {
    let urlPublica;
    if (DRY_RUN) {
      urlPublica = 'https://mock.agnes-ai.example/mock.png';
    } else {
      urlPublica = await rehostImage(finalImagePath);
    }
    return publishInstagramPhoto({
      pageId: account.facebookPageId,
      pageAccessToken: account.instagramAccessToken || account.facebookPageAccessToken,
      imageUrl: urlPublica,
      caption: descripcion,
    });
  })();

  const [fbResult, igResult] = await Promise.allSettled([fbPromise, igPromise]);

  if (fbResult.status === 'fulfilled') logger.info('Facebook Post: OK', { account: accountName, ...fbResult.value });
  else logger.error('Facebook Post: fallo', { account: accountName, error: fbResult.reason.message });

  if (igResult.status === 'fulfilled') logger.info('Instagram Post: OK', { account: accountName, ...igResult.value });
  else logger.error('Instagram Post: fallo', { account: accountName, error: igResult.reason.message });
}

// Hashtags virales genericos por canal, que se combinan con los tags
// especificos del tema. Van iguales en Facebook e Instagram.
const HASHTAGS_VIRALES = {
  curious4d: ['viral', 'sabiasque', 'curiosidades', 'datoscuriosos', 'aprendeenreels', 'increible'],
  hipotesis4d: ['viral', 'sabiasque', 'hipotesis', 'quepasariasi', 'imaginacion', 'increible'],
};

// Construye la descripcion final: el texto del post + una linea en blanco +
// los hashtags (mezcla de los especificos del tema que genero Agnes + los
// genericos virales del canal). Se deduplica y se limita a ~15 hashtags.
function construirDescripcionConHashtags(post, contentProfile) {
  const especificos = (post.tags || []).map((t) => normalizarHashtag(t));
  const genericos = (HASHTAGS_VIRALES[contentProfile] || HASHTAGS_VIRALES.curious4d).map((t) => normalizarHashtag(t));

  // Combinamos: primero los del tema, luego los virales; dedup y tope de 15.
  const combinados = [...new Set([...especificos, ...genericos])].filter(Boolean).slice(0, 15);
  const lineaHashtags = combinados.map((h) => '#' + h).join(' ');

  return `${post.descripcion.trim()}\n\n${lineaHashtags}`;
}

// Convierte un tag ("datos curiosos") en un hashtag valido ("datoscuriosos"):
// quita espacios, tildes y caracteres no alfanumericos.
function normalizarHashtag(tag) {
  return tag
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^a-z0-9]/g, ''); // solo letras y numeros
}

async function main() {
  const ACCOUNTS_PATH = process.env.ACCOUNTS_PATH;
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    logger.error('No se encontro accounts.json.', { ACCOUNTS_PATH });
    process.exitCode = 1;
    return;
  }
  const accountNames = Object.keys(JSON.parse(fs.readFileSync(ACCOUNTS_PATH)));

  for (const accountName of accountNames) {
    try {
      await generarPostParaCuenta(accountName);
    } catch (err) {
      const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      logger.error('Post de imagen: fallo el pipeline para esta cuenta', { account: accountName, error: msg, stack: err?.stack });
    }
  }

  logger.info('Proceso de posts de imagen completo');
}

main();
