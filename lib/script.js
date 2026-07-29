const axios = require('axios');
const { withRetry } = require('./retry');
const logger = require('./logger');
const { bloqueEvitarRepeticion } = require('./historial');

const BASE_URL = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com';
const API_KEY = process.env.AGNES_API_KEY || '';

// ============================================================
// REGLAS DE GANCHO COMPARTIDAS (aplican a cualquier canal/perfil)
// Se inyectan en el prompt de cada perfil via injectHookRules().
// ============================================================
const HOOK_RULES = `Reglas de gancho (criticas, aplican a TODO el guion, sin importar el nicho del canal):

- El primer segmento SIEMPRE debe abrir con algo inesperado: una imagen, dato o giro que rompa el patron de lo que el espectador anticipa ver. Nunca arranques con una toma "tranquila" o una introduccion lenta.
- El valor o la promesa central del video debe quedar establecido dentro de los primeros 3-4 segundos (el primer segmento), no despues.
- NO repitas la misma formula de apertura de un video a otro (evita reusar siempre la misma frase o estructura de gancho). Varia la redaccion entre videos mientras mantienes el estilo del canal.
- El ultimo segmento debe cerrar con la pregunta que genera comentarios (ver seccion especifica mas abajo) — no debe sentirse cortado, tiene que fluir como cierre natural del guion.

El miedo/curiosidad/urgencia son el gancho — nunca reemplazan el contenido educativo real. El gancho abre la puerta, pero el video tiene que cerrarla con un dato real, verificable y que valga la pena. Un gancho fuerte con contenido vacio genera desconfianza y hace que el espectador no vuelva.

Disparador psicologico dominante (elegilo ANTES de escribir el guion):
Antes de generar el contenido, elegi UNO de estos 3 mecanismos como eje del gancho. Todo el guion (narracion, hook_text, visual_prompt del primer segmento) debe disenarse deliberadamente para intensificar ESE mecanismo elegido, no de forma generica:
1. "curiosidad" — brecha de informacion: insinua algo sin revelarlo del todo, generando la necesidad casi fisica de saber el resto ("esto que tenes en el cuerpo podria fallar y no lo sabes").
2. "miedo" — aversion a la perdida / sesgo de negatividad: el cerebro reacciona mas fuerte ante una amenaza o algo que se podria perder que ante algo neutro o positivo equivalente. No confundir con contenido grafico o sensacionalista: es inquietud/incertidumbre genuina, no gore ni panico explicito. El miedo abre la puerta, pero el video tiene que cerrarla con un dato real.
3. "urgencia" — inmediatez/necesidad: enmarcalo como algo que te afecta a vos, ahora, no como un dato atemporal y lejano.
No abuses siempre del mismo disparador: si notas que veniste usando "miedo" seguido, priorizá variar hacia "curiosidad" o "urgencia" en el proximo, para no sonar repetitivo ni sensacionalista.

Ademas del guion hablado, genera un "hook_text": una frase corta de 4 a 7 palabras en español, en formato de texto grande para pantalla (no es lo mismo que la narracion hablada del segmento 1, aunque puede estar relacionada). Debe funcionar SIN SONIDO: la mayoria de la gente ve estos videos en el feed con el video silenciado, asi que el "hook_text" es lo unico que muchos van a "leer" en los primeros segundos para decidir si se quedan. Debe reflejar el disparador psicologico elegido arriba.

Cierre con pregunta que genera comentarios (obligatorio, va en la narracion hablada del ULTIMO segmento, NO es texto en pantalla ni un campo separado):
El ultimo segmento debe terminar con una pregunta hablada por el narrador, disenada especificamente para generar la mayor cantidad de comentarios posible. No sirve una pregunta generica tipo "¿que opinas?" — tiene que estar diseñada psicologicamente. Usa UNO de estos mecanismos (variá cual usas entre videos, no repitas siempre el mismo):
1. Dilema o eleccion forzada entre dos opciones concretas relacionadas al tema (ej: "¿vos cual elegirias: A o B?") — la gente comenta para "votar" y ver que eligieron otros.
2. Involucrar la identidad/opinion personal del espectador de forma directa, no abstracta (ej: no "¿que opinan de esto?" sino "¿vos aguantarias esto o saldrias corriendo?") — preguntas que exigen una respuesta personal generan mas comentarios que preguntas sobre el tema en abstracto.
3. Pregunta con leve friccion u opinion controvertida implicita, que invite a estar de acuerdo o discutir (sin ser ofensiva ni sensacionalista) — el desacuerdo genera mas comentarios que el acuerdo generico.
4. Pregunta de experiencia/preparacion personal (ideal para contenido de supervivencia o situaciones de riesgo real): preguntale al espectador si el/ella sabria que hacer en esa situacion (ej: "¿vos sabrias que hacer en ese momento?") — invita a responder con su propio nivel de preparacion, genuino o en broma.
La pregunta debe sentirse como el cierre natural del guion, no pegada de forma forzada — debe conectar directamente con el tema especifico de ESE video, no ser intercambiable entre videos distintos.

PROHIBIDO usar frases transaccionales tipo "comenta X para Y", "dale like si...", "etiqueta a alguien que...", "sigueme para mas" — Meta y las demas plataformas detectan y penalizan en silencio este tipo de frases (le bajan el alcance al video sin avisar). Una pregunta genuina que da ganas de responder funciona mucho mejor que pedir la interaccion de forma directa.

REGLA DE IDIOMA (CRITICA, obligatoria, sin excepciones):
- El campo "narration" debe estar SIEMPRE en ESPAÑOL, y NADA MAS que español.
- El campo "visual_prompt" debe estar SIEMPRE en INGLES, y NADA MAS que ingles.
- Los campos "topic", "hook_text" y "tags" van en ESPAÑOL.
- NUNCA, bajo ninguna circunstancia, uses caracteres chinos, japoneses, coreanos ni de ningun otro sistema de escritura que no sea el alfabeto latino. Ni una sola palabra ni un solo caracter en chino. Si generas aunque sea un caracter chino, la respuesta completa es invalida.
- Todos los valores de texto deben ser JSON valido: usa solo comillas rectas ("), nunca comillas tipograficas, y escapa correctamente cualquier comilla interna.`;

