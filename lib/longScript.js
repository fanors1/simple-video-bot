const axios = require('axios');
const { withRetry } = require('./retry');
const logger = require('./logger');
const { bloqueEvitarRepeticion } = require('./historial');
const { parseAgnesJson, buildTags, getProfile } = require('./script');

const BASE_URL = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com';
const API_KEY = process.env.AGNES_API_KEY || '';
const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

const LONG_PROFILES = {
  curious4d: {
    tema: 'curiosidades y datos fascinantes',
    tituloEjemplo: 'Los 5 datos que van a volar tu mente',
    introVisual: 'Cinematic abstract intro of glowing question marks and cosmic particles, dark background, dramatic lighting',
    puntoDescripcion: 'un dato curioso, sorprendente y verificable',
  },
  hipotesis4d: {
    tema: 'escenarios hipoteticos y ucronias',
    tituloEjemplo: '5 momentos que habrian cambiado la historia',
    introVisual: 'Cinematic intro of a branching timeline splitting into alternate paths, epic dramatic lighting, dark cosmic background',
    puntoDescripcion: 'un escenario hipotetico fascinante ("que hubiera pasado si...")',
  },
  oscuro4d: {
    tema: 'leyendas, mitos y folclore de terror',
    tituloEjemplo: 'Las 5 leyendas mas aterradoras de Latinoamerica',
    introVisual: 'Cinematic dark intro of fog rolling through a haunted forest at night under a full moon, photorealistic horror atmosphere',
    puntoDescripcion: 'una leyenda REAL y conocida del folclore (nunca inventada), contada con lenguaje de leyenda ("cuentan que...")',
  },
};

function buildLongPrompt(profileName, numPuntos) {
  const p = LONG_PROFILES[profileName] || LONG_PROFILES.curious4d;
  const esOscuro = profileName === 'oscuro4d';

  return `Eres guionista de un video LARGO de YouTube (formato recopilacion, 3 a 5 minutos) para un canal sobre ${p.tema}.
Genera una recopilacion tipo "${p.tituloEjemplo}" con EXACTAMENTE ${numPuntos} puntos.

Estructura del video:
- Una INTRODUCCION corta y enganchante que presente el tema y prometa lo que viene (2-3 frases, genera intriga).
- ${numPuntos} PUNTOS, cada uno es ${p.puntoDescripcion}. Cada punto debe tener de 3 a 4 frases de narracion (mas desarrollado que un Short, para mantener al espectador).
- Un CIERRE que invite a suscribirse y a comentar cual fue su favorito, con una pregunta a debate.
${esOscuro ? '- IMPORTANTE: usa leyendas REALES y conocidas (La Llorona, El Mohan, El Silbon, La Patasola, El Sombreron, El Cadejo, La Sayona, El Wendigo, La Banshee, etc.), nunca inventadas. Lenguaje de leyenda "cuentan que...". Sin gore explicito.' : ''}

Reglas de los visuales (visual_prompt en ingles):
- ${esOscuro ? 'Foto-realistas y cinematograficos (photorealistic, cinematic film still, realistic lighting), fieles a cada leyenda. Sin rostros deformables en primer plano.' : 'Cinematograficos y atmosfericos, relacionados con cada punto.'}
- Formato horizontal 16:9 (este es un video largo, NO vertical). Nada de texto en la imagen.
- La intro y cada punto y el cierre llevan su propio visual_prompt.

Responde SOLO con un JSON valido, sin markdown, con este formato exacto:
{
  "topic": "titulo llamativo del video en español (estilo clickbait honesto)",
  "tags": ["5 a 8 palabras clave en español, minusculas, sin #"],
  "intro": {"narration": "texto de introduccion en español", "visual_prompt": "cinematic 16:9 intro visual in English, no text"},
  "puntos": [
    {"narration": "texto del punto en español, 3-4 frases", "visual_prompt": "cinematic 16:9 visual in English, no text"}
  ],
  "cierre": {"narration": "texto de cierre invitando a suscribirse y comentar, en español", "visual_prompt": "cinematic 16:9 closing visual in English, no text"}
}
El array "puntos" debe tener exactamente ${numPuntos} elementos.`;
}

