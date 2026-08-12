const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const ffmpeg = require('fluent-ffmpeg');
const logger = require('./logger');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

async function buildSyncedSegment(videoPath, audioPath, outputPath, options = {}) {
  const { zoomEntrada = false, horizontal = false } = options;

  const [videoDuration, audioDuration] = await Promise.all([
    getDuration(videoPath),
    getDuration(audioPath),
  ]);

  logger.info('Sincronizando segmento', {
    videoDuration: videoDuration.toFixed(2),
    audioDuration: audioDuration.toFixed(2),
    zoomEntrada,
    horizontal,
  });

  const W = horizontal ? 1920 : 1080;
  const H = horizontal ? 1080 : 1920;
  const filtroBaseEscala = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`;

  const fps = 30;
  const framesZoom = Math.round(2.5 * fps);
  const filtroZoomEscala = `${filtroBaseEscala},` +
    `zoompan=z='if(lte(on,${framesZoom}),min(1.0+on*0.006,1.15),1.15)':d=1:` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${fps}`;

  const necesitaLoop = videoDuration < audioDuration;
  let filtroVideo;

  if (necesitaLoop) {
    const framesClip = Math.max(1, Math.ceil(videoDuration * fps));
    const framesTotal = Math.max(framesClip, Math.ceil(audioDuration * fps));
    const prefijoLoop = `loop=loop=-1:size=${framesClip}:start=0,setpts=N/FRAME_RATE/TB,`;
    const kenBurns = `${filtroBaseEscala},` +
      `zoompan=z='min(1.0+on*0.0012,1.35)':d=1:` +
      `x='iw/2-(iw/zoom/2)+sin(on/${Math.round(framesTotal / 6)})*(iw*0.03)':` +
      `y='ih/2-(ih/zoom/2)+cos(on/${Math.round(framesTotal / 6)})*(ih*0.03)':` +
      `s=${W}x${H}:fps=${fps}`;
    filtroVideo = prefijoLoop + kenBurns;
  } else {
    filtroVideo = zoomEntrada ? filtroZoomEscala : filtroBaseEscala;
  }

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-map 0:v:0',
        '-map 1:a:0',
        '-sws_flags lanczos',
        `-vf ${filtroVideo}`,
        '-r 30',
        '-c:v libx264',
        '-preset slow',
        '-crf 18',
        '-b:v 12M',
        '-maxrate 16M',
        '-bufsize 24M',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-b:a 192k',
        `-t ${audioDuration}`,
      ])
      .on('error', (err, stdout, stderr) => {
        const detalle = stderr ? ((err && err.message ? err.message : 'ffmpeg error') + ' | stderr: ' + stderr) : (err && err.message ? err.message : String(err));
        reject(new Error(detalle));
      })
      .on('end', () => resolve({ outputPath, duration: audioDuration }))
      .save(outputPath);
  });
}

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

