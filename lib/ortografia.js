const logger = require('./logger');

// Correcciones de errores ortograficos comunes que Agnes comete en español.
// Clave: forma incorrecta (en minusculas) -> Valor: forma correcta.
// Se aplican como reemplazo de palabra completa (respetando mayusculas del
// original cuando la palabra viene toda en mayuscula, como en los titulares).
const CORRECCIONES = {
  // Errores vistos en produccion
  necita: 'necesita',
  puodieren: 'pudieran',
  puodieran: 'pudieran',
  pudieren: 'pudieran',
  // Palabras en ingles que Agnes a veces deja sueltas en titulos en español
  tail: 'cola',
  brain: 'cerebro',
  heart: 'corazón',
  blood: 'sangre',
  water: 'agua',
  fire: 'fuego',
  earth: 'tierra',
  world: 'mundo',
  human: 'humano',
  humans: 'humanos',
  body: 'cuerpo',
  ocean: 'océano',
  space: 'espacio',
  time: 'tiempo',
  light: 'luz',
  // Errores frecuentes de acentuacion/escritura que Agnes suele cometer
  oxigeno: 'oxígeno',
  atmosfera: 'atmósfera',
  oceano: 'océano',
  planeta: 'planeta',
  energia: 'energía',
  biologia: 'biología',
  cientificos: 'científicos',
  cientifico: 'científico',
  fisica: 'física',
  quimica: 'química',
  numero: 'número',
  ultimo: 'último',
  unico: 'único',
  arboles: 'árboles',
  arbol: 'árbol',
  celulas: 'células',
  celula: 'célula',
  aqui: 'aquí',
  asi: 'así',
  dia: 'día',
  dias: 'días',
  mas: 'más',
  facil: 'fácil',
  dificil: 'difícil',
  rapido: 'rápido',
  metodo: 'método',
  fenomeno: 'fenómeno',
  america: 'américa',
  oceanos: 'océanos',
};

/**
 * Corrige errores ortograficos comunes en un titular en español.
 * Preserva las mayusculas: si la palabra original estaba toda en mayusculas
 * (como en los titulares grandes), la correccion tambien va en mayusculas.
 *
 * @param {string} titulo
 * @returns {string} titulo corregido
 */
function corregirOrtografia(titulo) {
  if (!titulo) return titulo;

  let huboCorreccion = false;
  const corregido = titulo.replace(/[A-Za-zÁÉÍÓÚáéíóúÑñ]+/g, (palabra) => {
    const minus = quitarTildes(palabra.toLowerCase());
    const correccion = CORRECCIONES[minus];
    if (!correccion) return palabra;

    huboCorreccion = true;
    // Preservar el "case" del original
    if (palabra === palabra.toUpperCase()) return correccion.toUpperCase();
    if (palabra[0] === palabra[0].toUpperCase()) {
      return correccion.charAt(0).toUpperCase() + correccion.slice(1);
    }
    return correccion;
  });

  if (huboCorreccion) {
    logger.info('Ortografia del titular corregida', { antes: titulo, despues: corregido });
  }
  return corregido;
}

function quitarTildes(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

module.exports = { corregirOrtografia };
