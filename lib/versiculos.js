const VERSICULOS = [
  { texto: 'Todo lo puedo en Cristo que me fortalece.', cita: 'Filipenses 4:13', tema: 'fortaleza', deJesus: false },
  { texto: 'Jehova es mi pastor; nada me faltara.', cita: 'Salmos 23:1', tema: 'confianza', deJesus: false },
  { texto: 'Mira que te mando que te esfuerces y seas valiente; no temas ni desmayes, porque Jehova tu Dios estara contigo dondequiera que vayas.', cita: 'Josue 1:9', tema: 'valentia', deJesus: false },
  { texto: 'Y sabemos que a los que aman a Dios, todas las cosas les ayudan a bien.', cita: 'Romanos 8:28', tema: 'esperanza', deJesus: false },
  { texto: 'Echa sobre Jehova tu carga, y el te sustentara; no dejara para siempre caido al justo.', cita: 'Salmos 55:22', tema: 'descanso', deJesus: false },
  { texto: 'No se turbe vuestro corazon; creeis en Dios, creed tambien en mi.', cita: 'Juan 14:1', tema: 'paz', deJesus: true },
  { texto: 'El sana a los quebrantados de corazon, y venda sus heridas.', cita: 'Salmos 147:3', tema: 'consuelo', deJesus: false },
  { texto: 'Venid a mi todos los que estais trabajados y cargados, y yo os hare descansar.', cita: 'Mateo 11:28', tema: 'descanso', deJesus: true },
  { texto: 'Porque yo se los pensamientos que tengo acerca de vosotros, pensamientos de paz, y no de mal, para daros el fin que esperais.', cita: 'Jeremias 29:11', tema: 'esperanza', deJesus: false },
  { texto: 'La paz os dejo, mi paz os doy; yo no os la doy como el mundo la da. No se turbe vuestro corazon, ni tenga miedo.', cita: 'Juan 14:27', tema: 'paz', deJesus: true },
  { texto: 'Bienaventurados los que lloran, porque ellos recibiran consolacion.', cita: 'Mateo 5:4', tema: 'consuelo', deJesus: true },
  { texto: 'El da esfuerzo al cansado, y multiplica las fuerzas al que no tiene ningunas.', cita: 'Isaias 40:29', tema: 'fortaleza', deJesus: false },
  { texto: 'Pero los que esperan a Jehova tendran nuevas fuerzas; levantaran alas como las aguilas; correran, y no se cansaran; caminaran, y no se fatigaran.', cita: 'Isaias 40:31', tema: 'esperanza', deJesus: false },
  { texto: 'Aunque ande en valle de sombra de muerte, no temere mal alguno, porque tu estaras conmigo; tu vara y tu cayado me infundiran aliento.', cita: 'Salmos 23:4', tema: 'valentia', deJesus: false },
  { texto: 'Clama a mi, y yo te respondere, y te ensenare cosas grandes y ocultas que tu no conoces.', cita: 'Jeremias 33:3', tema: 'fe', deJesus: false },
  { texto: 'No os ha sobrevenido ninguna tentacion que no sea humana; pero fiel es Dios, que no os dejara ser tentados mas de lo que podeis resistir.', cita: '1 Corintios 10:13', tema: 'fortaleza', deJesus: false },
  { texto: 'Encomienda a Jehova tu camino, y confia en el; y el hara.', cita: 'Salmos 37:5', tema: 'confianza', deJesus: false },
  { texto: 'No temas, porque yo estoy contigo; no desmayes, porque yo soy tu Dios que te esfuerzo; siempre te ayudare, siempre te sustentare con la diestra de mi justicia.', cita: 'Isaias 41:10', tema: 'valentia', deJesus: false },
  { texto: 'El que habita al abrigo del Altisimo morara bajo la sombra del Omnipotente.', cita: 'Salmos 91:1', tema: 'proteccion', deJesus: false },
  { texto: 'Porque nada hay imposible para Dios.', cita: 'Lucas 1:37', tema: 'fe', deJesus: false },
  { texto: 'Mas buscad primeramente el reino de Dios y su justicia, y todas estas cosas os seran anadidas.', cita: 'Mateo 6:33', tema: 'confianza', deJesus: true },
  { texto: 'Este es el dia que hizo Jehova; nos gozaremos y alegraremos en el.', cita: 'Salmos 118:24', tema: 'gozo', deJesus: false },
  { texto: 'El amor es sufrido, es benigno; el amor no tiene envidia, el amor no es jactancioso, no se envanece.', cita: '1 Corintios 13:4', tema: 'amor', deJesus: false },
  { texto: 'Y conocereis la verdad, y la verdad os hara libres.', cita: 'Juan 8:32', tema: 'fe', deJesus: true },
  { texto: 'Cercano esta Jehova a los quebrantados de corazon; y salva a los contritos de espiritu.', cita: 'Salmos 34:18', tema: 'consuelo', deJesus: false },
  { texto: 'Asi que, no os afaneis por el dia de manana, porque el dia de manana traera su afan. Basta a cada dia su propio mal.', cita: 'Mateo 6:34', tema: 'paz', deJesus: true },
  { texto: 'Aguarda a Jehova; esfuerzate, y alientese tu corazon; si, espera a Jehova.', cita: 'Salmos 27:14', tema: 'esperanza', deJesus: false },
  { texto: 'Lampara es a mis pies tu palabra, y lumbrera a mi camino.', cita: 'Salmos 119:105', tema: 'guia', deJesus: false },
  { texto: 'Gustad, y ved que es bueno Jehova; dichoso el hombre que confia en el.', cita: 'Salmos 34:8', tema: 'confianza', deJesus: false },
  { texto: 'Fiate de Jehova de todo tu corazon, y no te apoyes en tu propia prudencia.', cita: 'Proverbios 3:5', tema: 'confianza', deJesus: false },
  { texto: 'Reconocelo en todos tus caminos, y el enderezara tus veredas.', cita: 'Proverbios 3:6', tema: 'guia', deJesus: false },
  { texto: 'Jehova peleara por vosotros, y vosotros estareis tranquilos.', cita: 'Exodo 14:14', tema: 'paz', deJesus: false },
  { texto: 'Esforzaos y cobrad animo; no temais, ni tengais miedo de ellos, porque Jehova tu Dios es el que va contigo; no te dejara, ni te desamparara.', cita: 'Deuteronomio 31:6', tema: 'valentia', deJesus: false },
  { texto: 'Por nada esteis afanosos, sino sean conocidas vuestras peticiones delante de Dios en toda oracion y ruego, con accion de gracias.', cita: 'Filipenses 4:6', tema: 'paz', deJesus: false },
  { texto: 'Y la paz de Dios, que sobrepasa todo entendimiento, guardara vuestros corazones y vuestros pensamientos en Cristo Jesus.', cita: 'Filipenses 4:7', tema: 'paz', deJesus: false },
  { texto: 'Echando toda vuestra ansiedad sobre el, porque el tiene cuidado de vosotros.', cita: '1 Pedro 5:7', tema: 'descanso', deJesus: false },
  { texto: 'Yo soy la luz del mundo; el que me sigue, no andara en tinieblas, sino que tendra la luz de la vida.', cita: 'Juan 8:12', tema: 'luz', deJesus: true },
  { texto: 'Yo soy el camino, y la verdad, y la vida; nadie viene al Padre, sino por mi.', cita: 'Juan 14:6', tema: 'fe', deJesus: true },
  { texto: 'Pedid, y se os dara; buscad, y hallareis; llamad, y se os abrira.', cita: 'Mateo 7:7', tema: 'fe', deJesus: true },
  { texto: 'Porque de tal manera amo Dios al mundo, que ha dado a su Hijo unigenito, para que todo aquel que en el cree, no se pierda, mas tenga vida eterna.', cita: 'Juan 3:16', tema: 'amor', deJesus: false },
  { texto: 'El Senor es mi luz y mi salvacion; de quien temere? El Senor es la fortaleza de mi vida; de quien he de atemorizarme?', cita: 'Salmos 27:1', tema: 'valentia', deJesus: false },
  { texto: 'Bendice, alma mia, a Jehova, y no olvides ninguno de sus beneficios.', cita: 'Salmos 103:2', tema: 'gratitud', deJesus: false },
  { texto: 'Deleitate asimismo en Jehova, y el te concedera las peticiones de tu corazon.', cita: 'Salmos 37:4', tema: 'gozo', deJesus: false },
  { texto: 'Mejor es refugiarse en Jehova que confiar en el hombre.', cita: 'Salmos 118:8', tema: 'confianza', deJesus: false },
  { texto: 'Jehova es mi fortaleza y mi escudo; en el confio mi corazon, y fui ayudado.', cita: 'Salmos 28:7', tema: 'proteccion', deJesus: false },
  { texto: 'De cierto, de cierto os digo, que el que oye mi palabra, y cree al que me envio, tiene vida eterna.', cita: 'Juan 5:24', tema: 'fe', deJesus: true },
  { texto: 'Venid a mi, y el alma vuestra hallara descanso, porque mi yugo es facil, y ligera mi carga.', cita: 'Mateo 11:29', tema: 'descanso', deJesus: true },
  { texto: 'El que mora en el amor, mora en Dios, y Dios en el.', cita: '1 Juan 4:16', tema: 'amor', deJesus: false },
  { texto: 'Por tanto, no desmayamos; antes aunque este nuestro hombre exterior se va desgastando, el interior no obstante se renueva de dia en dia.', cita: '2 Corintios 4:16', tema: 'fortaleza', deJesus: false },
  { texto: 'Es, pues, la fe la certeza de lo que se espera, la conviccion de lo que no se ve.', cita: 'Hebreos 11:1', tema: 'fe', deJesus: false },
  { texto: 'Nunca te dejare, ni te desamparare.', cita: 'Hebreos 13:5', tema: 'proteccion', deJesus: false },
  { texto: 'Alzare mis ojos a los montes; de donde vendra mi socorro? Mi socorro viene de Jehova, que hizo los cielos y la tierra.', cita: 'Salmos 121:1', tema: 'esperanza', deJesus: false },
  { texto: 'He aqui yo estoy con vosotros todos los dias, hasta el fin del mundo.', cita: 'Mateo 28:20', tema: 'proteccion', deJesus: true },
  { texto: 'El da poder al debil, y al que no tiene vigor, aumenta las fuerzas.', cita: 'Isaias 40:29', tema: 'fortaleza', deJesus: false },
  { texto: 'Cantare de la misericordia de Jehova perpetuamente.', cita: 'Salmos 89:1', tema: 'gratitud', deJesus: false },
  { texto: 'En paz me acostare, y asimismo dormire; porque solo tu, Jehova, me haces vivir confiado.', cita: 'Salmos 4:8', tema: 'descanso', deJesus: false },
  { texto: 'Espera en Jehova, y guarda su camino, y el te exaltara para heredar la tierra.', cita: 'Salmos 37:34', tema: 'esperanza', deJesus: false },
  { texto: 'El corazon alegre constituye buen remedio; mas el espiritu triste seca los huesos.', cita: 'Proverbios 17:22', tema: 'gozo', deJesus: false },
  { texto: 'Jehova cumplira su proposito en mi; tu misericordia, oh Jehova, es para siempre.', cita: 'Salmos 138:8', tema: 'proposito', deJesus: false },
  { texto: 'Y el mismo Senor de paz os de siempre paz en toda manera.', cita: '2 Tesalonicenses 3:16', tema: 'paz', deJesus: false },
];

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function rutaHistorialVersiculos(canal) {
  return path.join(DATA_DIR, `historial-versiculos-${canal}.json`);
}

function leerHistorialVersiculos(canal) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaHistorialVersiculos(canal), 'utf8'));
    return Array.isArray(data.citas) ? data.citas : [];
  } catch {
    return [];
  }
}

function guardarVersiculoUsado(canal, cita, maximo = 30) {
  try {
    const previos = leerHistorialVersiculos(canal);
    const nuevos = [cita, ...previos.filter((c) => c !== cita)].slice(0, maximo);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(rutaHistorialVersiculos(canal), JSON.stringify({ citas: nuevos, actualizado: new Date().toISOString() }, null, 2));
  } catch (e) {
  }
}

function elegirVersiculo(historial = []) {
  const usadas = new Set(historial);
  const disponibles = VERSICULOS.filter((v) => !usadas.has(v.cita));
  const pool = disponibles.length > 0 ? disponibles : VERSICULOS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function versiculosParaIntro(cantidad = 12) {
  const barajado = [...VERSICULOS].sort(() => Math.random() - 0.5);
  return barajado.slice(0, cantidad).map((v) => v.cita);
}

module.exports = { VERSICULOS, elegirVersiculo, versiculosParaIntro, leerHistorialVersiculos, guardarVersiculoUsado };
