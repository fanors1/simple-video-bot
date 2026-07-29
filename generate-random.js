const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');

// Anclar ACCOUNTS_PATH antes de requerir ./lib/accounts (lo lee al cargarse).
process.env.ACCOUNTS_PATH = process.env.ACCOUNTS_PATH || path.join(__dirname, 'accounts.json');

const logger = require('./lib/logger');
const { generateScript } = require('./lib/script');
const { generateVideo } = require('./lib/agnes');
const { textToSpeech } = require('./lib/tts');
const { buildSyncedSegment, concatSyncedSegments, burnSubtitles, applyWatermark } = require('./lib/videoEditor');
const { buildAssSubtitles } = require('./lib/subtitles');
const { publishShort: publishYouTubeShort } = require('./lib/youtube');
const { publishReel: publishFacebookReel } = require('./lib/facebook');
const { publishReel: publishInstagramReel } = require('./lib/instagram');
const { loadAccount } = require('./lib/accounts');
const { agregarAlHistorial } = require('./lib/historial');

process.on('unhandledRejection', (reason) => logger.error('Unhandled Rejection', { reason: reason?.message || reason }));
process.on('uncaughtException', (err) => logger.error('Uncaught Exception', { error: err.message }));

// ============================================================
// NOTA: Este archivo fue RECONSTRUIDO integrando los modulos conocidos.
// El flujo (guion -> video por segmento -> audio -> sincronizar -> concatenar
// -> subtitulos -> watermark -> publicar) coincide con lo descripto en el
// historial, pero verificar en la primera prueba real que el resultado sea
// identico al original perdido.
//
// Uso:  node generate-random.js [categoria] [cuenta]
//   - categoria: opcional; si se omite, se elige al azar segun el perfil
//   - cuenta:    opcional; si se omite, se usa la primera de accounts.json
// ============================================================

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const SEGMENT_COUNT = Number(process.env.SEGMENT_COUNT) || 7;

function buildDescription(script, account) {
  const hashtags = (script.tags || []).map((t) => '#' + t.replace(/\s+/g, '')).slice(0, 5).join(' ');
  const base = script.topic || '';
  return `${base}\n\n${hashtags}`.trim();
}

