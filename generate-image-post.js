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

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

async function generarPostParaCuenta(accountName) {
  const account = loadAccount(accountName);
  const contentProfile = account.contentProfile || 'curious4d';

  const workDir = path.join(__dirname, 'output', `imgpost-${accountName}-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  const post = await generateImagePostScript({ profile: contentProfile, account: accountName });
  post.titulo = corregirOrtografia(post.titulo);
  agregarAlHistorial(accountName, post.titulo || post.topic);
  logger.info('Post de imagen: guion listo', {
    account: accountName,
    titulo: post.titulo,
    topic: post.topic,
  });

  const { localPath: rawImagePath, imageUrl: rawImageUrl } = await generateImage(post.imagePrompt, {
    outputDir: workDir,
    size: '1024x1024',
  });

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

  const descripcion = construirDescripcionConHashtags(post, contentProfile);

  const fbPromise = publishFacebookPhoto({
    pageId: account.facebookPageId,
    pageAccessToken: account.facebookPageAccessToken,
    localPath: finalImagePath,
    message: descripcion,
  });

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

const HASHTAGS_VIRALES = {
  curious4d: ['viral', 'sabiasque', 'curiosidades', 'datoscuriosos', 'aprendeenreels', 'increible'],
  hipotesis4d: ['viral', 'sabiasque', 'hipotesis', 'quepasariasi', 'imaginacion', 'increible'],
};

function construirDescripcionConHashtags(post, contentProfile) {
  const virales = ['viral', 'parati'];
  const especificos = (post.tags || [])
    .map((t) => normalizarHashtag(t))
    .filter((t) => t && !virales.includes(t));

  const combinados = [...new Set(especificos)].slice(0, 3);
  for (const v of virales) {
    if (combinados.length >= 5) break;
    if (!combinados.includes(v)) combinados.push(v);
  }
  const lineaHashtags = combinados.map((h) => '#' + h).join(' ');

  return `${post.descripcion.trim()}\n\n${lineaHashtags}`;
}

function normalizarHashtag(tag) {
  return tag
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') 
    .replace(/[^a-z0-9]/g, ''); 
}

async function main() {
  const ACCOUNTS_PATH = process.env.ACCOUNTS_PATH;
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    logger.error('No se encontro accounts.json.', { ACCOUNTS_PATH });
    process.exitCode = 1;
    return;
  }
  const todasLasCuentas = Object.keys(JSON.parse(fs.readFileSync(ACCOUNTS_PATH)));

  const cuentaPedida = (process.argv[2] || '').trim();
  const accountNames = cuentaPedida ? todasLasCuentas.filter((c) => c === cuentaPedida) : todasLasCuentas;

  if (cuentaPedida && accountNames.length === 0) {
    logger.error('La cuenta pedida no existe en accounts.json', { cuentaPedida });
    process.exitCode = 1;
    return;
  }

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
