const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const logger = require('./logger');
const { generateImage } = require('./agnesImage');

const THUMB_PROMPTS = {
  curious4d: 'Epic dramatic thumbnail background, vibrant cosmic or scientific scene, bright saturated colors, high contrast, cinematic, shocking and eye-catching, no text',
  hipotesis4d: 'Epic dramatic thumbnail background, alternate history epic scene, vibrant saturated colors, high contrast, cinematic, dramatic and eye-catching, no text',
  oscuro4d: 'Terrifying horror thumbnail background, a scary ghostly figure or creature partially visible in the dark, high contrast, dramatic red and dark tones, cinematic horror, shocking and eye-catching, no text, no deformed faces close up',
};

function fontPath() {
  const candidatos = [
    '/usr/share/fonts/truetype/montserrat/Montserrat-Black.ttf',
    '/usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  ];
  for (const f of candidatos) if (fs.existsSync(f)) return f;
  return '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
}

function escapeText(t) {
  return t.replace(/\\/g, '').replace(/:/g, '\\:').replace(/'/g, '').replace(/%/g, '').toUpperCase();
}

function partirEnLineas(texto, maxPorLinea = 18) {
  const palabras = texto.split(/\s+/);
  const lineas = [];
  let actual = '';
  for (const palabra of palabras) {
    if ((actual + ' ' + palabra).trim().length > maxPorLinea && actual) {
      lineas.push(actual.trim());
      actual = palabra;
    } else {
      actual = (actual + ' ' + palabra).trim();
    }
  }
  if (actual) lineas.push(actual.trim());
  return lineas.slice(0, 3);
}

async function generateThumbnail(tituloTexto, profileName, outputDir) {
  const prompt = THUMB_PROMPTS[profileName] || THUMB_PROMPTS.curious4d;

  const { localPath: basePath } = await generateImage(prompt, { outputDir, size: '1280x720' });

  const font = fontPath();
  const lineas = partirEnLineas(tituloTexto, 16);
  const fontSize = 90;
  const lineHeight = fontSize + 20;
  const totalHeight = lineas.length * lineHeight;
  const startY = 720 - totalHeight - 60;

  const drawtexts = lineas.map((linea, i) => {
    const y = startY + i * lineHeight;
    const txt = escapeText(linea);
    return `drawtext=fontfile='${font}':text='${txt}':fontcolor=white:fontsize=${fontSize}:borderw=8:bordercolor=black:x=(w-text_w)/2:y=${y}`;
  }).join(',');

  const outputPath = path.join(outputDir, 'thumbnail.jpg');

  const escalar = `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720`;
  const filtro = `${escalar},${drawtexts}`;

  await new Promise((resolve, reject) => {
    const args = ['-y', '-i', basePath, '-vf', filtro, '-frames:v', '1', '-q:v', '2', outputPath];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg thumbnail fallo: ' + stderr.slice(-400)));
    });
  });

  logger.info('Miniatura generada', { outputPath, lineas: lineas.length });
  return outputPath;
}

module.exports = { generateThumbnail };
