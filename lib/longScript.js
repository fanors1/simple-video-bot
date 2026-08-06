const axios = require('axios');
const { withRetry } = require('./retry');
const logger = require('./logger');
const { bloqueEvitarRepeticion } = require('./historial');
const { parseAgnesJson, buildTagsLargo } = require('./script');

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

  if (esOscuro) {
    return buildOscuroRelatoPrompt(numPuntos);
  }

  return `Eres guionista de un video LARGO de YouTube (formato recopilacion, 3 a 5 minutos) para un canal sobre ${p.tema}.
Genera una recopilacion tipo "${p.tituloEjemplo}" con EXACTAMENTE ${numPuntos} puntos.

Estructura del video:
- Una INTRODUCCION corta y enganchante que presente el tema y prometa lo que viene (2-3 frases, genera intriga).
- ${numPuntos} PUNTOS, cada uno es ${p.puntoDescripcion}. Cada punto debe tener de 3 a 4 frases de narracion (mas desarrollado que un Short, para mantener al espectador).
- Un CIERRE que invite a suscribirse y a comentar cual fue su favorito, con una pregunta a debate.

Reglas de los visuales (visual_prompt en ingles):
- Cinematograficos y atmosfericos, relacionados con cada punto.
- Formato horizontal 16:9 (este es un video largo, NO vertical). Nada de texto en la imagen.
- La intro y cada punto y el cierre llevan su propio visual_prompt.

Responde SOLO con un JSON valido, sin markdown, con este formato exacto:
{
  "topic": "titulo llamativo del video en español (estilo clickbait honesto)",
  "descripcion": "descripcion UNICA de 2-3 frases para YouTube que resuma especificamente de que trata ESTE video y despierte curiosidad, DIFERENTE en cada video, sin repetir formulas genericas",
  "tags": ["5 a 8 palabras clave en español, minusculas, sin #"],
  "intro": {"narration": "texto de introduccion en español", "visual_prompt": "cinematic 16:9 intro visual in English, no text"},
  "puntos": [
    {"narration": "texto del punto en español, 3-4 frases", "visual_prompt": "cinematic 16:9 visual in English, no text"}
  ],
  "cierre": {"narration": "texto de cierre invitando a suscribirse y comentar, en español", "visual_prompt": "cinematic 16:9 closing visual in English, no text"}
}
El array "puntos" debe tener exactamente ${numPuntos} elementos.`;
}

