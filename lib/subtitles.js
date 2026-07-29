const fs = require('fs');
const logger = require('./logger');

function buildAssSubtitles(segments, durations, outputPath, { videoHeight = 1280, hookText = null, hookDurationSec = 2.5 } = {}) {
  const marginV = Math.round(videoHeight * 0.22);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,52,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,2,2,40,40,${marginV},1
Style: Hook,Arial Black,68,&H0000FFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,5,3,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let cursor = 0;
  const lines = segments.map((seg, i) => {
    const start = cursor;
    const end = cursor + durations[i];
    cursor = end;

    const text = seg.narration.replace(/\n/g, ' ').trim();
    return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}`;
  });

  // El "hook_text" (gancho visual grande, ver lib/script.js) se superpone
  // encima del subtitulo normal durante los primeros segundos del video.
  // Layer 1 (mas alto que el Layer 0 del subtitulo normal) hace que se
  // dibuje por encima si se solapan en el tiempo. Diseñado para que el
  // gancho se entienda sin sonido, ya que la mayoria del feed reproduce
  // en silencio por defecto.
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
