const https = require('https');
const logger = require('./logger');

const SEEDS = {
  curious4d: ['datos curiosos', 'curiosidades', 'sabias que', 'cosas que no sabias', 'datos increibles'],
  hipotesis4d: ['que pasaria si', 'que hubiera pasado si', 'historia alternativa', 'y si'],
  oscuro4d: ['historias de terror', 'leyendas de terror', 'casos paranormales', 'historias de miedo', 'relatos de terror'],
};

function consultarAutocomplete(query) {
  return new Promise((resolve) => {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=es&q=${encodeURIComponent(query)}`;
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(Array.isArray(parsed[1]) ? parsed[1] : []);
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

async function investigarKeywords(profileName, temaVideo = '') {
  const seeds = SEEDS[profileName] || SEEDS.curious4d;
  const consultas = [...seeds];
  if (temaVideo) consultas.unshift(temaVideo.toLowerCase().slice(0, 60));

  const todas = new Set();
  for (const seed of consultas.slice(0, 6)) {
    const sugerencias = await consultarAutocomplete(seed);
    for (const s of sugerencias) {
      const limpia = s.toLowerCase().trim();
      if (limpia && limpia.length <= 60) todas.add(limpia);
    }
    if (todas.size >= 40) break;
  }

  const lista = [...todas];
  logger.info('Keywords investigadas desde autocomplete de YouTube', { profile: profileName, encontradas: lista.length });
  return lista;
}

function elegirMejores(keywords, cantidad = 12) {
  const conMultiplesPalabras = keywords.filter((k) => k.split(/\s+/).length >= 3);
  const resto = keywords.filter((k) => k.split(/\s+/).length < 3);
  return [...conMultiplesPalabras, ...resto].slice(0, cantidad);
}

module.exports = { investigarKeywords, elegirMejores, consultarAutocomplete };