function injectHookRules(promptBody) {
  return `${promptBody}\n\n${HOOK_RULES}`;
}

// ============================================================
// PERFILES DE CONTENIDO POR CANAL/MARCA
// ============================================================
const CONTENT_PROFILES = {
  curious4d: {
    categories: [
      'animales', 'ciencia', 'espacio', 'historia',
      'naturaleza', 'cuerpo humano', 'tecnologia', 'misterios',
    ],
    channelTags: ['curiosidades', 'datos curiosos', 'sabias que', 'shorts', 'dato del dia'],
    categoryTags: {
      animales: ['animales', 'naturaleza', 'vida salvaje'],
      ciencia: ['ciencia', 'curiosidades cientificas', 'experimentos'],
      espacio: ['espacio', 'astronomia', 'universo', 'nasa'],
      historia: ['historia', 'datos historicos', 'pasado'],
      naturaleza: ['naturaleza', 'planeta tierra', 'ecologia'],
      'cuerpo humano': ['cuerpo humano', 'anatomia', 'salud', 'biologia'],
      tecnologia: ['tecnologia', 'innovacion', 'futuro'],
      misterios: ['misterios', 'enigmas', 'sin resolver'],
    },
    promptBuilder: (chosenCategory, segmentCount) => injectHookRules(`Eres guionista de un canal de curiosidades tipo "Curious4D" (datos sorprendentes en menos de 30 segundos).
Genera UN dato curioso real y verificable de la categoria "${chosenCategory}".
Divide la narracion en EXACTAMENTE ${segmentCount} segmentos, cada uno de aproximadamente 5 segundos al hablarlo en voz alta (unas 12-16 palabras en español por segmento).

Responde SOLO con un JSON valido, sin markdown, con este formato exacto:
{
  "topic": "titulo corto y llamativo en español",
  "trigger_type": "curiosidad, miedo, o urgencia (el que elegiste, ver reglas de gancho)",
  "hook_text": "frase de 4 a 7 palabras para texto grande en pantalla, ver reglas de gancho",
  "tags": ["5 a 8 palabras clave en español relacionadas al dato especifico, en minusculas, sin #"],
  "segments": [
    {"narration": "texto en español para leer en voz alta", "visual_prompt": "visual description in English for AI video generation, cinematic, no text overlays, 9:16 vertical"}
  ]
}
El array "segments" debe tener exactamente ${segmentCount} elementos.`),
  },

  hipotesis4d: {
    categories: [
      'ciencia especulativa', 'historia alternativa', 'absurdo cotidiano',
      'fenomeno natural extremo', 'cuerpo humano hipotetico', 'tecnologia futura', 'espacio hipotetico',
      'amenaza real y supervivencia',
    ],
    channelTags: ['hipotesis', 'que pasaria si', 'especulacion', 'shorts', 'realidad alternativa'],
    categoryTags: {
      'ciencia especulativa': ['ciencia', 'especulacion cientifica', 'hipotesis'],
      'historia alternativa': ['historia alternativa', 'ucronia', 'historia'],
      'absurdo cotidiano': ['absurdo', 'curiosidades', 'imaginacion'],
      'fenomeno natural extremo': ['fenomeno natural', 'escenario extremo', 'hipotesis'],
      'amenaza real y supervivencia': ['supervivencia', 'que hacer si', 'amenaza real', 'prevencion'],
      'cuerpo humano hipotetico': ['cuerpo humano', 'biologia especulativa', 'anatomia'],
      'tecnologia futura': ['tecnologia', 'futuro', 'innovacion especulativa'],
      'espacio hipotetico': ['espacio', 'universo', 'astronomia especulativa'],
    },
    // "fenomeno natural extremo" debe salir ~1 de cada 4-5 videos, no en sorteo parejo con las demas.
    pickCategory(categories) {
      const sinExtremo = categories.filter((c) => c !== 'fenomeno natural extremo');
      const incluyeExtremo = categories.includes('fenomeno natural extremo');
      if (incluyeExtremo && Math.random() < 0.2) return 'fenomeno natural extremo';
      return sinExtremo[Math.floor(Math.random() * sinExtremo.length)];
    },
    promptBuilder: (chosenCategory, segmentCount) => injectHookRules(`Eres guionista del canal "Hipotesis4D", especializado en escenarios hipoteticos e imaginativos (formato corto, menos de 30 segundos).
Genera UN escenario hipotetico original de la categoria "${chosenCategory}".

Reglas especificas de este canal (ademas de las reglas de gancho generales de abajo):
- NO repitas literalmente la frase "¿Que pasaria si...?" como apertura del guion. Varia la redaccion mientras mantienes la premisa hipotetica: usa formas como "Imagina un mundo donde...", "Existe una posibilidad real de que...", "Esto es lo que pasaria si...", "Hay un escenario en el que...", u otras variantes originales que no se repitan entre videos.
- Si la categoria es "fenomeno natural extremo", mantiene el tono curioso/especulativo del canal (no grafico ni sensacionalista). Rota entre distintos eventos (terremoto, tsunami, incendio, tormenta electrica, erupcion volcanica, etc.). Podes cerrar con un dato practico real de que hacer en esa situacion, si es correcto y verificable.
- Si la categoria es "amenaza real y supervivencia", genera un escenario sobre una amenaza REAL y verificable que podria ocurrir (una enfermedad que podria resurgir, una tormenta solar, una pandemia, un supervolcan, una bacteria resistente, un impacto de asteroide, etc.) — algo cientificamente plausible, no inventado ni alarmista falso. El gancho es el "miedo por saber lo que podria pasar", pero SIEMPRE cerra explicando COMO SOBREVIVIR o que se puede hacer al respecto (medidas reales y verificables). El valor esta en informar y preparar, no solo en asustar. Rota entre distintas amenazas, no repitas siempre la misma.
- IMPORTANTE — anclá la premisa en algo REAL y verificable, no la inventes de la nada: el escenario hipotetico tiene que partir de un hecho, evento, especie, civilizacion o dato cientifico que realmente existio o existe (ej: los dinosaurios existieron de verdad → "¿que hubiera pasado si no se extinguian?"; el Imperio Romano existio de verdad → "¿que hubiera pasado si nunca caia?"). Evita premisas totalmente inventadas sin ningun anclaje real. Esto aplica sobre todo a "historia alternativa" y "ciencia especulativa", pero tambien podes anclar "tecnologia futura" o "cuerpo humano hipotetico" en una base cientifica real antes de especular hacia adelante.
- No uses alarmismo real ni fomentes panico sobre riesgos genuinos y actuales (cambio climatico, pandemias, catastrofes naturales reales en curso, etc.) como si fueran inminentes o certeros — la especulacion tiene que sentirse como entretenimiento imaginativo anclado en la realidad, no como una advertencia real disfrazada de contenido.

Divide la narracion en EXACTAMENTE ${segmentCount} segmentos, cada uno de aproximadamente 5 segundos al hablarlo en voz alta (unas 12-16 palabras en español por segmento).

Responde SOLO con un JSON valido, sin markdown, con este formato exacto:
{
  "topic": "titulo corto y llamativo en español",
  "trigger_type": "curiosidad, miedo, o urgencia (el que elegiste, ver reglas de gancho)",
  "hook_text": "frase de 4 a 7 palabras para texto grande en pantalla, ver reglas de gancho",
  "tags": ["5 a 8 palabras clave en español relacionadas al escenario especifico, en minusculas, sin #"],
  "segments": [
    {"narration": "texto en español para leer en voz alta", "visual_prompt": "visual description in English for AI video generation, cinematic, no text overlays, 9:16 vertical"}
  ]
}
El array "segments" debe tener exactamente ${segmentCount} elementos.`),
  },
};