async function generateLongScript({ profile: profileName = 'curious4d', numPuntos = 5, account = null } = {}) {
  if (DRY_RUN) {
    logger.info('[MOCK] Generando guion largo simulado', { profile: profileName, numPuntos });
    return {
      topic: `Recopilacion de prueba de ${profileName}`,
      tags: buildTags('prueba', 'recopilacion', [], profileName),
      intro: { narration: 'Intro de prueba.', visualPrompt: 'Cinematic intro 16:9, no text.' },
      puntos: Array.from({ length: numPuntos }, (_, i) => ({
        narration: `Punto de prueba numero ${i + 1}.`,
        visualPrompt: `Cinematic 16:9 visual for point ${i + 1}, no text.`,
      })),
      cierre: { narration: 'Suscribete y comenta tu favorito.', visualPrompt: 'Cinematic closing 16:9, no text.' },
    };
  }

  logger.info('Generando guion largo con IA', { profile: profileName, numPuntos });

  const MAX_INTENTOS = 6;
  let ultimoError;

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      let promptFinal = buildLongPrompt(profileName, numPuntos);
      if (account) promptFinal += bloqueEvitarRepeticion(account);
      if (ultimoError && /CJK/.test(ultimoError.message)) {
        promptFinal += `\n\nADVERTENCIA: no uses caracteres chinos/japoneses/coreanos. Todo en español (o ingles en visual_prompt).`;
      }

      const resp = await withRetry(
        () =>
          axios.post(
            `${BASE_URL}/v1/chat/completions`,
            { model: 'agnes-2.0-flash', max_tokens: 8000, messages: [{ role: 'user', content: promptFinal }] },
            { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } }
          ),
        { label: 'Agnes generar guion largo' }
      );

      const raw = resp.data.choices[0].message.content.trim();
      const parsed = parseAgnesJson(raw);

      if (!parsed.intro || !Array.isArray(parsed.puntos) || parsed.puntos.length === 0 || !parsed.cierre) {
        throw new Error('El guion largo no tiene la estructura esperada (intro, puntos, cierre).');
      }

      const normNarr = (o) => o && (o.narration || o.narracion || o.texto || o.text || '').trim();
      const normVis = (o) => o && (o.visual_prompt || o.visualPrompt || o.visual || o.prompt || '').trim();

      const intro = { narration: normNarr(parsed.intro), visualPrompt: normVis(parsed.intro) };
      const cierre = { narration: normNarr(parsed.cierre), visualPrompt: normVis(parsed.cierre) };
      const puntos = parsed.puntos
        .map((p) => ({ narration: normNarr(p), visualPrompt: normVis(p) }))
        .filter((p) => p.narration);

      if (!intro.narration || puntos.length < Math.max(3, numPuntos - 2) || !cierre.narration) {
        throw new Error('El guion largo quedo incompleto tras normalizar.');
      }

      const profile = getProfile(profileName);
      const tags = buildTags(parsed.topic || 'recopilacion', profile.categories[0], parsed.tags || [], profileName);

      logger.info('Guion largo generado', { topic: parsed.topic, puntos: puntos.length, intento });
      return { topic: parsed.topic || `Recopilacion de ${profileName}`, tags, intro, puntos, cierre };
    } catch (err) {
      ultimoError = err;
      logger.warn(`Guion largo mal formado en intento ${intento}/${MAX_INTENTOS}, reintentando`, { error: err.message });
      if (intento < MAX_INTENTOS) await new Promise((r) => setTimeout(r, 3000 * intento));
    }
  }

  throw new Error(`No se pudo generar el guion largo tras ${MAX_INTENTOS} intentos: ${ultimoError?.message}`);
}

module.exports = { generateLongScript };
