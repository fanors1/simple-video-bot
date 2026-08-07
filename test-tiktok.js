const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const axios = require('axios');
const ffmpegPath = require('ffmpeg-static');

const BASE = 'https://zernio.com/api/v1';

function log(msg, obj) {
  console.log('\n>>> ' + msg + (obj ? '\n' + JSON.stringify(obj, null, 2) : ''));
}

async function main() {
  const apiKey = process.env.ZERNIO_API_KEY;
  const zernioAccountId = process.env.ZERNIO_ACCOUNT_CURIOUS4D;
  log('PRUEBA DE TIKTOK', { hayApiKey: !!apiKey, hayAccountId: !!zernioAccountId });
  if (!apiKey || !zernioAccountId) { log('FALTA API KEY O ACCOUNT ID'); process.exit(1); }

  log('PASO 1: Generar video de prueba');
  const workDir = path.join(__dirname, 'output', 'test-tiktok');
  fs.mkdirSync(workDir, { recursive: true });
  const testVideo = path.join(workDir, 'test-vertical.mp4');
  execSync(
    `"${ffmpegPath}" -y -f lavfi -i "testsrc=size=720x1280:duration=5:rate=30" ` +
    `-f lavfi -i "sine=frequency=440:duration=5" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${testVideo}"`,
    { stdio: 'ignore' }
  );
  log('Video generado', { size: fs.statSync(testVideo).size });

  log('PASO 2: Pedir URL de subida a Zernio (presign)');
  let uploadUrl, publicUrl;
  try {
    const presign = await axios.post(`${BASE}/media/presign`,
      { filename: 'test-vertical.mp4', contentType: 'video/mp4' },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 });
    uploadUrl = presign.data.uploadUrl;
    publicUrl = presign.data.publicUrl;
    log('Presign OK', { publicUrl, tieneUploadUrl: !!uploadUrl });
  } catch (err) {
    log('ERROR en presign', { status: err?.response?.status, data: err?.response?.data || err.message });
    process.exit(1);
  }

  log('PASO 3: Subir el video con PUT a la URL de Zernio');
  try {
    const fileBuffer = fs.readFileSync(testVideo);
    await axios.put(uploadUrl, fileBuffer, {
      headers: { 'Content-Type': 'video/mp4' }, maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 180000,
    });
    log('Video subido a Zernio OK');
  } catch (err) {
    log('ERROR al subir con PUT', { status: err?.response?.status, data: err?.response?.data || err.message });
    process.exit(1);
  }

  log('PASO 4: Crear el post en TikTok');
  const body = {
    content: 'Prueba automatica',
    mediaUrls: [publicUrl],
    platforms: [{ platform: 'tiktok', accountId: zernioAccountId }],
    publishNow: true,
  };
  log('Body:', body);
  try {
    const resp = await axios.post(`${BASE}/posts`, body, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 120000,
    });
    log('EXITO! Zernio respondio:', resp.data);
  } catch (err) {
    log('ERROR DE ZERNIO (EL DETALLE QUE NECESITAMOS):', {
      status: err?.response?.status, data: err?.response?.data, message: err.message,
    });
  }
}

main().catch((err) => { log('FALLO GENERAL', { error: err.message }); process.exit(1); });