const DEFAULT_PROFILE = 'curious4d';

function getProfile(profileName) {
  return CONTENT_PROFILES[profileName] || CONTENT_PROFILES[DEFAULT_PROFILE];
}

const CATEGORIES = CONTENT_PROFILES[DEFAULT_PROFILE].categories;

function pickCategory(profile) {
  if (typeof profile.pickCategory === 'function') return profile.pickCategory(profile.categories);
  return profile.categories[Math.floor(Math.random() * profile.categories.length)];
}

function buildTags(topic, category, aiTags = [], profileName = DEFAULT_PROFILE) {
  const profile = getProfile(profileName);
  const combined = [...aiTags, ...(profile.categoryTags[category] || [category]), ...profile.channelTags];
  const unique = [...new Set(combined.map((t) => t.toLowerCase().trim()))];

  const tags = [];
  let totalChars = 0;
  for (const tag of unique) {
    if (totalChars + tag.length + 1 > 480) break;
    tags.push(tag);
    totalChars += tag.length + 1;
  }
  return tags;
}

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

/**
 * Parsea el JSON que devuelve Agnes de forma tolerante. El modelo a veces
 * genera JSON casi valido pero con pequenos defectos (texto extra antes/despues,
 * comas colgantes, comillas "tipograficas" en vez de rectas). Esta funcion
 * intenta primero un parse directo y, si falla, aplica reparaciones comunes
 * antes de rendirse — asi evitamos descartar un guion completo por un detalle
 * de formato.
 */
