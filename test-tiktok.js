const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const logger = require('./lib/logger');
const { publishVideo } = require('./lib/tiktok');

async function main() {
  const apiKey = process.env.ZERNIO_API_KEY;
  const zernioAccountId = process.env.ZERNIO_ACCOUNT_CURIOUS4D;

  logger.info('=== PRUEBA DE TIKTOK (solo Zernio) ===', {
    hayApiKey: !!apiKey,
    hayAccountId: !!zernioAccountId,
  });

  if (!apiKey || !zernioAccountId) {
    logger.error('Falta ZERNIO_API_KEY o ZERNIO_ACCOUNT_CURIOUS4D en el entorno');
    process.exit(1);
  }

  const workDir = path.join(__dirname, 'output', 'test-tiktok');
  fs.mkdirSync(workDir, { recursive: true });
  const testVideo = path.join(workDir, 'test-vertical.mp4');

  logger.info('Generando video de prueba vertical 9:16 de 5 segundos');
  execSync(
    `"${ffmpegPath}" -y -f lavfi -i "testsrc=size=720x1280:duration=5:rate=30" ` +
    `-f lavfi -i "sine=frequency=440:duration=5" ` +
    `-c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${testVideo}"`,
    { stdio: 'ignore' }
  );
  logger.info('Video de prueba listo', { testVideo });

  const resultado = await publishVideo({
    localPath: testVideo,
    title: 'Prueba de publicacion automatica #test',
    zernioAccountId,
    apiKey,
  });

  logger.info('=== RESULTADO DE LA PRUEBA ===', { resultado: JSON.stringify(resultado) });
}

main().catch((err) => {
  logger.error('La prueba de TikTok fallo', { error: err.message });
  process.exit(1);
});
