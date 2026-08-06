const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');

process.env.ACCOUNTS_PATH = process.env.ACCOUNTS_PATH || path.join(__dirname, 'accounts.json');

const logger = require('./lib/logger');
const { generateLongScript } = require('./lib/longScript');
const { generateVideo } = require('./lib/agnes');
const { textToSpeech } = require('./lib/tts');
const { buildSyncedSegment, concatSyncedSegments, burnSubtitles, applyWatermark, mezclarAmbienteTenebroso } = require('./lib/videoEditor');
const { buildAssSubtitles } = require('./lib/subtitles');
const { publishVideo, setThumbnail } = require('./lib/youtube');
const { generateThumbnail } = require('./lib/thumbnail');
const { loadAccount } = require('./lib/accounts');
const { agregarAlHistorial } = require('./lib/historial');

process.on('unhandledRejection', (reason) => logger.error('Unhandled Rejection', { reason: reason?.message || reason }));
process.on('uncaughtException', (err) => logger.error('Uncaught Exception', { error: err.message }));

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const NUM_PUNTOS = Number(process.env.LONG_NUM_PUNTOS) || 5;

function buildDescription(script, account) {
  const hashtags = (script.tags || []).map((t) => '#' + t.replace(/\s+/g, '')).join(' ');
  const cuerpo = script.descripcion || script.intro.narration;
  let bloqueBusquedas = '';
  if (Array.isArray(script.keywordsReales) && script.keywordsReales.length) {
    bloqueBusquedas = '\n\n' + script.keywordsReales.slice(0, 8).join(' | ');
  }
  return `${script.topic}\n\n${cuerpo}${bloqueBusquedas}\n\n${hashtags}`;
}

async function generarVideoLargoParaCuenta(accountName) {
  const account = loadAccount(accountName);
  const contentProfile = account.contentProfile || 'curious4d';

  const workDir = path.join(__dirname, 'output', `long-${accountName}-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  const script = await generateLongScript({ profile: contentProfile, numPuntos: NUM_PUNTOS, account: accountName });
  agregarAlHistorial(accountName, script.topic);
  logger.info('Guion largo listo', { account: accountName, topic: script.topic, puntos: script.puntos.length });

  const bloques = [
    { narration: script.intro.narration, visualPrompt: script.intro.visualPrompt },
    ...script.puntos,
    { narration: script.cierre.narration, visualPrompt: script.cierre.visualPrompt },
  ];

  const syncedPaths = [];
  const durations = [];
  const segmentsParaSub = [];

  for (let i = 0; i < bloques.length; i++) {
    const bloque = bloques[i];

    const { localPath: clipPath } = await generateVideo(script.topic, {
      outputDir: workDir,
      rawPrompt: bloque.visualPrompt,
      horizontal: true,
    });

    const audioPath = path.join(workDir, `segment-${i}.mp3`);
    let syncedPath = path.join(workDir, `synced-${i}.mp4`);

    if (DRY_RUN) {
      fs.writeFileSync(audioPath, Buffer.alloc(100));
      fs.writeFileSync(syncedPath, Buffer.alloc(100));
      durations.push(5);
    } else {
      await textToSpeech(bloque.narration, audioPath, { voice: account.voice, rate: account.voiceRate, pitch: account.voicePitch });
      const { duration } = await buildSyncedSegment(clipPath, audioPath, syncedPath, { horizontal: true });
      durations.push(duration);
    }

    syncedPaths.push(syncedPath);
    segmentsParaSub.push({ narration: bloque.narration });
  }

  const duracionTotal = durations.reduce((a, b) => a + b, 0);
  logger.info('Video largo: duracion total estimada', { account: accountName, minutos: (duracionTotal / 60).toFixed(1) });

  let finalPath;

  if (DRY_RUN) {
    finalPath = path.join(workDir, 'video-largo-simulado.mp4');
    fs.writeFileSync(finalPath, Buffer.alloc(100));
    logger.info('[MOCK] Video largo simulado', { finalPath });
  } else {
    const concatPath = path.join(workDir, 'concat.mp4');
    await concatSyncedSegments(syncedPaths, concatPath);

    const ADD_SUBTITLES = (process.env.ADD_SUBTITLES || 'true').toLowerCase() !== 'false';
    let subtitledPath = concatPath;
    if (ADD_SUBTITLES) {
      const assPath = path.join(workDir, 'subtitulos.ass');
      buildAssSubtitles(segmentsParaSub, durations, assPath, { videoHeight: 1080 });
      subtitledPath = path.join(workDir, 'con-subtitulos.mp4');
      await burnSubtitles(concatPath, assPath, subtitledPath);
    }

    const ADD_WATERMARK = (process.env.ADD_WATERMARK || 'true').toLowerCase() !== 'false';
    const WATERMARK_PATH = path.resolve(__dirname, account.watermarkPath || './assets/logo.png');
    if (ADD_WATERMARK && fs.existsSync(WATERMARK_PATH)) {
      finalPath = path.join(workDir, 'video-largo-final.mp4');
      await applyWatermark(subtitledPath, WATERMARK_PATH, finalPath);
    } else {
      finalPath = subtitledPath;
    }

    if (account.ambienteTenebroso) {
      const conAmbiente = path.join(workDir, 'video-largo-ambiente.mp4');
      try {
        await mezclarAmbienteTenebroso(finalPath, conAmbiente, { volumen: account.ambienteVolumen || 0.15 });
        finalPath = conAmbiente;
      } catch (err) {
        logger.warn('No se pudo mezclar el ambiente tenebroso en el video largo', { account: accountName, error: err.message });
      }
    }
  }

  logger.info('Video largo final listo', { account: accountName, finalPath, topic: script.topic });

  const description = buildDescription(script, account);

  let thumbnailPath = null;
  try {
    logger.info('Iniciando generacion de miniatura', { account: accountName, topic: script.topic });
    thumbnailPath = await generateThumbnail(script.topic, contentProfile, workDir);
    logger.info('Miniatura lista para subir', { account: accountName, thumbnailPath });
  } catch (err) {
    logger.warn('No se pudo generar la miniatura, el video se publicara sin ella', { account: accountName, error: err.message });
  }

  try {
    const result = await publishVideo({
      localPath: finalPath,
      title: script.topic,
      description,
      tags: script.tags,
      credentialsPath: account.youtubeCredentialsPath,
      tokenPath: account.youtubeTokenPath,
    });
    logger.info('YouTube (largo): OK', { account: accountName, videoId: result.videoId });

    if (thumbnailPath && result.videoId) {
      logger.info('Subiendo miniatura al video', { account: accountName, videoId: result.videoId });
      try {
        const rt = await setThumbnail({
          videoId: result.videoId,
          thumbnailPath,
          credentialsPath: account.youtubeCredentialsPath,
          tokenPath: account.youtubeTokenPath,
        });
        logger.info('Resultado de subir miniatura', { account: accountName, resultado: JSON.stringify(rt) });
      } catch (err) {
        logger.warn('No se pudo subir la miniatura', { account: accountName, error: err.message });
      }
    } else {
      logger.warn('No se sube miniatura', { account: accountName, hayThumbnail: !!thumbnailPath, hayVideoId: !!result.videoId });
    }
  } catch (err) {
    logger.error('YouTube (largo): fallo', { account: accountName, error: err.message });
  }
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
      await generarVideoLargoParaCuenta(accountName);
    } catch (err) {
      logger.error('Video largo: fallo el pipeline para esta cuenta', { account: accountName, error: err.message, stack: err.stack });
    }
  }

  logger.info('Proceso de videos largos completo');
}

main();