function parseAgnesJson(raw) {
  // 1) Quitar fences de markdown (```json ... ```)
  let text = raw.replace(/^```json\s*|\s*```$/g, '').trim();

  // Agnes (modelo chino) a veces revierte a caracteres chinos/japoneses/coreanos
  // en medio del texto, lo que ademas suele romper el JSON. Si detectamos
  // caracteres CJK, rechazamos de una para que el reintento pida un guion nuevo
  // limpio, en vez de intentar parsear algo que va a fallar de forma confusa.
  const tieneCJK = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(text);
  if (tieneCJK) {
    throw new Error('Agnes genero caracteres CJK (chino/japones/coreano) en el guion, respuesta invalida.');
  }

  // 2) Intento directo
  try {
    return JSON.parse(text);
  } catch (_) {
    // seguimos a la reparacion
  }

  // 3) Recortar a lo que este entre la primera { y la ultima } (descarta
  //    cualquier texto que el modelo haya puesto antes o despues del JSON)
  const primeraLlave = text.indexOf('{');
  const ultimaLlave = text.lastIndexOf('}');
  if (primeraLlave !== -1 && ultimaLlave !== -1 && ultimaLlave > primeraLlave) {
    text = text.slice(primeraLlave, ultimaLlave + 1);
  }

  // 4) Normalizar comillas tipograficas a comillas rectas
  text = text
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'");

  // 5) Quitar comas colgantes antes de } o ]
  text = text.replace(/,(\s*[}\]])/g, '$1');

  // 6) Reparar el array "tags" cuando Agnes pone los elementos SIN comillas,
  //    ej:  "tags": [rotacion de la tierra, dia eterno]  (JSON invalido)
  //    ->   "tags": ["rotacion de la tierra", "dia eterno"]
  //    Solo tocamos el contenido del array tags para no romper el resto.
  text = text.replace(/("tags"\s*:\s*)\[([^\]]*)\]/g, (match, prefijo, contenido) => {
    // Si ya tiene comillas dobles, lo dejamos como esta (ya es valido).
    if (contenido.includes('"')) return match;
    const elementos = contenido
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0)
      .map((e) => '"' + e.replace(/"/g, '') + '"');
    return prefijo + '[' + elementos.join(', ') + ']';
  });

  // 7) Segundo intento tras las reparaciones
  return JSON.parse(text);
}

