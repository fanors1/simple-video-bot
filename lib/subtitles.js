const fs = require('fs');
const logger = require('./logger');

const MAX_PALABRAS_PANTALLA = 6;
const MAX_PALABRAS_LINEA = 4;

const COLOR_BLANCA = '&H00FFFFFF&';
const COLOR_AMARILLA = '&H0000E5FF&';

function dividirEnPantallas(texto) {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (!limpio) return [];

  const unidades = limpio
    .split(/(?<=[.,;:!?])\s+/)
    .map((u) => u.trim())
    .filter(Boolean);

  const pantallas = [];
  let buffer = [];

  const empujarBuffer = () => {
    if (buffer.length) {
      pantallas.push(buffer.join(' '));
      buffer = [];
    }
  };

  for (const unidad of unidades) {
    const palabras = unidad.split(' ');

    if (palabras.length > MAX_PALABRAS_PANTALLA) {
      empujarBuffer();
      for (let i = 0; i < palabras.length; i += MAX_PALABRAS_PANTALLA) {
        pantallas.push(palabras.slice(i, i + MAX_PALABRAS_PANTALLA).join(' '));
      }
      continue;
    }

    if (buffer.length + palabras.length > MAX_PALABRAS_PANTALLA) {
      empujarBuffer();
    }
    buffer.push(...palabras);
  }
  empujarBuffer();

  return pantallas;
}

function construirTextoPantalla(pantalla) {
  const palabras = pantalla.split(' ');
  if (palabras.length <= MAX_PALABRAS_LINEA) {
    return `{\\c${COLOR_BLANCA}}${pantalla}`;
  }
  const puntoCorte = Math.ceil(palabras.length / 2);
  const linea1 = palabras.slice(0, puntoCorte).join(' ');
  const linea2 = palabras.slice(puntoCorte).join(' ');
  return `{\\c${COLOR_BLANCA}}${linea1}\\N{\\c${COLOR_AMARILLA}}${linea2}`;
}

function buildAssSubtitles(segments, durations, outputPath, { videoHeight = 1280, hookText = null, hookDurationSec = 2.5 } = {}) {
  const marginV = Math.round(videoHeight * 0.18);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat Black,54,&H00FFFFFF,&H000000FF,&H00202020,&H64000000,-1,0,0,0,100,100,0.5,0,1,4,2,2,40,40,${marginV},1
Style: Hook,Montserrat Black,70,&H0000E5FF,&H000000FF,&H00202020,&H64000000,-1,0,0,0,100,100,1,0,1,5,3,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = [];
  let cursor = 0;

  segments.forEach((seg, i) => {
    const segStart = cursor;
    const segEnd = cursor + durations[i];
    cursor = segEnd;

    const texto = (seg.narration || '').replace(/\n/g, ' ').trim();
    if (!texto) return;

    const pantallas = dividirEnPantallas(texto);
    if (pantallas.length === 0) return;

    const duracionPantalla = (segEnd - segStart) / pantallas.length;

    pantallas.forEach((pantalla, j) => {
      const start = segStart + j * duracionPantalla;
      const end = segStart + (j + 1) * duracionPantalla;
      const texto = construirTextoPantalla(pantalla);
      lines.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${texto}`);
    });
  });

  if (hookText && hookText.trim()) {
    const totalDuration = durations.reduce((a, b) => a + b, 0);
    const hookEnd = Math.min(hookDurationSec, totalDuration);
    const hookLine = `Dialogue: 1,${formatAssTime(0)},${formatAssTime(hookEnd)},Hook,,0,0,0,,${hookText.trim().toUpperCase()}`;
    lines.unshift(hookLine);
  }

  fs.writeFileSync(outputPath, header + lines.join('\n'));
  logger.info('Subtitulos generados', { outputPath, cues: lines.length, hookText: hookText || null });
  return outputPath;
}

function formatAssTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds - Math.floor(seconds)) * 100);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

module.exports = { buildAssSubtitles };