function burnSubtitles(videoPath, assPath, outputPath) {
  return new Promise((resolve, reject) => {
    logger.info('Quemando subtitulos en el video', { videoPath, assPath, outputPath });

    const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

    ffmpeg()
      .input(videoPath)
      .outputOptions([
        `-vf subtitles='${escapedAssPath}'`,
        '-c:v libx264',
        '-preset slow',
        '-crf 18',
        '-pix_fmt yuv420p',
        '-c:a copy',
      ])
      .on('error', (err, stdout, stderr) => {
        const detalle = stderr ? ((err && err.message ? err.message : 'ffmpeg error') + ' | stderr: ' + stderr) : (err && err.message ? err.message : String(err));
        reject(new Error(detalle));
      })
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

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
      .outputOptions(['-map [out]', '-map 0:a?', '-c:v libx264', '-preset slow', '-crf 18', '-pix_fmt yuv420p', '-c:a copy'])
      .on('error', (err, stdout, stderr) => {
        const detalle = stderr ? ((err && err.message ? err.message : 'ffmpeg error') + ' | stderr: ' + stderr) : (err && err.message ? err.message : String(err));
        reject(new Error(detalle));
      })
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

async function mezclarAmbienteTenebroso(videoPath, outputPath, options = {}) {
  const { volumen = 0.18 } = options;

  const dur = await getDuration(videoPath);
  const d = Math.ceil(dur) + 1;

  return new Promise((resolve, reject) => {
    logger.info('Mezclando ambiente tenebroso de fondo', { videoPath, volumen, dur: dur.toFixed(1) });

    const ambienteFilter =
      `sine=frequency=48:duration=${d}[sub];` +
      `sine=frequency=73:duration=${d}[low];` +
      `sine=frequency=98:duration=${d}[mid];` +
      `anoisesrc=duration=${d}:color=brown:amplitude=0.1[noise];` +
      '[sub][low]amix=inputs=2:weights=0.7 0.5[b1];' +
      '[b1][mid]amix=inputs=2:weights=1 0.3[drone];' +
      '[drone]tremolo=f=0.1:d=0.25[dm];' +
      '[noise]lowpass=f=350,highpass=f=60[windf];' +
      '[dm][windf]amix=inputs=2:weights=0.7 0.3[amb];' +
      `[amb]aecho=0.8:0.6:60:0.3,volume=${volumen}[ambef];` +
      '[0:a][ambef]amix=inputs=2:duration=first:dropout_transition=0[aout]';

    ffmpeg(videoPath)
      .complexFilter(ambienteFilter)
      .outputOptions(['-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest'])
      .on('error', (err, stdout, stderr) => {
        const detalle = stderr ? ((err && err.message ? err.message : 'ffmpeg error') + ' | stderr: ' + stderr) : (err && err.message ? err.message : String(err));
        reject(new Error(detalle));
      })
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

async function buildMultiImageSegment(imagePaths, audioPath, outputPath, options = {}) {
  const { horizontal = true } = options;
  const W = horizontal ? 1920 : 1080;
  const H = horizontal ? 1080 : 1920;
  const fps = 30;

  const audioDuration = await getDuration(audioPath);
  const n = imagePaths.length;
  const porImagen = audioDuration / n;
  const framesPorImagen = Math.max(1, Math.ceil(porImagen * fps));

  const tempClips = [];
  for (let i = 0; i < n; i++) {
    const clipPath = outputPath.replace(/\.mp4$/, `-img${i}.mp4`);
    const zoomDir = i % 2 === 0 ? 1 : -1;
    const kenBurns =
      `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
      `zoompan=z='min(1.0+on*0.0015,1.30)':d=${framesPorImagen}:` +
      `x='iw/2-(iw/zoom/2)+${zoomDir}*sin(on/${Math.round(framesPorImagen / 3)})*(iw*0.02)':` +
      `y='ih/2-(ih/zoom/2)+cos(on/${Math.round(framesPorImagen / 3)})*(ih*0.02)':` +
      `s=${W}x${H}:fps=${fps}`;

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(imagePaths[i])
        .inputOptions(['-loop 1'])
        .outputOptions([
          `-t ${porImagen.toFixed(3)}`,
          `-vf ${kenBurns}`,
          '-c:v libx264',
          '-preset slow',
          '-crf 18',
          '-pix_fmt yuv420p',
          '-r 30',
        ])
        .on('error', (err) => reject(new Error('Ken Burns imagen fallo: ' + err.message)))
        .on('end', () => resolve())
        .save(clipPath);
    });
    tempClips.push(clipPath);
  }

  const listPath = outputPath.replace(/\.mp4$/, '-list.txt');
  fs.writeFileSync(listPath, tempClips.map((c) => `file '${c}'`).join('\n'));

  const videoSinAudio = outputPath.replace(/\.mp4$/, '-noaudio.mp4');
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .on('error', (err) => reject(new Error('Concat imagenes fallo: ' + err.message)))
      .on('end', () => resolve())
      .save(videoSinAudio);
  });

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoSinAudio)
      .input(audioPath)
      .outputOptions([
        '-map 0:v:0',
        '-map 1:a:0',
        '-c:v copy',
        '-c:a aac',
        '-b:a 192k',
        `-t ${audioDuration}`,
      ])
      .on('error', (err) => reject(new Error('Union audio fallo: ' + err.message)))
      .on('end', () => resolve())
      .save(outputPath);
  });

  return { duration: audioDuration };
}

module.exports = { getDuration, buildSyncedSegment, buildMultiImageSegment, concatSyncedSegments, burnSubtitles, applyWatermark, mezclarAmbienteTenebroso };