async function generarReelParaCuenta(categoria, accountName) {
  const account = loadAccount(accountName);
  const contentProfile = account.contentProfile || 'curious4d';

  const workDir = path.join(__dirname, 'output', `reel-${accountName}-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  const script = await generateScript({ category: categoria || undefined, segmentCount: SEGMENT_COUNT, profile: contentProfile, account: accountName });
  agregarAlHistorial(accountName, script.topic);
  logger.info('Guion de Reel listo', {
    account: accountName,
    topic: script.topic,
    triggerType: script.triggerType,
    hookText: script.hookText,
    segments: script.segments.length,
  });

  let finalPath;

  if (DRY_RUN) {
    finalPath = path.join(workDir, 'reel-simulado.mp4');
    fs.writeFileSync(finalPath, Buffer.alloc(100));
    logger.info('[MOCK] Reel simulado (sin llamadas reales a Agnes/TTS/ffmpeg)', { finalPath });
  } else {
    // 1) Generar video + audio por cada segmento, y sincronizarlos
    const syncedPaths = [];
    const durations = [];
    for (let i = 0; i < script.segments.length; i++) {
      const segment = script.segments[i];

      const { localPath: clipPath } = await generateVideo(script.topic, {
        outputDir: workDir,
        rawPrompt: segment.visualPrompt,
      });

      const audioPath = path.join(workDir, `segment-${i}.mp3`);
      await textToSpeech(segment.narration, audioPath);

      const syncedPath = path.join(workDir, `synced-${i}.mp4`);
      const { duration } = await buildSyncedSegment(clipPath, audioPath, syncedPath);
      syncedPaths.push(syncedPath);
      durations.push(duration);
    }

    // 2) Concatenar todos los segmentos en un solo video
    const concatPath = path.join(workDir, 'concat.mp4');
    await concatSyncedSegments(syncedPaths, concatPath);

    // 3) Subtitulos (con hook_text quemado al inicio)
    const ADD_SUBTITLES = (process.env.ADD_SUBTITLES || 'true').toLowerCase() !== 'false';
    let subtitledPath = concatPath;
    if (ADD_SUBTITLES) {
      const assPath = path.join(workDir, 'subtitulos.ass');
      buildAssSubtitles(script.segments, durations, assPath, { hookText: script.hookText });
      subtitledPath = path.join(workDir, 'con-subtitulos.mp4');
      await burnSubtitles(concatPath, assPath, subtitledPath);
    }

    // 4) Marca de agua (ultimo paso antes de publicar)
    const ADD_WATERMARK = (process.env.ADD_WATERMARK || 'true').toLowerCase() !== 'false';
    const WATERMARK_PATH = path.resolve(__dirname, account.watermarkPath || process.env.WATERMARK_PATH || './assets/logo.png');
    if (ADD_WATERMARK && fs.existsSync(WATERMARK_PATH)) {
      finalPath = path.join(workDir, 'reel-final.mp4');
      await applyWatermark(subtitledPath, WATERMARK_PATH, finalPath);
    } else {
      finalPath = subtitledPath;
    }
  }

  logger.info('Reel final listo', { account: accountName, finalPath, topic: script.topic });

  const description = buildDescription(script, account);

  // 5) Publicar en las 4 plataformas en paralelo, sin que una tumbe a las otras
  const [ytResult, fbResult, igResult, ttResult] = await Promise.allSettled([
    publishYouTubeShort({
      localPath: finalPath,
      title: script.topic,
      description,
      tags: script.tags,
      credentialsPath: account.youtubeCredentialsPath,
      tokenPath: account.youtubeTokenPath,
    }),
    publishFacebookReel({
      pageId: account.facebookPageId,
      pageAccessToken: account.facebookPageAccessToken,
      localPath: finalPath,
      description,
    }),
    publishInstagramReel({
      pageId: account.facebookPageId,
      pageAccessToken: account.instagramAccessToken || account.facebookPageAccessToken,
      localPath: finalPath,
      description,
    }),
    publishTikTokIfAvailable(account, finalPath, description),
  ]);

  logResult('YouTube', accountName, ytResult);
  logResult('Facebook', accountName, fbResult);
  logResult('Instagram', accountName, igResult);
  logResult('TikTok', accountName, ttResult);
}

// TikTok es opcional: solo se intenta si el modulo existe y hay token.
// (El modulo lib/tiktok.js se reconstruye aparte; si no esta, se omite limpio.)
async function publishTikTokIfAvailable(account, finalPath, description) {
  let publishVideo;
  try {
    ({ publishVideo } = require('./lib/tiktok'));
  } catch {
    logger.info('TikTok: modulo no disponible, se omite');
    return { skipped: true };
  }
  const tokenPath = account.tiktokTokenPath && path.resolve(__dirname, account.tiktokTokenPath);
  if (!tokenPath || !fs.existsSync(tokenPath)) {
    logger.info('TikTok: sin token configurado, se omite', { tokenPath });
    return { skipped: true };
  }
  return publishVideo({ tokenPath, localPath: finalPath, title: description });
}

function logResult(plataforma, accountName, result) {
  if (result.status === 'fulfilled') {
    logger.info(`${plataforma}: OK`, { account: accountName, ...(result.value || {}) });
  } else {
    logger.error(`${plataforma}: fallo`, { account: accountName, error: result.reason.message });
  }
}

async function main() {
  // Argumentos: node generate-random.js [categoria] [cuenta]
  const categoria = process.argv[2] || '';
  const cuentaArg = process.argv[3] || '';

  const ACCOUNTS_PATH = process.env.ACCOUNTS_PATH;
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    logger.error('No se encontro accounts.json.', { ACCOUNTS_PATH });
    process.exitCode = 1;
    return;
  }

  // Si se paso una cuenta especifica, corre solo esa. Si no, corre todas.
  const allAccounts = Object.keys(JSON.parse(fs.readFileSync(ACCOUNTS_PATH)));
  const cuentas = cuentaArg ? [cuentaArg] : allAccounts;

  for (const accountName of cuentas) {
    try {
      await generarReelParaCuenta(categoria, accountName);
    } catch (err) {
      // ffmpeg/fluent-ffmpeg a veces rechaza con algo que NO es un Error
      // (un string, o el stderr suelto), y ahi err.message sale undefined.
      // Normalizamos para siempre loguear una causa util.
      const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      logger.error('Reel: fallo el pipeline para esta cuenta', {
        account: accountName,
        error: msg,
        stack: err?.stack,
      });
    }
  }

  logger.info('Proceso de reels completo');
}

main();
