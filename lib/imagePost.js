const fs = require('fs');
const sharp = require('sharp');
const logger = require('./logger');

/**
 * Superpone un titular grande e impactante sobre una imagen, al estilo de los
 * posts virales de datos (texto en mayusculas, abajo, con banda oscura detras
 * para legibilidad). Tambien aplica la marca de agua en la esquina.
 *
 * Usa sharp + SVG (no ffmpeg drawtext, que no viene en ffmpeg-static). Sharp
 * funciona igual en Windows y en GitHub Actions sin dependencias del sistema.
 *
 * @param {string} imagePath - imagen base (fotorrealista de Agnes)
 * @param {string} titulo - texto del titular (se muestra en mayusculas)
 * @param {string} outputPath - archivo de salida (.png)
 * @param {object} [opts]
 * @param {string} [opts.watermarkPath] - logo opcional (esquina superior derecha)
 * @param {number} [opts.width=1024]
 * @param {number} [opts.height=1024]
 */
async function overlayTitle(imagePath, titulo, outputPath, opts = {}) {
  const { watermarkPath = null, width = 1024, height = 1024 } = opts;

  logger.info('Superponiendo titular sobre la imagen', { imagePath, titulo, outputPath });

  // Normalizamos la imagen base al tamaño esperado
  let base = sharp(imagePath).resize(width, height, { fit: 'cover' });

  const textoMayus = titulo.toUpperCase().trim();
  const lineas = envolverTexto(textoMayus, 20);

  // Construimos un SVG con la banda oscura inferior + el titular centrado.
  const fontSize = Math.round(width * 0.062);
  const lineHeight = Math.round(fontSize * 1.15);
  const bandaAltura = Math.round(lineHeight * lineas.length + fontSize * 1.2);
  const bandaY = height - bandaAltura;

  const tspans = lineas
    .map((linea, i) => {
      const y = bandaY + fontSize * 1.1 + i * lineHeight;
      return `<text x="${width / 2}" y="${y}" font-family="Arial Black, Liberation Sans Bold, DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="white" stroke="black" stroke-width="${Math.round(fontSize * 0.06)}" paint-order="stroke" text-anchor="middle">${escaparXml(linea)}</text>`;
    })
    .join('\n');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${bandaY}" width="${width}" height="${bandaAltura}" fill="black" fill-opacity="0.55"/>
    ${tspans}
  </svg>`;

  const composites = [{ input: Buffer.from(svg), top: 0, left: 0 }];

  // Marca de agua opcional (esquina superior derecha)
  if (watermarkPath && fs.existsSync(watermarkPath)) {
    const wmSize = Math.round(width * 0.16);
    const wmBuffer = await sharp(watermarkPath).resize(wmSize, wmSize, { fit: 'inside' }).png().toBuffer();
    const margen = Math.round(width * 0.03);
    composites.push({ input: wmBuffer, top: margen, left: width - wmSize - margen });
  }

  await base.composite(composites).png().toFile(outputPath);
  logger.info('Titular superpuesto correctamente', { outputPath });
  return outputPath;
}

// Parte un texto largo en lineas de a lo sumo maxChars, sin cortar palabras.
function envolverTexto(texto, maxChars) {
  const palabras = texto.split(/\s+/);
  const lineas = [];
  let actual = '';
  for (const palabra of palabras) {
    if ((actual + ' ' + palabra).trim().length > maxChars) {
      if (actual) lineas.push(actual.trim());
      actual = palabra;
    } else {
      actual = (actual + ' ' + palabra).trim();
    }
  }
  if (actual) lineas.push(actual.trim());
  return lineas;
}

function escaparXml(texto) {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { overlayTitle };
