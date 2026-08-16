const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');

process.env.ACCOUNTS_PATH = process.env.ACCOUNTS_PATH || path.join(__dirname, 'accounts.json');

const logger = require('./lib/logger');
const { generateScript } = require('./lib/script');
const { generateVideo } = require('./lib/agnes');
const { textToSpeech } = require('./lib/tts');
const { buildSyncedSegment, concatSyncedSegments, burnSubtitles, applyWatermark, mezclarAmbienteTenebroso, mezclarAmbienteAngelical } = require('./lib/videoEditor');
const { buildAssSubtitles } = require('./lib/subtitles');
const { publishShort: publishYouTubeShort } = require('./lib/youtube');
const { publishReel: publishFacebookReel } = require('./lib/facebook');
const { publishReel: publishInstagramReel } = require('./lib/instagram');
const { loadAccount } = require('./lib/accounts');
const { agregarAlHistorial } = require('./lib/historial');

process.on('unhandledRejection', (reason) => logger.error('Unhandled Rejection', { reason: reason?.message || reason }));
process.on('uncaughtException', (err) => logger.error('Uncaught Exception', { error: err.message }));

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const SEGMENT_COUNT = Number(process.env.SEGMENT_COUNT) || 7;

function buildDescription(script, account) {
  const hashtags = (script.tags || []).map((t) => '#' + t.replace(/\s+/g, '')).slice(0, 5).join(' ');
  const base = script.topic || '';
  return `${base}\n\n${hashtags}`.trim();
}

const YOUTUBE_CATEGORIES = {
  curious4d: '27',
  hipotesis4d: '24',
  oscuro4d: '24',
  vive4d: '22',
};

const TIKTOK_HASHTAG_FIJO = {
  curious4d: 'curiosidades',
  hipotesis4d: 'quepasariasi',
  oscuro4d: 'historiasdeterror',
  vive4d: 'biblia',
};

const TIKTOK_HASHTAGS_NICHO = {
  curious4d: ['datoscuriosos', 'sabiasque', 'aprendeentiktok', 'datosinteresantes'],
  hipotesis4d: ['historiaalternativa', 'hipotesis', 'reflexion', 'datoscuriosos'],
  oscuro4d: ['terror', 'miedo', 'paranormal', 'leyendas'],
  vive4d: ['fe', 'dios', 'jesus', 'versiculos', 'esperanza'],
};

const TIKTOK_HASHTAGS_ALCANCE = ['parati', 'fyp'];

