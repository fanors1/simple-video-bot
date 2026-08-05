const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const logger = require('./logger');
const { generateImage } = require('./agnesImage');

const THUMB_PROMPTS = {
  curious4d: 'Epic dramatic thumbnail background, vibrant cosmic or scientific scene, bright saturated colors, high contrast, cinematic, shocking and eye-catching, no text',
  hipotesis4d: 'Epic dramatic thumbnail background, alternate history epic scene, vibrant saturated colors, high contrast, cinematic, dramatic and eye-catching, no text',
  oscuro4d: 'Terrifying horror thumbnail background, a scary ghostly figure or creature partially visible in the dark, high contrast, dramatic red and dark tones, cinematic horror, shocking and eye-catching, no text, no deformed faces close up',
};

function escapeXml(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function partirEnLineas(texto, maxPorLinea = 16) {
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

function construirSvgTexto(lineas, width, height) {
  const fontSize = 96;
  const lineHeight = fontSize + 18;
  const totalHeight = lineas.length * lineHeight;
  const startY = height - totalHeight - 50 + fontSize;

  const tspans = lineas.map((linea, i) => {
    const y = startY + i * lineHeight;
    return `<text x="${width / 2}" y="${y}" font-family="Montserrat, Arial Black, sans-serif" font-size="${fontSize}" font-weight="900" fill="#ffffff" stroke="#000000" stroke-width="10" paint-order="stroke" text-anchor="middle" letter-spacing="2">${escapeXml(linea.toUpperCase())}</text>`;
  }).join('\n');

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${tspans}</svg>`;
}

async function generateThumbnail(tituloTexto, profileName, outputDir) {
  const prompt = THUMB_PROMPTS[profileName] || THUMB_PROMPTS.curious4d;
  const width = 1280;
  const height = 720;

  const { localPath: basePath } = await generateImage(prompt, { outputDir, size: '1280x720' });

  const lineas = partirEnLineas(tituloTexto, 16);
  const svg = construirSvgTexto(lineas, width, height);
  const outputPath = path.join(outputDir, 'thumbnail.jpg');

  await sharp(basePath)
    .resize(width, height, { fit: 'cover' })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toFile(outputPath);

  logger.info('Miniatura generada', { outputPath, lineas: lineas.length });
  return outputPath;
}

module.exports = { generateThumbnail };