function buildOscuroRelatoPrompt(numPuntos) {
  const temas = [
    'una familia que se muda a una casa con un pasado oscuro',
    'una aparicion que persigue a alguien de noche',
    'una criatura del folclore latino que acecha a un pueblo',
    'un objeto o lugar maldito que trae desgracias',
    'una experiencia paranormal en una finca o casa de campo',
    'un espiritu que no encuentra descanso',
  ];
  const temaElegido = temas[Math.floor(Math.random() * temas.length)];

  return `Eres guionista de un canal de YouTube de terror llamado "Oscuro4D", especializado en RELATOS DE TERROR inmersivos estilo "historias de ultratumba" (esas que narran algo escalofriante que le habria pasado a una persona o familia). Video largo de 3 a 5 minutos.

Genera UN SOLO RELATO de terror completo (NO una recopilacion, NO una lista). El relato trata sobre: ${temaElegido}.

REGLAS CRITICAS del relato:
- Es UNA SOLA historia continua que progresa de principio a fin, contada como si le hubiera pasado a alguien real (estilo "esto le ocurrio a una familia en...").
- Ubicala en un lugar y epoca genericos y creibles (ej: "en un pueblo del norte de Mexico, hace algunos años", "en una vereda de Colombia", "en las afueras de Lima"). NUNCA inventes nombres de personas reales especificas, ni fechas exactas, ni afirmes que es un hecho documentado real. Es un RELATO de terror, no una noticia.
- Personajes genericos: "la familia", "la madre", "la hija menor", "el abuelo", "el hombre". Podes darles nombres comunes de pila (Maria, Don Jose) pero nunca apellidos ni identidades reales.
- Tono inmersivo, atmosferico, con tension creciente. El miedo se construye de a poco: primero la normalidad, luego los primeros indicios raros, luego la escalada, luego el momento mas aterrador, y un desenlace (que puede quedar sin explicacion, eso da mas miedo).
- Sin gore explicito ni violencia grafica extrema (para no perjudicar la monetizacion). El terror es psicologico y atmosferico.

Estructura del relato en ${numPuntos + 2} bloques narrativos (cada uno de 3 a 5 frases, hablados por un narrador con voz grave):
- INTRO: presenta a los protagonistas, el lugar y la epoca. Engancha prometiendo que algo terrible va a pasar.
- ${numPuntos} PARTES que desarrollan la historia progresivamente (la normalidad, los primeros indicios, la escalada de sucesos, el clímax de terror). Cada parte continua la anterior, es la MISMA historia avanzando.
- CIERRE: el desenlace del relato + una reflexion inquietante, y una invitacion a suscribirse y comentar si han vivido algo similar.

Reglas de los visuales (visual_prompt en ingles):
- Foto-realistas y cinematograficos (photorealistic, cinematic film still, realistic lighting, horror atmosphere), que ilustren ESE momento de la historia (la casa, la noche, la figura entrevista, el pasillo oscuro, etc.).
- NUNCA rostros deformados en primer plano. Figuras a lo lejos, sombras, siluetas, ambientes.
- Formato horizontal 16:9. Nada de texto en la imagen.

Responde SOLO con un JSON valido, sin markdown, con este formato exacto:
{
  "topic": "titulo llamativo y aterrador del relato en español (estilo clickbait de terror, ej: 'Una Familia Se Mudo a Esta Casa... y su Hija Menor Empezo a Hablar Sola')",
  "descripcion": "descripcion UNICA de 2-3 frases para YouTube que resuma de que trata ESTE relato especifico y despierte intriga, DIFERENTE en cada video",
  "tags": ["5 a 8 palabras clave en español, minusculas, sin #"],
  "intro": {"narration": "texto de la introduccion del relato en español", "visual_prompt": "cinematic 16:9 horror visual in English, no text"},
  "puntos": [
    {"narration": "texto de esta parte de la historia en español, continuando el relato", "visual_prompt": "cinematic 16:9 horror visual in English, no text"}
  ],
  "cierre": {"narration": "desenlace del relato + reflexion + invitacion a suscribirse y comentar, en español", "visual_prompt": "cinematic 16:9 horror visual in English, no text"}
}
El array "puntos" debe tener exactamente ${numPuntos} elementos, y todos juntos deben formar UNA SOLA historia continua.`;
}

async function generateLongScript({ profile: profileName = 'curious4d', numPuntos = 5, account = null } = {}) {
  if (DRY_RUN) {
    logger.info('[MOCK] Generando guion largo simulado', { profile: profileName, numPuntos });
    return {
      topic: `Recopilacion de prueba de ${profileName}`,
      tags: buildTagsLargo('prueba', [], profileName),
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

      const tags = buildTagsLargo(parsed.topic || 'recopilacion', parsed.tags || [], profileName);

      logger.info('Guion largo generado', { topic: parsed.topic, puntos: puntos.length, intento });
      return { topic: parsed.topic || `Recopilacion de ${profileName}`, descripcion: (parsed.descripcion || '').trim(), tags, intro, puntos, cierre };
    } catch (err) {
      ultimoError = err;
      logger.warn(`Guion largo mal formado en intento ${intento}/${MAX_INTENTOS}, reintentando`, { error: err.message });
      if (intento < MAX_INTENTOS) await new Promise((r) => setTimeout(r, 3000 * intento));
    }
  }

  throw new Error(`No se pudo generar el guion largo tras ${MAX_INTENTOS} intentos: ${ultimoError?.message}`);
}

module.exports = { generateLongScript };
