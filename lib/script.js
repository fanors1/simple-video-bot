const axios = require('axios');
const { withRetry } = require('./retry');
const logger = require('./logger');
const { bloqueEvitarRepeticion } = require('./historial');

const BASE_URL = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com';
const API_KEY = process.env.AGNES_API_KEY || '';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function delayReintentoGuion(intento) {
  const base = 3000 * intento; 
  const jitter = Math.random() * 2000;
  return Math.round(base + jitter);
}

const HOOK_RULES = `Reglas de gancho (aplican a TODO el guion):
- El primer segmento abre con algo inesperado (imagen, dato o giro), nunca lento. La promesa central queda clara en los primeros 3-4 segundos.
- Varia la formula de apertura entre videos, manteniendo el estilo del canal.
- El gancho (miedo/curiosidad/urgencia) nunca reemplaza el contenido real: el video cierra con un dato verificable que valga la pena.

Disparador psicologico (elegi UNO antes de escribir, y diseña todo el guion para intensificarlo; varia cual usas entre videos):
1. "curiosidad": brecha de informacion, insinua sin revelar del todo.
2. "miedo": aversion a la perdida; inquietud genuina, no gore ni panico.
3. "urgencia": algo que te afecta a vos, ahora, no atemporal.

"hook_text": frase de 4 a 7 palabras en español para texto grande en pantalla, distinta de la narracion. Debe funcionar SIN SONIDO (muchos ven en silencio) y reflejar el disparador elegido.

Cierre (en la narracion del ULTIMO segmento, no es campo aparte): una pregunta hablada diseñada para generar comentarios, conectada al tema especifico del video. Usa UNO (varia entre videos): dilema entre dos opciones concretas; involucrar la opinion/identidad personal del espectador de forma directa; leve friccion u opinion que invite a discutir; o preguntar si sabria que hacer en esa situacion (para supervivencia/riesgo).
PROHIBIDO frases transaccionales ("comenta X", "dale like", "etiqueta a", "sigueme para mas"): Meta las penaliza en silencio.

REGLA DE IDIOMA (critica): "narration", "topic", "hook_text" y "tags" en ESPAÑOL; "visual_prompt" en INGLES. NUNCA uses caracteres chinos/japoneses/coreanos ni nada fuera del alfabeto latino (ni un solo caracter, o la respuesta es invalida). JSON con comillas rectas ("), nunca tipograficas, y escapa las comillas internas.`;

function injectHookRules(promptBody) {
  return `${promptBody}\n\n${HOOK_RULES}`;
}

