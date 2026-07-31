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
  const { zoomEntrada = false } = options;

  const [videoDuration, audioDuration] = await Promise.all([
    getDuration(videoPath),
    getDuration(audioPath),
  ]);

  logger.info('Sincronizando segmento', {
    videoDuration: videoDuration.toFixed(2),
    audioDuration: audioDuration.toFixed(2),
    zoomEntrada,
  });

  const filtroBase = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2';

  const fps = 30;
  const framesZoom = Math.round(2.5 * fps);
  const filtroZoom = `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,` +
    `zoompan=z='if(lte(on,${framesZoom}),min(1.0+on*0.006,1.15),1.15)':d=1:` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${fps}`;

  const filtroVideo = zoomEntrada ? filtroZoom : filtroBase;

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
        '-sws_flags lanczos',
        `-vf ${filtroVideo}`,
        '-c:v libx264',
        '-b:v 8M',
        '-maxrate 9M',
        '-bufsize 16M',
        '-c:a aac',
        '-b:a 160k',
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
      .outputOptions(['-map [out]', '-map 0:a?', '-c:v libx264', '-c:a copy'])
      .on('error', (err, stdout, stderr) => {
        const detalle = stderr ? ((err && err.message ? err.message : 'ffmpeg error') + ' | stderr: ' + stderr) : (err && err.message ? err.message : String(err));
        reject(new Error(detalle));
      })
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

module.exports = { getDuration, buildSyncedSegment, concatSyncedSegments, burnSubtitles, applyWatermark };
