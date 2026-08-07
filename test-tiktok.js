const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const ffmpegPath = require('ffmpeg-static');

const ZERNIO_URL = 'https://zernio.com/api/v1/posts';
const ZERNIO_ACCOUNTS = 'https://zernio.com/api/v1/accounts';
const CATBOX_URL = 'https://catbox.moe/user/api.php';

function log(msg, obj) {
  console.log('\n>>> ' + msg + (obj ? '\n' + JSON.stringify(obj, null, 2) : ''));
}

async function main() {
  const apiKey = process.env.ZERNIO_API_KEY;
  const zernioAccountId = process.env.ZERNIO_ACCOUNT_CURIOUS4D;

  log('PRUEBA DE TIKTOK', { hayApiKey: !!apiKey, hayAccountId: !!zernioAccountId, accountId: zernioAccountId });

  if (!apiKey || !zernioAccountId) {
    log('FALTA API KEY O ACCOUNT ID');
    process.exit(1);
  }

  log('PASO 1: Verificar que la API key funciona y ver las cuentas conectadas');
  try {
    const acc = await axios.get(ZERNIO_ACCOUNTS, { headers: { Authorization: `Bearer ${apiKey}` } });
    log('Cuentas conectadas en Zernio:', acc.data);
  } catch (err) {
    log('ERROR al listar cuentas', { status: err?.response?.status, data: err?.response?.data || err.message });
  }

  log('PASO 2: Generar video de prueba');
  const workDir = path.join(__dirname, 'output', 'test-tiktok');
  fs.mkdirSync(workDir, { recursive: true });
  const testVideo = path.join(workDir, 'test-vertical.mp4');
  execSync(
    `"${ffmpegPath}" -y -f lavfi -i "testsrc=size=720x1280:duration=5:rate=30" ` +
    `-f lavfi -i "sine=frequency=440:duration=5" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${testVideo}"`,
    { stdio: 'ignore' }
  );
  log('Video generado', { testVideo, size: fs.statSync(testVideo).size });

  log('PASO 3: Subir video a catbox.moe');
  let videoUrl;
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', fs.createReadStream(testVideo));
    const resp = await axios.post(CATBOX_URL, form, {
      headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 180000,
    });
    videoUrl = String(resp.data).trim();
    log('Video subido a catbox', { videoUrl });
  } catch (err) {
    log('ERROR al subir a catbox', { error: err.message });
    process.exit(1);
  }

  log('PASO 4: Verificar que la URL del video es accesible');
  try {
    const head = await axios.head(videoUrl, { timeout: 30000 });
    log('URL accesible', { status: head.status, contentType: head.headers['content-type'], contentLength: head.headers['content-length'] });
  } catch (err) {
    log('ERROR: la URL del video NO es accesible', { error: err.message });
  }

  log('PASO 5: Enviar a Zernio para publicar en TikTok');
  const body = {
    platforms: [{ platform: 'tiktok', accountId: zernioAccountId }],
    content: 'Prueba automatica',
    mediaItems: [{ type: 'video', url: videoUrl }],
    publishNow: true,
  };
  log('Body que se envia a Zernio:', body);
  try {
    const resp = await axios.post(ZERNIO_URL, body, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 120000,
    });
    log('EXITO! Zernio respondio:', resp.data);
  } catch (err) {
    log('ERROR DE ZERNIO (ESTE ES EL DETALLE QUE NECESITAMOS):', {
      status: err?.response?.status,
      data: err?.response?.data,
      message: err.message,
    });
  }
}

main().catch((err) => { log('FALLO GENERAL', { error: err.message }); process.exit(1); });