function buildTikTokCaption(script, contentProfile) {
  const base = (script.topic || '').slice(0, 150);
  const fijo = TIKTOK_HASHTAG_FIJO[contentProfile] || TIKTOK_HASHTAG_FIJO.curious4d;
  const nichoPool = TIKTOK_HASHTAGS_NICHO[contentProfile] || TIKTOK_HASHTAGS_NICHO.curious4d;
  const nichoVariable = [...nichoPool].sort(() => Math.random() - 0.5).slice(0, 2);
  const todos = [...new Set([fijo, ...nichoVariable, ...TIKTOK_HASHTAGS_ALCANCE])].slice(0, 5);
  const hashtags = todos.map((t) => '#' + t).join(' ');
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
    const syncedPaths = [];
    const durations = [];
    for (let i = 0; i < script.segments.length; i++) {
      const segment = script.segments[i];

      const { localPath: clipPath } = await generateVideo(script.topic, {
        outputDir: workDir,
        rawPrompt: segment.visualPrompt,
      });

      const audioPath = path.join(workDir, `segment-${i}.mp3`);
      await textToSpeech(segment.narration, audioPath, { voice: account.voice, rate: account.voiceRate, pitch: account.voicePitch, corregirCitas: account.contentProfile === 'vive4d' });

      const syncedPath = path.join(workDir, `synced-${i}.mp4`);
      const { duration } = await buildSyncedSegment(clipPath, audioPath, syncedPath, { zoomEntrada: i === 0 });
      syncedPaths.push(syncedPath);
      durations.push(duration);
    }

    const duracionTotal = durations.reduce((a, b) => a + b, 0);
    if (duracionTotal > 85) {
      logger.warn(`Video largo (${duracionTotal.toFixed(1)}s), cerca del limite de Instagram (90s). Agnes genero narraciones largas en este reel.`, { account: account.name, duracionTotal });
    }

    const concatPath = path.join(workDir, 'concat.mp4');
    await concatSyncedSegments(syncedPaths, concatPath);

    const ADD_SUBTITLES = (process.env.ADD_SUBTITLES || 'true').toLowerCase() !== 'false';
    let subtitledPath = concatPath;
    if (ADD_SUBTITLES) {
      const assPath = path.join(workDir, 'subtitulos.ass');
      buildAssSubtitles(script.segments, durations, assPath, { hookText: script.hookText });
      subtitledPath = path.join(workDir, 'con-subtitulos.mp4');
      await burnSubtitles(concatPath, assPath, subtitledPath);
    }

    const ADD_WATERMARK = (process.env.ADD_WATERMARK || 'true').toLowerCase() !== 'false';
    const WATERMARK_PATH = path.resolve(__dirname, account.watermarkPath || process.env.WATERMARK_PATH || './assets/logo.png');
    if (ADD_WATERMARK && fs.existsSync(WATERMARK_PATH)) {
      finalPath = path.join(workDir, 'reel-final.mp4');
      await applyWatermark(subtitledPath, WATERMARK_PATH, finalPath);
    } else {
      finalPath = subtitledPath;
    }

    if (account.ambienteTenebroso) {
      const conAmbiente = path.join(workDir, 'reel-ambiente.mp4');
      try {
        await mezclarAmbienteTenebroso(finalPath, conAmbiente, { volumen: account.ambienteVolumen || 0.18 });
        finalPath = conAmbiente;
      } catch (err) {
        logger.warn('No se pudo mezclar el ambiente tenebroso, el reel sigue sin el', { account: accountName, error: err.message });
      }
    }

    if (account.ambienteAngelical) {
      const conAmbiente = path.join(workDir, 'reel-angelical.mp4');
      try {
        await mezclarAmbienteAngelical(finalPath, conAmbiente, { volumen: account.ambienteVolumen || 0.28 });
        finalPath = conAmbiente;
      } catch (err) {
        logger.warn('No se pudo mezclar el ambiente angelical, el reel sigue sin el', { account: accountName, error: err.message });
      }
    }
  }

  logger.info('Reel final listo', { account: accountName, finalPath, topic: script.topic });

  const description = buildDescription(script, account);

  const [ytResult, fbResult, igResult, ttResult] = await Promise.allSettled([
    publishYouTubeShort({
      localPath: finalPath,
      title: script.topic,
      description,
      tags: script.tags,
      credentialsPath: account.youtubeCredentialsPath,
      tokenPath: account.youtubeTokenPath,
      categoryId: YOUTUBE_CATEGORIES[account.contentProfile] || '27',
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
    publishTikTokIfAvailable(account, finalPath, description, script),
  ]);

  logResult('YouTube', accountName, ytResult);
  logResult('Facebook', accountName, fbResult);
  logResult('Instagram', accountName, igResult);
  logResult('TikTok', accountName, ttResult);
}

async function publishTikTokIfAvailable(account, finalPath, description, script) {
  if (String(process.env.TIKTOK_ENABLED || 'true').toLowerCase() === 'false') {
    logger.info('TikTok: pausado globalmente (TIKTOK_ENABLED=false), se omite');
    return { skipped: true, pausado: true };
  }
  let publishVideo;
  try {
    ({ publishVideo } = require('./lib/tiktok'));
  } catch {
    logger.info('TikTok: modulo no disponible, se omite');
    return { skipped: true };
  }
  const apiKey = process.env.ZERNIO_API_KEY;
  const perfil = (account.contentProfile || '').toUpperCase();
  const zernioAccountId = account.zernioAccountId || process.env[`ZERNIO_ACCOUNT_${perfil}`];
  if (!apiKey || !zernioAccountId) {
    logger.info('TikTok: sin Zernio configurado, se omite', { hayApiKey: !!apiKey, hayAccountId: !!zernioAccountId, perfil });
    return { skipped: true };
  }
  const caption = script ? buildTikTokCaption(script, account.contentProfile || 'curious4d') : description;
  return publishVideo({ localPath: finalPath, title: caption, zernioAccountId, apiKey });
}

function logResult(plataforma, accountName, result) {
  if (result.status === 'fulfilled') {
    logger.info(`${plataforma}: OK`, { account: accountName, ...(result.value || {}) });
  } else {
    const err = result.reason;
    const detalleMeta = err?.response?.data ? JSON.stringify(err.response.data) : null;
    logger.error(`${plataforma}: fallo`, {
      account: accountName,
      error: err?.message,
      detalleMeta,
    });
  }
}

async function main() {
  const categoria = process.argv[2] || '';
  const cuentaArg = process.argv[3] || '';

  const ACCOUNTS_PATH = process.env.ACCOUNTS_PATH;
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    logger.error('No se encontro accounts.json.', { ACCOUNTS_PATH });
    process.exitCode = 1;
    return;
  }

  const allAccounts = Object.keys(JSON.parse(fs.readFileSync(ACCOUNTS_PATH)));
  const cuentas = cuentaArg ? [cuentaArg] : allAccounts;

  const PAUSA_ENTRE_CUENTAS_MS = Number(process.env.PAUSA_ENTRE_CUENTAS_MS) || 5 * 60 * 1000;

  for (let i = 0; i < cuentas.length; i++) {
    const accountName = cuentas[i];
    try {
      await generarReelParaCuenta(categoria, accountName);
    } catch (err) {
      const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      logger.error('Reel: fallo el pipeline para esta cuenta', {
        account: accountName,
        error: msg,
        stack: err?.stack,
      });
    }

    if (i < cuentas.length - 1 && PAUSA_ENTRE_CUENTAS_MS > 0) {
      const min = Math.round(PAUSA_ENTRE_CUENTAS_MS / 60000);
      logger.info(`Pausa entre cuentas para que Agnes descanse (${min} min) antes de la siguiente`, { proxima: cuentas[i + 1] });
      await new Promise((r) => setTimeout(r, PAUSA_ENTRE_CUENTAS_MS));
    }
  }

  logger.info('Proceso de reels completo');
}

main();
