const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');

// Anclamos ACCOUNTS_PATH antes de requerir ./lib/accounts (que lo lee al
// cargarse) para que funcione sin importar el cwd (Task Scheduler / GitHub Actions).
process.env.ACCOUNTS_PATH = process.env.ACCOUNTS_PATH || path.join(__dirname, 'accounts.json');

const logger = require('./lib/logger');
const { generateScript } = require('./lib/script');
const { generateVideo } = require('./lib/agnes');
const { textToSpeech } = require('./lib/tts');
const { buildSyncedSegment, burnSubtitles, applyWatermark } = require('./lib/videoEditor');
const { buildAssSubtitles } = require('./lib/subtitles');
const { publishStory: publishFacebookStory } = require('./lib/facebook');
const { publishStory: publishInstagramStory } = require('./lib/instagram');
const { loadAccount } = require('./lib/accounts');
const { agregarAlHistorial } = require('./lib/historial');

process.on('unhandledRejection', (reason) => logger.error('Unhandled Rejection', { reason: reason?.message || reason }));
process.on('uncaughtException', (err) => logger.error('Uncaught Exception', { error: err.message }));

// ============================================================
//  Genera y publica SOLO la Historia (Facebook + Instagram), con
//  contenido NUEVO y corto (1 segmento, ~5s). Corre para TODAS las
//  cuentas de accounts.json automaticamente. La frecuencia la controla
//  el scheduler (Task Scheduler local o cron de GitHub Actions).
// ============================================================

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

async function generarHistoriaParaCuenta(accountName) {
  const account = loadAccount(accountName);

  const workDir = path.join(__dirname, 'output', `story-${accountName}-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  const contentProfile = account.contentProfile || 'curious4d';
  const script = await generateScript({ profile: contentProfile, segmentCount: 1, account: accountName });
  agregarAlHistorial(accountName, script.topic);
  logger.info('Guion de Historia listo', {
    account: accountName,
    topic: script.topic,
    triggerType: script.triggerType,
    hookText: script.hookText,
  });

  const segment = script.segments[0];

  const { localPath: clipPath } = await generateVideo(script.topic, {
    outputDir: workDir,
    rawPrompt: segment.visualPrompt,
  });

  const audioPath = path.join(workDir, 'segment-0.mp3');
  let finalPath;

  if (DRY_RUN) {
    fs.writeFileSync(audioPath, Buffer.alloc(100));
    finalPath = path.join(workDir, 'historia-simulada.mp4');
    fs.writeFileSync(finalPath, Buffer.alloc(100));
    logger.info('[MOCK] Historia simulada (sin llamadas reales a TTS/ffmpeg)', { finalPath });
  } else {
    await textToSpeech(segment.narration, audioPath);

    const syncedPath = path.join(workDir, 'synced-0.mp4');
    const { duration } = await buildSyncedSegment(clipPath, audioPath, syncedPath);

    const ADD_SUBTITLES = (process.env.ADD_SUBTITLES || 'true').toLowerCase() !== 'false';
    let subtitledPath = syncedPath;
    if (ADD_SUBTITLES) {
      const assPath = path.join(workDir, 'subtitulos.ass');
      buildAssSubtitles([segment], [duration], assPath, { hookText: script.hookText });
      subtitledPath = path.join(workDir, 'historia-subtitulos.mp4');
      await burnSubtitles(syncedPath, assPath, subtitledPath);
    }

    const ADD_WATERMARK = (process.env.ADD_WATERMARK || 'true').toLowerCase() !== 'false';
    const WATERMARK_PATH = path.resolve(__dirname, account.watermarkPath || process.env.WATERMARK_PATH || './assets/logo.png');
    if (ADD_WATERMARK && fs.existsSync(WATERMARK_PATH)) {
      finalPath = path.join(workDir, 'historia-final.mp4');
      await applyWatermark(subtitledPath, WATERMARK_PATH, finalPath);
    } else {
      finalPath = subtitledPath;
    }
  }

  logger.info('Historia final lista', { account: accountName, finalPath, topic: script.topic });

  const [fbResult, igResult] = await Promise.allSettled([
    publishFacebookStory({
      pageId: account.facebookPageId,
      pageAccessToken: account.facebookPageAccessToken,
      localPath: finalPath,
    }),
    publishInstagramStory({
      pageId: account.facebookPageId,
      pageAccessToken: account.instagramAccessToken || account.facebookPageAccessToken,
      localPath: finalPath,
    }),
  ]);

  if (fbResult.status === 'fulfilled') logger.info('Facebook Historia: OK', { account: accountName, ...fbResult.value });
  else logger.error('Facebook Historia: fallo', { account: accountName, error: fbResult.reason.message });

  if (igResult.status === 'fulfilled') logger.info('Instagram Historia: OK', { account: accountName, ...igResult.value });
  else logger.error('Instagram Historia: fallo', { account: accountName, error: igResult.reason.message });
}

async function main() {
  const ACCOUNTS_PATH = process.env.ACCOUNTS_PATH;
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    logger.error('No se encontro accounts.json, no hay cuentas para procesar historias.', { ACCOUNTS_PATH });
    process.exitCode = 1;
    return;
  }
  const accountNames = Object.keys(JSON.parse(fs.readFileSync(ACCOUNTS_PATH)));

  for (const accountName of accountNames) {
    try {
      await generarHistoriaParaCuenta(accountName);
    } catch (err) {
      logger.error('Historia: fallo el pipeline para esta cuenta', { account: accountName, error: err.message, stack: err.stack });
    }
  }

  logger.info('Proceso de historias diarias completo');
}

main();