async function generateScript({ category, segmentCount = 6, profile: profileName = DEFAULT_PROFILE, account = null } = {}) {
  const profile = getProfile(profileName);
  const chosenCategory = category || pickCategory(profile);

  if (DRY_RUN) {
    logger.info('[MOCK] Generando guion simulado (0 costo, sin llamada real)', { category: chosenCategory, profile: profileName });
    const segments = Array.from({ length: segmentCount }, (_, i) => ({
      narration: `Segmento de prueba numero ${i + 1} sobre ${chosenCategory}.`,
      visualPrompt: `Cinematic vertical shot related to ${chosenCategory}, segment ${i + 1}, 9:16, no text overlays.`,
    }));
    return {
      topic: `Dato de prueba sobre ${chosenCategory}`,
      category: chosenCategory,
      triggerType: 'curiosidad',
      hookText: `ESTO SOBRE ${chosenCategory.toUpperCase()} TE VA A SORPRENDER`,
      tags: buildTags(`prueba ${chosenCategory}`, chosenCategory, [], profileName),
      segments,
    };
  }

  logger.info('Generando guion con IA', { category: chosenCategory, segmentCount, profile: profileName });

  // Historias (segmentCount pequeño) reintentan mas veces porque son baratas y
  // rapidas de regenerar; los Reels (segmentCount alto) mantienen 3 para no
  // encarecer. Agnes falla mas con ciertas categorias, asi que darle mas
  // oportunidades en historias sube mucho la tasa de exito.
  const MAX_INTENTOS_GUION = segmentCount <= 2 ? 6 : 3;
  let ultimoError;

  for (let intento = 1; intento <= MAX_INTENTOS_GUION; intento++) {
    try {
      // Para Historias (1-2 segmentos) agregamos una instruccion final que
      // simplifica la tarea: un dato directo, sin la estructura multi-segmento
      // de los Reels. Menos complejidad = menos margen para que Agnes falle
      // (sobre todo en categorias enredadas como "fenomeno natural extremo").
      let promptFinal = profile.promptBuilder(chosenCategory, segmentCount);
      if (segmentCount <= 2) {
        promptFinal += `\n\nMODO HISTORIA (IMPORTANTE): Este es un formato MUY corto de ${segmentCount} segmento(s) para una Historia de Instagram/Facebook. Genera UN solo dato o gancho directo y contundente, facil de entender en pocos segundos. La narracion debe ser breve pero COMPLETA: NUNCA dejes el campo "narration" vacio. No te compliques con estructura larga. Asegurate de que CADA segmento tenga su "narration" en español y su "visual_prompt" en ingles, ambos con contenido real y no vacio.`;
      }
      // Evitar repeticion: inyectar los temas ya publicados de este canal.
      if (account) promptFinal += bloqueEvitarRepeticion(account);

      const resp = await withRetry(
        () =>
          axios.post(
            `${BASE_URL}/v1/chat/completions`,
            {
              model: 'agnes-2.0-flash',
              max_tokens: 4000,
              messages: [
                {
                  role: 'user',
                  content: promptFinal,
                },
              ],
            },
            { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } }
          ),
        { label: 'Agnes generar guion' }
      );

      const raw = resp.data.choices[0].message.content.trim();
      const parsed = parseAgnesJson(raw);

      if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
        throw new Error('El guion generado no tiene un array de segmentos valido.');
      }

      const todosLosSegmentos = parsed.segments.map((s) => ({ narration: s.narration, visualPrompt: s.visual_prompt }));

      const segments = todosLosSegmentos.filter(
        (s) => s.narration && typeof s.narration === 'string' && s.narration.trim() &&
               s.visualPrompt && typeof s.visualPrompt === 'string' && s.visualPrompt.trim()
      );

      const descartados = todosLosSegmentos.length - segments.length;
      const esUltimoIntento = intento === MAX_INTENTOS_GUION;

      // Estrategia: en los primeros intentos EXIGIMOS el guion completo (si falta
      // algun segmento, reintentamos para conseguir el video de duracion normal,
      // 30-45s). Solo en el ULTIMO intento, si aun quedan huecos, aceptamos el
      // guion filtrado como emergencia — mejor un video un poco mas corto que
      // ninguno. Asi lo normal es tu duracion completa, y el filtro es red de
      // seguridad, no el comportamiento habitual.
      if (descartados > 0 && !esUltimoIntento) {
        throw new Error(
          `Agnes dejo ${descartados} segmento(s) sin narracion/visual; reintentando para conseguir el guion completo.`
        );
      }

      if (descartados > 0) {
        logger.warn(`Ultimo intento: se aceptan ${segments.length} segmentos validos (Agnes dejo ${descartados} vacios). Video mas corto de lo normal.`);
      }

      // Piso de segmentos: relativo a lo que se pidio, para no romper formatos
      // cortos. Las Historias piden segmentCount=1 (una sola tarjeta), asi que
      // ahi el minimo es 1. Los Reels piden 6-7, y ahi exigimos al menos la
      // mitad + 1 para que el video no quede demasiado corto en emergencia.
      const MIN_SEGMENTOS = segmentCount <= 2 ? segmentCount : Math.ceil(segmentCount / 2) + 1;
      if (segments.length < MIN_SEGMENTOS) {
        throw new Error(
          `Agnes devolvio solo ${segments.length} segmento(s) validos (minimo ${MIN_SEGMENTOS} para ${segmentCount} pedidos). El resto vino sin narracion o sin visual_prompt.`
        );
      }

      if (!parsed.hook_text || typeof parsed.hook_text !== 'string' || !parsed.hook_text.trim()) {
        throw new Error('Agnes no devolvio "hook_text" (o vino vacio) — es requerido para el texto de gancho en pantalla.');
      }

      logger.info('Guion generado', {
        topic: parsed.topic,
        triggerType: parsed.trigger_type,
        hookText: parsed.hook_text,
        segments: parsed.segments.length,
        intento,
      });

      return {
        topic: parsed.topic,
        category: chosenCategory,
        triggerType: parsed.trigger_type || null,
        hookText: parsed.hook_text,
        tags: buildTags(parsed.topic, chosenCategory, parsed.tags || [], profileName),
        segments,
      };
    } catch (err) {
      ultimoError = err;
      const quedanIntentos = intento < MAX_INTENTOS_GUION;
      logger.warn(
        quedanIntentos
          ? `Guion mal formado en intento ${intento}/${MAX_INTENTOS_GUION}, reintentando`
          : `Guion mal formado en el ultimo intento (${intento}/${MAX_INTENTOS_GUION}), no quedan mas reintentos`,
        { error: err.message }
      );
    }
  }

  throw new Error(
    `Agnes devolvio guiones mal formados ${MAX_INTENTOS_GUION} veces seguidas. Ultimo error: ${ultimoError.message} ` +
      'Esto suele pasar por respuestas truncadas del modelo.'
  );
}

