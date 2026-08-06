const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const logger = require('./logger');
const { generateImage } = require('./agnesImage');

const THUMB_PROMPTS = {
  curious4d: 'YouTube thumbnail background, epic and mind-blowing scene, one striking central subject, vibrant saturated colors, extreme high contrast, dramatic cinematic lighting, sense of wonder and shock, professional viral thumbnail style, ultra detailed, no text',
  hipotesis4d: 'YouTube thumbnail background, epic dramatic alternate-history scene, one powerful central subject, vibrant saturated colors, extreme high contrast, dramatic cinematic lighting, intense and shocking mood, professional viral thumbnail style, ultra detailed, no text',
  oscuro4d: 'YouTube horror thumbnail background, a terrifying scary face or creature with glowing red eyes emerging from deep darkness, extreme high contrast, dramatic red and black tones, harsh cinematic lighting from below, wet skin and unsettling details, dark fog, professional viral horror thumbnail style, hyperrealistic, shocking and eye-catching, no text',
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

  const colorLinea = (i) => {
    if (lineas.length >= 2 && i === 1) return '#ff2020';
    return '#ffffff';
  };

  const tspans = lineas.map((linea, i) => {
    const y = startY + i * lineHeight;
    return `<text x="${width / 2}" y="${y}" font-family="Montserrat, Arial Black, sans-serif" font-size="${fontSize}" font-weight="900" fill="${colorLinea(i)}" stroke="#000000" stroke-width="11" paint-order="stroke" text-anchor="middle" letter-spacing="2">${escapeXml(linea.toUpperCase())}</text>`;
  }).join('\n');

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${tspans}</svg>`;
}

async function generateThumbnail(tituloTexto, profileName, outputDir) {
  const prompt = THUMB_PROMPTS[profileName] || THUMB_PROMPTS.curious4d;
  const width = 1280;
  const height = 720;

  logger.info('Miniatura: generando imagen base con Agnes', { profileName, size: '1024x1024' });
  const { localPath: basePath } = await generateImage(prompt, { outputDir, size: '1024x1024' });
  logger.info('Miniatura: imagen base lista, componiendo texto con sharp', { basePath });

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
