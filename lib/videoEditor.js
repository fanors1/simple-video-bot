const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const ffmpeg = require('fluent-ffmpeg');
const logger = require('./logger');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/**
 * Devuelve la duracion en segundos de un archivo de audio/video.
 */
function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

/**
 * Ajusta un clip de video para que dure EXACTAMENTE lo mismo que su
 * audio de narracion, y los une en un solo mini-clip.
 *  - Si el audio es mas corto que el video: recorta el video.
 *  - Si el audio es mas largo que el video: repite el video en loop
 *    hasta cubrir la duracion completa del audio.
 * Esto es lo que garantiza que cada corte de escena coincida siempre
 * con el final de una frase, sin importar cuanto dure cada segmento.
 */
async function buildSyncedSegment(videoPath, audioPath, outputPath) {
  const [videoDuration, audioDuration] = await Promise.all([
    getDuration(videoPath),
    getDuration(audioPath),
  ]);

  logger.info('Sincronizando segmento', {
    videoDuration: videoDuration.toFixed(2),
    audioDuration: audioDuration.toFixed(2),
  });

  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    if (videoDuration < audioDuration) {
      const loops = Math.ceil(audioDuration / videoDuration);
      command.input(videoPath).inputOptions([`-stream_loop ${loops - 1}`]);
    } else {
      command.input(videoPath);
    }

    command
      .input(audioPath)
      .outputOptions([
        '-map 0:v:0',
        '-map 1:a:0',
        // Escalamos de 720x1280 (lo que genera Agnes) a 1080x1920, el
        // estandar de facto 2026 para Reels/Shorts/TikTok. No agrega
        // detalle que no estuviera ya en el clip original, pero evita
        // que cada plataforma haga su propio reescalado (que suele
        // verse peor) y nos deja fijar un bitrate real.
        '-sws_flags lanczos',
        '-vf scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
        '-c:v libx264',
        '-b:v 8M',
        '-maxrate 9M',
        '-bufsize 16M',
        '-c:a aac',
        '-b:a 160k',
        `-t ${audioDuration}`,
      ])
      .on('error', (err, stdout, stderr) => {
        // ffmpeg escribe la causa real en stderr; sin esto el error
        // llega como 'undefined' y no se sabe que fallo.
        const detalle = stderr ? ((err && err.message ? err.message : 'ffmpeg error') + ' | stderr: ' + stderr) : (err && err.message ? err.message : String(err));
        reject(new Error(detalle));
      })
      .on('end', () => resolve({ outputPath, duration: audioDuration }))
      .save(outputPath);
  });
}

/**
 * Concatena varios segmentos ya sincronizados (video+audio del mismo largo)
 * en un solo archivo final, en el orden dado.
 */
function concatSyncedSegments(segmentPaths, outputPath) {
  return new Promise((resolve, reject) => {
    logger.info('Concatenando segmentos sincronizados', { count: segmentPaths.length, outputPath });

    const listPath = outputPath + '.list.txt';
    const listContent = segmentPaths
      .map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(listPath, listContent);

    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .on('error', (err, stdout, stderr) => {
        // ffmpeg escribe la causa real en stderr; sin esto el error
        // llega como 'undefined' y no se sabe que fallo.
        const detalle = stderr ? ((err && err.message ? err.message : 'ffmpeg error') + ' | stderr: ' + stderr) : (err && err.message ? err.message : String(err));
        reject(new Error(detalle));
      })
      .on('end', () => {
        fs.unlinkSync(listPath);
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

/**
 * Quema (incrusta) un archivo de subtitulos .ass sobre un video, en
 * un archivo nuevo. El .ass ya trae el estilo y posicion definidos
 * (ver lib/subtitles.js), asi que aqui solo se aplica.
 */
function burnSubtitles(videoPath, assPath, outputPath) {
  return new Promise((resolve, reject) => {
    logger.info('Quemando subtitulos en el video', { videoPath, assPath, outputPath });

    // ffmpeg necesita las rutas de Windows con barras normales (/) en vez
    // de barras invertidas (\) dentro de argumentos de filtro, y el ":"
    // de la letra de unidad (C:) escapado con UNA sola barra invertida.
    // En Linux (GitHub Actions) las rutas ya vienen con / y sin letra de
    // unidad, asi que este replace es inofensivo alli y necesario en Windows.
    const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

    ffmpeg()
      .input(videoPath)
      .outputOptions([
        `-vf subtitles='${escapedAssPath}'`,
        '-c:a copy',
      ])
      .on('error', (err, stdout, stderr) => {
        // ffmpeg escribe la causa real en stderr; sin esto el error
        // llega como 'undefined' y no se sabe que fallo.
        const detalle = stderr ? ((err && err.message ? err.message : 'ffmpeg error') + ' | stderr: ' + stderr) : (err && err.message ? err.message : String(err));
        reject(new Error(detalle));
      })
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

/**
 * Superpone una marca de agua (logo) sobre el video, en una esquina,
 * chica y con opacidad reducida para que no estorbe visualmente.
 * Se ubica arriba a la derecha (los subtitulos van abajo, asi no se pisan).
 *
 * @param {string} videoPath - video de entrada (1080x1920 esperado)
 * @param {string} watermarkPath - imagen PNG con transparencia (el logo)
 * @param {string} outputPath - archivo de salida
 * @param {object} [options]
 * @param {number} [options.widthPx=225] - ancho de la marca de agua en pixeles
 *   (225px sobre 1080px de ancho = ~20.8%, la misma proporcion que tenia
 *   antes con 150px sobre 720px, para que se vea igual de grande que antes)
 * @param {number} [options.opacity=0.22] - opacidad final (0 a 1). Se multiplica
 *   por la transparencia que ya tenga el propio PNG.
 * @param {number} [options.marginPx=30] - separacion del borde (escalado 1.5x junto con la resolucion)
 */
function applyWatermark(videoPath, watermarkPath, outputPath, options = {}) {
  const { widthPx = 225, opacity = 0.22, marginPx = 30 } = options;

  return new Promise((resolve, reject) => {
    logger.info('Aplicando marca de agua', { videoPath, watermarkPath, outputPath, widthPx, opacity });

    ffmpeg()
      .input(videoPath)
      .input(watermarkPath)
      .complexFilter([
        `[1:v]scale=${widthPx}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm]`,
        `[0:v][wm]overlay=W-w-${marginPx}:${marginPx}:format=auto[out]`,
      ])
      .outputOptions(['-map [out]', '-map 0:a?', '-c:v libx264', '-c:a copy'])
      .on('error', (err, stdout, stderr) => {
        // ffmpeg escribe la causa real en stderr; sin esto el error
        // llega como 'undefined' y no se sabe que fallo.
        const detalle = stderr ? ((err && err.message ? err.message : 'ffmpeg error') + ' | stderr: ' + stderr) : (err && err.message ? err.message : String(err));
        reject(new Error(detalle));
      })
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

module.exports = { getDuration, buildSyncedSegment, concatSyncedSegments, burnSubtitles, applyWatermark };