const CONTENT_PROFILES = {
  curious4d: {
    categories: [
      'animales', 'ciencia', 'espacio', 'historia',
      'naturaleza', 'cuerpo humano', 'tecnologia', 'misterios',
      'comida', 'geografia', 'inventos', 'cultura', 'psicologia',
      'oceanos', 'insectos', 'plantas', 'dinero', 'deportes',
      'lenguaje', 'arte', 'musica', 'records mundiales',
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
      comida: ['comida', 'gastronomia', 'alimentos'],
      geografia: ['geografia', 'paises', 'lugares', 'mundo'],
      inventos: ['inventos', 'inventores', 'innovaciones'],
      cultura: ['cultura', 'tradiciones', 'costumbres'],
      psicologia: ['psicologia', 'mente', 'comportamiento'],
      oceanos: ['oceanos', 'mar', 'vida marina', 'profundidades'],
      insectos: ['insectos', 'bichos', 'entomologia'],
      plantas: ['plantas', 'botanica', 'flora'],
      dinero: ['dinero', 'economia', 'finanzas', 'curiosidades'],
      deportes: ['deportes', 'atletas', 'records deportivos'],
      lenguaje: ['lenguaje', 'idiomas', 'palabras', 'linguistica'],
      arte: ['arte', 'pintura', 'artistas', 'obras'],
      musica: ['musica', 'instrumentos', 'sonido'],
      'records mundiales': ['records mundiales', 'guinness', 'lo mas grande'],
    },
    promptBuilder: (chosenCategory, segmentCount) => injectHookRules(`Eres guionista de un canal de curiosidades tipo "Curious4D" (datos sorprendentes en menos de 30 segundos).
Genera UN dato curioso real y verificable de la categoria "${chosenCategory}".
Divide la narracion en EXACTAMENTE ${segmentCount} segmentos. CADA segmento debe ser MUY CORTO: maximo 12 palabras, idealmente 8-10, para que dure unos 4 segundos al hablarlo. NO escribas oraciones largas. El video completo no puede pasar de 50 segundos, asi que se breve y directo en cada segmento.

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
      'amenaza real y supervivencia', 'evolucion alternativa', 'economia hipotetica',
      'geografia alternativa', 'sociedad alternativa', 'fin del mundo',
      'viajes en el tiempo', 'realidades paralelas', 'inteligencia artificial',
      'colonizacion espacial', 'cambios en el cuerpo', 'desapariciones hipoteticas',
      'poderes o habilidades', 'catastrofes naturales', 'que pasaria si desapareciera',
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
      'espacio hipotetico': ['espacio', 'universo', 'astronomia hipotetica'],
      'evolucion alternativa': ['evolucion', 'especies', 'biologia'],
      'economia hipotetica': ['economia', 'dinero', 'sociedad'],
      'geografia alternativa': ['geografia', 'mundo alternativo', 'planeta'],
      'sociedad alternativa': ['sociedad', 'civilizacion', 'cultura'],
      'fin del mundo': ['apocalipsis', 'fin del mundo', 'catastrofe'],
      'viajes en el tiempo': ['viajes en el tiempo', 'tiempo', 'paradoja'],
      'realidades paralelas': ['realidades paralelas', 'multiverso', 'dimensiones'],
      'inteligencia artificial': ['inteligencia artificial', 'ia', 'robots', 'futuro'],
      'colonizacion espacial': ['colonizacion', 'marte', 'espacio', 'planetas'],
      'cambios en el cuerpo': ['cuerpo humano', 'evolucion', 'biologia'],
      'desapariciones hipoteticas': ['desaparicion', 'que pasaria', 'hipotesis'],
      'poderes o habilidades': ['poderes', 'habilidades', 'superhumano'],
      'catastrofes naturales': ['catastrofe', 'desastre natural', 'supervivencia'],
      'que pasaria si desapareciera': ['que pasaria si', 'desaparicion', 'hipotesis'],
      'espacio hipotetico': ['espacio', 'universo', 'astronomia especulativa'],
    },
    pickCategory(categories) {
      const sinExtremo = categories.filter((c) => c !== 'fenomeno natural extremo');
      const incluyeExtremo = categories.includes('fenomeno natural extremo');
      if (incluyeExtremo && Math.random() < 0.2) return 'fenomeno natural extremo';
      return sinExtremo[Math.floor(Math.random() * sinExtremo.length)];
    },
    promptBuilder: (chosenCategory, segmentCount) => injectHookRules(`Eres guionista del canal "Hipotesis4D", especializado en escenarios hipoteticos e imaginativos (formato corto, menos de 30 segundos).
Genera UN escenario hipotetico original de la categoria "${chosenCategory}".

Reglas del canal:
- NO abras siempre con "¿Que pasaria si...?". Varia: "Imagina un mundo donde...", "Existe la posibilidad de que...", "Esto pasaria si...", u otras.
- Anclá la premisa en algo REAL y verificable (un hecho, especie, civilizacion o ley cientifica que existio o existe) y especula desde ahi. Nada totalmente inventado.
- Si es "fenomeno natural extremo": tono curioso, no sensacionalista; rota eventos (terremoto, tsunami, erupcion, etc.).
- Si es "amenaza real y supervivencia": una amenaza real y plausible (pandemia, tormenta solar, asteroide, etc.), y SIEMPRE cerra explicando como sobrevivir o que hacer.
- No fomentes panico real sobre riesgos actuales; que se sienta entretenimiento imaginativo, no una advertencia real.

Divide la narracion en EXACTAMENTE ${segmentCount} segmentos. CADA segmento debe ser MUY CORTO: maximo 12 palabras, idealmente 8-10, para que dure unos 4 segundos al hablarlo. NO escribas oraciones largas. El video completo no puede pasar de 50 segundos, asi que se breve y directo en cada segmento.

Responde SOLO con un JSON valido, sin markdown, con este formato exacto:
{
  "topic": "titulo corto y llamativo en español",
  "trigger_type": "curiosidad, miedo, o urgencia (ver reglas de gancho)",
  "hook_text": "frase de 4 a 7 palabras para texto grande en pantalla",
  "tags": ["5 a 8 palabras clave en español, en minusculas, sin #"],
  "segments": [
    {"narration": "texto en español para leer en voz alta", "visual_prompt": "visual description in English, cinematic, no text overlays, 9:16 vertical"}
  ]
}
El array "segments" debe tener exactamente ${segmentCount} elementos.`),
  },
  oscuro4d: {
    categories: [
      'leyenda latinoamericana', 'criatura del folclore latino', 'leyenda mundial',
      'mitologia antigua', 'ser sobrenatural del folclore', 'aparicion o espiritu legendario',
      'monstruo o bestia legendaria', 'leyenda indigena o ancestral',
      'lugar maldito o embrujado', 'ritual o maldicion antigua',
      'leyenda europea', 'leyenda asiatica', 'leyenda africana',
      'demonio o entidad maligna', 'fantasma historico', 'mito de la creacion',
      'criatura marina legendaria', 'bruja o hechiceria', 'objeto maldito',
      'leyenda de terror urbana', 'ser del inframundo', 'presagio o superticion',
    ],
    channelTags: ['mitos', 'leyendas', 'folclore', 'misterio', 'terror', 'shorts', 'oscuro4d'],
    categoryTags: {
      'leyenda latinoamericana': ['leyenda', 'folclore latinoamericano', 'mito'],
      'criatura del folclore latino': ['criatura', 'folclore latino', 'leyenda'],
      'leyenda mundial': ['leyenda', 'folclore mundial', 'mito'],
      'mitologia antigua': ['mitologia', 'dioses', 'mito antiguo'],
      'ser sobrenatural del folclore': ['sobrenatural', 'aparicion', 'folclore'],
      'aparicion o espiritu legendario': ['espiritu', 'aparicion', 'fantasma'],
      'monstruo o bestia legendaria': ['criatura', 'bestia legendaria', 'monstruo'],
      'leyenda indigena o ancestral': ['leyenda ancestral', 'mito indigena', 'tradicion'],
      'lugar maldito o embrujado': ['lugar embrujado', 'maldicion', 'terror'],
      'ritual o maldicion antigua': ['ritual', 'maldicion', 'oculto'],
      'leyenda europea': ['leyenda europea', 'folclore europeo', 'mito'],
      'leyenda asiatica': ['leyenda asiatica', 'folclore asiatico', 'mito'],
      'leyenda africana': ['leyenda africana', 'folclore africano', 'mito'],
      'demonio o entidad maligna': ['demonio', 'entidad', 'maligno'],
      'fantasma historico': ['fantasma', 'aparicion', 'historia'],
      'mito de la creacion': ['mito de creacion', 'mitologia', 'origen'],
      'criatura marina legendaria': ['criatura marina', 'monstruo marino', 'leyenda'],
      'bruja o hechiceria': ['bruja', 'hechiceria', 'brujeria'],
      'objeto maldito': ['objeto maldito', 'maldicion', 'terror'],
      'leyenda de terror urbana': ['leyenda urbana', 'terror', 'creepypasta'],
      'ser del inframundo': ['inframundo', 'demonio', 'mitologia'],
      'presagio o superticion': ['presagio', 'superticion', 'creencia'],
    },
    promptBuilder: (chosenCategory, segmentCount) => injectHookRules(`Eres guionista del canal "Oscuro4D", dedicado a mitos, leyendas, folclore y misterios inquietantes del mundo, con tono de terror atmosferico y enigmatico (formato corto, menos de 30 segundos).
Genera UN relato escalofriante de la categoria "${chosenCategory}", basado en una leyenda, mito o criatura REAL Y CONOCIDA que existe de verdad en el folclore.

Reglas del canal (CRITICAS):
- USA UNA LEYENDA REAL Y CONOCIDA, NUNCA INVENTES una. Debe ser una leyenda, mito o criatura que existe de verdad en el folclore y que la gente puede reconocer o buscar. Ejemplos latinoamericanos: La Llorona, El Mohan, La Patasola, El Silbon, El Sombreron, La Madremonte, El Cadejo, La Sayona, El Duende, La Tunda, El Familiar, La Ciguapa, El Pombero, La Luz Mala, El Chupacabras. Ejemplos mundiales: El Wendigo, La Banshee, El Krampus, Baba Yaga, El Jinete sin Cabeza, La Dama de Blanco, El Yokai, El Djinn. Mitologias: dioses y seres de la mitologia griega, nordica, egipcia, azteca, maya. Elige una leyenda REAL acorde a la categoria "${chosenCategory}" y cuentala fielmente segun se conoce en el folclore. NO inventes nombres ni criaturas nuevas.
- USA SIEMPRE lenguaje de leyenda: "cuentan que...", "se dice que...", "segun la leyenda...", "dicen los que viven ahi...". El miedo viene del misterio, no de afirmar que algo es real.
- Tono reflexivo, oscuro y atmosferico. Genera escalofrios e intriga, no gore explicito ni violencia grafica (para no perjudicar la monetizacion).
- Construye tension progresiva: cada segmento revela un poco mas, guardando el detalle mas inquietante para casi el final.
- GANCHO VISUAL (segmento 1, CRITICO): el visual_prompt del PRIMER segmento SIEMPRE debe mostrar la figura o presencia central DE ESTA leyenda especifica, vista A LO LEJOS o parcialmente oculta, que genere incertidumbre y frene el scroll. La figura DEBE corresponder fielmente a como se describe esa criatura o ser en la leyenda real (si es La Llorona, una mujer de blanco junto al agua; si es El Silbon, una silueta alta y delgada con un saco; si es El Mohan, una figura peluda cerca del rio). La clave: NO se ve por completo, esta lejana, entre niebla o sombras, pero coincide con la leyenda. SIEMPRE lejana, incompleta, insinuada, nunca en primer plano ni con rostro detallado (la IA deforma los rostros cercanos). Debe describir la escena completa alrededor de la figura (el lugar, la niebla, la luz).
- ESTILO VISUAL (TODOS los visual_prompt): foto-realista y cinematografico, como fotogramas de una pelicula de terror real (photorealistic, cinematic film still, realistic lighting, hyperrealistic, dramatic shadows). NO estilo caricatura ni dibujo ni ilustracion. Escenas atmosfericas y concretas (niebla, bosques oscuros, siluetas lejanas, casas abandonadas, lunas, rios, caminos de noche) fieles al lugar donde ocurre la leyenda. Sin rostros en primer plano deformables. Nada de texto en la imagen.
- El ULTIMO segmento SIEMPRE cierra con una pregunta directa que invite al debate en comentarios (ej: "¿Tu crees que es solo una leyenda, o hay algo real detras?").

Divide la narracion en EXACTAMENTE ${segmentCount} segmentos. CADA segmento debe ser MUY CORTO: maximo 12 palabras, idealmente 8-10, para que dure unos 4 segundos al hablarlo. NO escribas oraciones largas. El video completo no puede pasar de 50 segundos, asi que se breve y directo en cada segmento.

Responde SOLO con un JSON valido, sin markdown, con este formato exacto:
{
  "topic": "titulo corto y llamativo en español",
  "trigger_type": "curiosidad, miedo, o urgencia (ver reglas de gancho)",
  "hook_text": "frase de 4 a 7 palabras para texto grande en pantalla",
  "tags": ["5 a 8 palabras clave en español, en minusculas, sin #"],
  "segments": [
    {"narration": "texto en español para leer en voz alta", "visual_prompt": "visual description in English, cinematic, atmospheric, no text overlays, 9:16 vertical"}
  ]
}
El array "segments" debe tener exactamente ${segmentCount} elementos.`),
  },
  vive4d: {
    categories: [
      'esperanza', 'fortaleza', 'paz interior', 'consuelo', 'confianza en Dios',
      'valentia y fe', 'descanso del alma', 'amor de Dios', 'gratitud', 'perdon',
      'superar el miedo', 'no rendirse', 'sanar el corazon', 'proposito de vida',
      'fe en tiempos dificiles', 'nuevo comienzo', 'luz en la oscuridad',
      'la palabra de Dios', 'gozo verdadero', 'proteccion divina', 'guia espiritual', 'promesas de Dios',
    ],
    channelTags: ['fe', 'esperanza', 'versiculos', 'biblia', 'palabra de Dios', 'cristiano', 'shorts', 'fe4d'],
    categoryTags: {
      esperanza: ['esperanza', 'fe', 'versiculos'],
      fortaleza: ['fortaleza', 'fe', 'animo'],
      'paz interior': ['paz', 'calma', 'fe'],
      consuelo: ['consuelo', 'consolacion', 'fe'],
      'confianza en Dios': ['confianza', 'fe en Dios', 'versiculos'],
      'valentia y fe': ['valentia', 'valor', 'fe'],
      'descanso del alma': ['descanso', 'paz', 'alma'],
      'amor de Dios': ['amor de Dios', 'amor', 'fe'],
      gratitud: ['gratitud', 'agradecimiento', 'fe'],
      perdon: ['perdon', 'reconciliacion', 'fe'],
      'superar el miedo': ['superar el miedo', 'valentia', 'fe'],
      'no rendirse': ['no rendirse', 'perseverancia', 'fe'],
      'sanar el corazon': ['sanacion', 'consuelo', 'fe'],
      'proposito de vida': ['proposito', 'vida', 'fe'],
      'fe en tiempos dificiles': ['fe', 'tiempos dificiles', 'esperanza'],
      'nuevo comienzo': ['nuevo comienzo', 'renovacion', 'fe'],
      'luz en la oscuridad': ['luz', 'esperanza', 'fe'],
      'la palabra de Dios': ['palabra de Dios', 'biblia', 'versiculos'],
      'gozo verdadero': ['gozo', 'alegria', 'fe'],
      'proteccion divina': ['proteccion', 'amparo', 'fe'],
      'guia espiritual': ['guia', 'direccion', 'fe'],
      'promesas de Dios': ['promesas de Dios', 'fe', 'esperanza'],
    },
    promptBuilder: (chosenCategory, segmentCount, extra = {}) => {
      const v = extra.versiculo || { texto: 'Todo lo puedo en Cristo que me fortalece.', cita: 'Filipenses 4:13', deJesus: false };
      const vozNota = v.deJesus
        ? 'Este versiculo son palabras textuales de Jesus, asi que el segmento del versiculo se narra en PRIMERA PERSONA (como si Jesus mismo hablara con voz serena y amorosa).'
        : 'Este versiculo NO son palabras de Jesus, asi que se narra como palabra proclamada con respeto (tercera persona), NUNCA en primera persona como si fuera Jesus.';
      return `Eres guionista del canal "VIVE4D" (Vive la Palabra), un espacio cristiano que comparte versiculos reales de la Biblia Reina-Valera 1960 envueltos en un mensaje de ESPERANZA para un mundo que parece haberla perdido. Formato reel corto (20 a 60 segundos). Tono calido, sereno, esperanzador y respetuoso, que transmita paz y tranquilidad, como quien habla al corazon de alguien cansado o desanimado.

VERSICULO REAL A USAR (obligatorio, NO lo cambies ni inventes otro, citalo EXACTAMENTE asi):
"${v.texto}" — ${v.cita}
${vozNota}

Categoria/tema de la reflexion: "${chosenCategory}".

Estructura obligatoria de los ${segmentCount} segmentos:
- SEGMENTO 1 (gancho de apertura): una frase suave que haga sentir a la persona que este video le llego por una razon, SIN afirmar que Dios la eligio personalmente. Ejemplos de tono: "Quizas no fue casualidad que vieras esto hoy", "Tal vez necesitabas escuchar esto justo ahora", "Nada llega por casualidad; recibe esta palabra".
- SEGMENTO(S) CENTRAL(ES): presenta el versiculo (con su cita ${v.cita}) y desarrolla un mensaje de aliento que conecte con el sentir del mundo de hoy (cansancio, ansiedad, soledad, falta de esperanza), transmitiendo que la verdadera fuerza y paz vienen de Dios / de Cristo, no de nosotros solos.
- SEGMENTO FINAL (cierre suave): una invitacion calida y sin presion que varie segun el tema (ej. para esperanza: "Que esta esperanza te acompane hoy"; para fortaleza: "Recuerdalo cuando te sientas debil"; para consuelo: "Si alguien vino a tu mente, quizas necesita esto hoy"). NUNCA obligues a dar like ni condiciones la bendicion a compartir.

Reglas CRITICAS:
- USA EXACTAMENTE el versiculo dado, con su cita correcta (${v.cita}). NUNCA inventes versiculos, numeros de capitulo ni frases biblicas.
- Tono respetuoso y universal. NO pidas dinero, NO manipules emocionalmente, NO uses formulas de "cadena".
- ESTILO VISUAL (TODOS los visual_prompt): foto-realista y cinematografico, escenas de gran belleza que transmitan paz y tranquilidad, con luz calida y dorada. Para dar variedad, ALTERNA entre estos dos mundos segun el segmento:
  (A) CELESTIAL / hacia el reino de los cielos (sugerido de forma poetica, NUNCA literal): un camino de luz que asciende entre nubes doradas, rayos de sol atravesando las nubes como escaleras de luz, un resplandor calido en el horizonte, cielos infinitos al amanecer, estrellas y galaxias suaves, luz celestial entre las nubes. Sugiere la trascendencia y la cercania de Dios SIN representar edificios concretos, ni a Dios, ni a Jesus, ni figuras sagradas.
  (B) TERRESTRE / los recursos mas hermosos de la Tierra: paisajes espectaculares y coloridos que llamen la atencion y transmitan calma (auroras boreales, montanas majestuosas con luz dorada, oceanos y mares en calma al amanecer, cataratas, campos de flores, bosques con luz atravesando los arboles, lagos cristalinos, valles verdes). Colores vivos y hermosos pero siempre serenos.
  En AMBOS casos: cinematografico, hiperrealista, luz calida y esperanzadora, sensacion de paz. Sin rostros en primer plano. Nada de texto en la imagen.

Divide la narracion en EXACTAMENTE ${segmentCount} segmentos. Cada segmento corto: maximo 14 palabras, para que fluya al hablarlo con calma.

Responde SOLO con un JSON valido, sin markdown, con este formato exacto:
{
  "topic": "titulo corto y esperanzador en español",
  "trigger_type": "curiosidad",
  "hook_text": "frase de 4 a 7 palabras para texto grande en pantalla",
  "tags": ["5 a 8 palabras clave en español, en minusculas, sin #"],
  "segments": [
    {"narration": "texto en español para leer en voz alta", "visual_prompt": "visual description in English, cinematic, atmospheric, golden warm hopeful light, no text overlays, 9:16 vertical"}
  ]
}
El array "segments" debe tener exactamente ${segmentCount} elementos.`;
    },
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

const VIRAL_TAGS = ['viral', 'parati'];

const TAGS_ALCANCE = {
  curious4d: ['datos curiosos', 'curiosidades', 'sabias que', 'datos increibles', 'aprende', 'cultura general', 'top', 'datos interesantes'],
  hipotesis4d: ['que pasaria si', 'historia alternativa', 'hipotesis', 'y si', 'realidad alternativa', 'historia', 'documental', 'especulacion'],
  oscuro4d: ['videos de miedo', 'terror', 'miedo', 'fantasmas', 'leyendas', 'historias de terror', 'paranormal', 'leyendas de terror', 'misterio', 'terror latino'],
};

function buildTags(topic, category, aiTags = [], profileName = DEFAULT_PROFILE) {
  const profile = getProfile(profileName);
  const combined = [...aiTags, ...(profile.categoryTags[category] || [category]), ...profile.channelTags];
  const especificos = [...new Set(combined.map((t) => t.toLowerCase().trim()))].filter((t) => t && !VIRAL_TAGS.includes(t));

  const tags = especificos.slice(0, 3);
  for (const viral of VIRAL_TAGS) {
    if (tags.length >= 5) break;
    if (!tags.includes(viral)) tags.push(viral);
  }
  return tags;
}

function buildTagsLargo(topic, aiTags = [], profileName = DEFAULT_PROFILE) {
  const alcance = TAGS_ALCANCE[profileName] || TAGS_ALCANCE.curious4d;
  const especificos = (aiTags || []).map((t) => t.toLowerCase().trim()).filter(Boolean);
  const combined = [...new Set([...especificos, ...alcance, ...VIRAL_TAGS])].filter(Boolean);
  return combined.slice(0, 15);
}

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function parseAgnesJson(raw) {
  let text = raw.replace(/^```json\s*|\s*```$/g, '').trim();

  const tieneCJK = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(text);
  if (tieneCJK) {
    throw new Error('Agnes genero caracteres CJK (chino/japones/coreano) en el guion, respuesta invalida.');
  }

  try {
    return JSON.parse(text);
  } catch (_) {
  }

  const primeraLlave = text.indexOf('{');
  const ultimaLlave = text.lastIndexOf('}');
  if (primeraLlave !== -1 && ultimaLlave !== -1 && ultimaLlave > primeraLlave) {
    text = text.slice(primeraLlave, ultimaLlave + 1);
  } else if (primeraLlave !== -1) {
    text = text.slice(primeraLlave);
  }

  text = text
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'");

  text = repararComillaAperturaFaltante(text);

  text = text.replace(/,(\s*[}\]])/g, '$1');

  text = text.replace(/("tags"\s*:\s*)\[([^\]]*)\]/g, (match, prefijo, contenido) => {
    if (contenido.includes('"')) return match;
    const elementos = contenido
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0)
      .map((e) => '"' + e.replace(/"/g, '') + '"');
    return prefijo + '[' + elementos.join(', ') + ']';
  });

  try {
    return JSON.parse(text);
  } catch (_) {
  }

  return JSON.parse(cerrarJsonTruncado(text));
}

function repararComillaAperturaFaltante(text) {
  return text.replace(/("(?:narration|narracion|visual_prompt|visual|topic|hook_text|trigger_type|texto|text|prompt|titulo|title|titular|image_prompt|imagen_prompt|descripcion|description|desc|caption)"\s*:\s*)([^"\s\[{][^,}\]\n]*)/g,
    (match, clave, valor) => {
      const v = valor.trim();
      if (v === 'true' || v === 'false' || v === 'null' || /^-?\d+(\.\d+)?$/.test(v)) return match;
      return clave + '"' + v.replace(/"/g, '\\"') + '"';
    });
}

function cerrarJsonTruncado(text) {
  let t = text;

  const comillas = (t.match(/(?<!\\)"/g) || []).length;
  if (comillas % 2 !== 0) t += '"';

  let abiertas = 0, cerradas = 0, abreCor = 0, cierraCor = 0;
  let dentroString = false, escapado = false;
  for (const ch of t) {
    if (escapado) { escapado = false; continue; }
    if (ch === '\\') { escapado = true; continue; }
    if (ch === '"') { dentroString = !dentroString; continue; }
    if (dentroString) continue;
    if (ch === '{') abiertas++;
    else if (ch === '}') cerradas++;
    else if (ch === '[') abreCor++;
    else if (ch === ']') cierraCor++;
  }

  t = t.replace(/,\s*$/, '');
  t += ']'.repeat(Math.max(0, abreCor - cierraCor));
  t += '}'.repeat(Math.max(0, abiertas - cerradas));
  return t;
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

  let versiculoElegido = null;
  if (profileName === 'vive4d') {
    const { elegirVersiculo } = require('./versiculos');
    const histVers = account && account.historialVersiculos ? account.historialVersiculos : [];
    versiculoElegido = elegirVersiculo(histVers);
    logger.info('Versiculo elegido para VIVE4D', { cita: versiculoElegido.cita, deJesus: versiculoElegido.deJesus });
  }

  const MAX_INTENTOS_GUION = 6;
  let ultimoError;
  let ultimoRaw = null;

  for (let intento = 1; intento <= MAX_INTENTOS_GUION; intento++) {
    try {
      let promptFinal = versiculoElegido
        ? profile.promptBuilder(chosenCategory, segmentCount, { versiculo: versiculoElegido })
        : profile.promptBuilder(chosenCategory, segmentCount);
      if (segmentCount <= 2) {
        promptFinal += `\n\nMODO HISTORIA (IMPORTANTE): Este es un formato MUY corto de ${segmentCount} segmento(s) para una Historia de Instagram/Facebook. Genera UN solo dato o gancho directo y contundente, facil de entender en pocos segundos. La narracion debe ser breve pero COMPLETA: NUNCA dejes el campo "narration" vacio. No te compliques con estructura larga. Asegurate de que CADA segmento tenga su "narration" en español y su "visual_prompt" en ingles, ambos con contenido real y no vacio.`;
      }
      if (account) promptFinal += bloqueEvitarRepeticion(account);
      if (ultimoError && /CJK/.test(ultimoError.message)) {
        promptFinal += `\n\nADVERTENCIA CRITICA: tu respuesta anterior genero caracteres chinos/japoneses/coreanos y fue rechazada. NO uses NINGUN caracter fuera del alfabeto latino en ningun campo, ni siquiera uno. Escribi absolutamente todo en español (o ingles solo en visual_prompt). Revisa cada palabra antes de responder.`;
      }

      const resp = await withRetry(
        () =>
          axios.post(
            `${BASE_URL}/v1/chat/completions`,
            {
              model: 'agnes-2.0-flash',
              max_tokens: 8000,
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
      ultimoRaw = raw;
      const parsed = parseAgnesJson(raw);

      if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
        throw new Error('El guion generado no tiene un array de segmentos valido.');
      }

      const todosLosSegmentos = parsed.segments.map((s) => ({
        narration: s.narration || s.narracion || s.texto || s.text,
        visualPrompt: s.visual_prompt || s.visualPrompt || s.visual || s.prompt,
      }));

      const segments = todosLosSegmentos.filter(
        (s) => s.narration && typeof s.narration === 'string' && s.narration.trim() &&
               s.visualPrompt && typeof s.visualPrompt === 'string' && s.visualPrompt.trim()
      );

      const descartados = todosLosSegmentos.length - segments.length;
      const MIN_SEGMENTOS = segmentCount <= 2 ? segmentCount : Math.ceil(segmentCount / 2) + 1;

      if (segments.length < MIN_SEGMENTOS) {
        throw new Error(
          `Agnes devolvio solo ${segments.length} segmento(s) validos (minimo ${MIN_SEGMENTOS} para ${segmentCount} pedidos). El resto vino sin narracion o sin visual_prompt.`
        );
      }

      if (descartados > 0) {
        logger.warn(`Agnes dejo ${descartados} segmento(s) vacios, pero ${segments.length} son validos (suficientes). Se usa el guion; video un poco mas corto de lo normal.`);
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
        versiculo: versiculoElegido || undefined,
      };
    } catch (err) {
      ultimoError = err;
      const quedanIntentos = intento < MAX_INTENTOS_GUION;

      const pareceSegmentosVacios = /segmento\(s\) sin narracion|segmento\(s\) validos/.test(err.message);
      const logData = { error: err.message };
      if (pareceSegmentosVacios && ultimoRaw) {
        logData.rawPreview = ultimoRaw.slice(0, 400);
      }

      logger.warn(
        quedanIntentos
          ? `Guion mal formado en intento ${intento}/${MAX_INTENTOS_GUION}, reintentando`
          : `Guion mal formado en el ultimo intento (${intento}/${MAX_INTENTOS_GUION}), no quedan mas reintentos`,
        logData
      );

      if (quedanIntentos) {
        const delay = delayReintentoGuion(intento);
        logger.info(`Esperando ${delay}ms antes del siguiente intento de guion`, { intento });
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Agnes devolvio guiones mal formados ${MAX_INTENTOS_GUION} veces seguidas. Ultimo error: ${ultimoError.message} ` +
      'Esto suele pasar por respuestas truncadas del modelo.'
  );
}

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

      const titulo = parsed.titulo || parsed.title || parsed.titular || parsed.topic;
      const imagePrompt = parsed.image_prompt || parsed.imagePrompt || parsed.imagen_prompt || parsed.visual_prompt || parsed.prompt;
      const descripcion = parsed.descripcion || parsed.description || parsed.desc || parsed.caption || parsed.texto;

      if (!titulo || !titulo.trim()) throw new Error('Post sin titulo.');
      if (!imagePrompt || !imagePrompt.trim()) throw new Error('Post sin image_prompt.');
      if (!descripcion || !descripcion.trim()) throw new Error('Post sin descripcion.');

      logger.info('Post de imagen generado', { topic: parsed.topic, titulo, intento });

      return {
        topic: parsed.topic || titulo,
        titulo,
        descripcion,
        imagePrompt,
        category: chosenCategory,
        tags: buildTags(parsed.topic || titulo, chosenCategory, parsed.tags || [], profileName),
      };
    } catch (err) {
      ultimoError = err;
      const quedanIntentos = intento < MAX_INTENTOS;
      logger.warn(`Post de imagen mal formado en intento ${intento}/${MAX_INTENTOS}`, { error: err.message });
      if (quedanIntentos) {
        await sleep(delayReintentoGuion(intento));
      }
    }
  }
  throw new Error(`Agnes devolvio posts de imagen mal formados ${MAX_INTENTOS} veces. Ultimo error: ${ultimoError.message}`);
}

module.exports = { generateScript, generateImagePostScript, CATEGORIES, buildTags, buildTagsLargo, CONTENT_PROFILES, getProfile, parseAgnesJson, VIRAL_TAGS, TAGS_ALCANCE };