// ============================================================
//  POSTS DE IMAGEN: genera un dato impactante + titular grande +
//  descripcion larga + prompt de imagen fotorrealista, por nicho.
// ============================================================
async function generateImagePostScript({ profile: profileName = DEFAULT_PROFILE, category, account = null } = {}) {
  const profile = getProfile(profileName);
  const chosenCategory = category || pickCategory(profile);

  if (DRY_RUN) {
    logger.info('[MOCK] Generando post de imagen simulado (0 costo)', { category: chosenCategory, profile: profileName });
    return {
      topic: `Dato impactante de prueba sobre ${chosenCategory}`,
      titulo: `ESTO SOBRE ${chosenCategory.toUpperCase()} TE VA A SORPRENDER`,
      descripcion: `Un dato fascinante sobre ${chosenCategory} que muy pocos conocen.\n\nLa naturaleza guarda secretos increibles.`,
      imagePrompt: `Photorealistic dramatic image related to ${chosenCategory}, cinematic lighting, high detail, striking and impactful, no text`,
      category: chosenCategory,
      tags: buildTags(`prueba ${chosenCategory}`, chosenCategory, [], profileName),
    };
  }

  // Instrucciones MUY diferenciadas por canal, para que Hipotesis4D no genere
  // datos reales tipo Curious4D. Cada canal tiene su esencia:
  //  - Curious4D  -> dato REAL, verificable, sorprendente
  //  - Hipotesis4D -> escenario HIPOTETICO "¿que pasaria si...?" anclado en algo real
  const esHipotesis = profileName === 'hipotesis4d';

  const instruccionNicho = esHipotesis
    ? `Eres creador de contenido viral para el canal "Hipotesis4D", especializado en ESCENARIOS HIPOTETICOS REALISTAS de tipo ucronia ("¿que hubiera pasado si...?").
Genera UN escenario hipotetico de la categoria "${chosenCategory}" que cumpla ESTRICTAMENTE estas reglas:
1. Debe partir de algo que REALMENTE EXISTIO o EXISTE (un evento historico, una civilizacion, una especie, un descubrimiento, una ley cientifica real) y especular sobre un desenlace distinto que NO ocurrio pero que era plausible.
2. Es historia/ciencia alternativa creible, NO ciencia ficcion fantasiosa. El espectador debe pensar "guau, eso pudo haber pasado de verdad", no "que pagina tan loca".
3. PROHIBIDO lo fantasioso e imposible: nada de humanos con alas, superpoderes, magia, viajes en el tiempo, universos paralelos inventados, o cosas fisicamente imposibles. Eso arruina la credibilidad del canal.
Ejemplos del estilo CORRECTO (realista, anclado, plausible): "¿Que hubiera pasado si los dinosaurios nunca se hubieran extinguido?", "¿Y si el Imperio Romano nunca hubiera caido?", "¿Que hubiera pasado si la Biblioteca de Alejandria no se hubiera quemado?", "¿Y si los nazis hubieran conseguido la bomba atomica primero?", "¿Que pasaria si la Antartida se derritiera por completo?".
Ejemplos del estilo INCORRECTO (fantasioso, prohibido): "¿Que pasaria si los humanos tuvieran alas?", "¿Y si pudieramos leer la mente?", "¿Que pasaria si existieran los dragones?". NO generes nada asi.`
    : `Eres creador de contenido viral para el canal "Curious4D", especializado en DATOS CURIOSOS reales.
Genera UN dato o hecho REAL, verificable e IMPACTANTE de la categoria "${chosenCategory}" — algo que la mayoria de la gente NO sabe y que genere asombro inmediato ("no tenia idea de esto").
El dato debe ser cierto y comprobable, no inventado ni especulativo.`;

  const ejemploTitulo = esHipotesis
    ? "QUE HUBIERA PASADO SI LOS DINOSAURIOS NUNCA SE HUBIERAN EXTINGUIDO"
    : "EN LO PROFUNDO DEL OCEANO EXISTE UNA CRIATURA QUE NO MUERE";

  const prompt = `${instruccionNicho}

Responde SOLO con un JSON valido, sin markdown, con este formato exacto:
{
  "topic": "tema corto en español",
  "titulo": "titular MUY impactante de 8 a 14 palabras en español, en tono de ${esHipotesis ? 'pregunta o premisa hipotetica intrigante' : 'revelacion asombrosa'}, para poner GRANDE sobre la imagen (ej estilo: '${ejemploTitulo}'). Sin comillas internas. Revisa muy bien la ortografia, va a quedar en letras grandes sobre la imagen.",
  "descripcion": "texto de 3 a 5 parrafos cortos en español que desarrollan ${esHipotesis ? 'el escenario hipotetico de forma imaginativa pero anclada en la realidad' : 'el dato de forma fascinante y educativa'}, para el pie de foto. Termina con una pregunta que invite a comentar.${esHipotesis ? '' : ' Incluye la fuente al final si es un hecho cientifico concreto.'}",
  "image_prompt": "detailed photorealistic image description in ENGLISH for a striking, dramatic, high-impact image that illustrates ${esHipotesis ? 'the hypothetical scenario' : 'the fact'}. Cinematic, realistic, no text overlays, highly detailed. This is what makes people stop scrolling.",
  "tags": ["5 a 8 palabras clave en español, minusculas, sin #"]
}

REGLAS DE IDIOMA (criticas): "titulo", "descripcion", "topic" y "tags" en ESPAÑOL. "image_prompt" en INGLES. NUNCA uses caracteres chinos, japoneses ni coreanos. Solo alfabeto latino. Usa comillas rectas para el JSON.
IMPORTANTISIMO: el "titulo" debe estar 100% en español, sin NI UNA sola palabra en ingles. Nada de "tail", "brain", "what if", etc. — usa siempre la palabra en español (cola, cerebro, que pasaria si). Un titulo con palabras en ingles mezcladas es INVALIDO.
IMPORTANTE: revisa la ortografia del "titulo" con cuidado — cualquier error quedara MUY visible en letras grandes sobre la imagen.
${esHipotesis ? 'El escenario debe ser IMAGINATIVO y especulativo (¿que pasaria si?), anclado en algo real pero proyectado hacia lo hipotetico.' : 'El dato debe ser REAL y verificable, no inventado.'} El titular debe generar el impulso irresistible de saber mas.`;

  const promptConHistorial = prompt + (account ? bloqueEvitarRepeticion(account) : '');

  const MAX_INTENTOS = 6;
  let ultimoError;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      const resp = await withRetry(
        () =>
          axios.post(
            `${BASE_URL}/v1/chat/completions`,
            { model: 'agnes-2.0-flash', max_tokens: 2000, messages: [{ role: 'user', content: promptConHistorial }] },
            { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } }
          ),
        { label: 'Agnes generar post de imagen' }
      );

      const raw = resp.data.choices[0].message.content.trim();
      const parsed = parseAgnesJson(raw);

      if (!parsed.titulo || !parsed.titulo.trim()) throw new Error('Post sin titulo.');
      if (!parsed.image_prompt || !parsed.image_prompt.trim()) throw new Error('Post sin image_prompt.');
      if (!parsed.descripcion || !parsed.descripcion.trim()) throw new Error('Post sin descripcion.');

      logger.info('Post de imagen generado', { topic: parsed.topic, titulo: parsed.titulo, intento });

      return {
        topic: parsed.topic,
        titulo: parsed.titulo,
        descripcion: parsed.descripcion,
        imagePrompt: parsed.image_prompt,
        category: chosenCategory,
        tags: buildTags(parsed.topic, chosenCategory, parsed.tags || [], profileName),
      };
    } catch (err) {
      ultimoError = err;
      logger.warn(`Post de imagen mal formado en intento ${intento}/${MAX_INTENTOS}`, { error: err.message });
    }
  }
  throw new Error(`Agnes devolvio posts de imagen mal formados ${MAX_INTENTOS} veces. Ultimo error: ${ultimoError.message}`);
}

module.exports = { generateScript, generateImagePostScript, CATEGORIES, buildTags, CONTENT_PROFILES, getProfile };
