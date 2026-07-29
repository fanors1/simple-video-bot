require('dotenv').config();
const fs = require('fs');
const http = require('http');
const { google } = require('googleapis');

/**
 * Script de UN SOLO USO. Lo corres una vez con:
 *   npm run setup:youtube
 * Abre tu navegador, inicias sesion con la cuenta de YouTube donde
 * quieres publicar, y guarda un token.json reutilizable (se auto-renueva
 * despues, no hay que repetir esto).
 *
 * Requiere que antes hayas descargado youtube-credentials.json desde
 * Google Cloud Console (OAuth client tipo "Desktop app").
 *
 * NOTA para GitHub Actions: corres esto UNA VEZ en tu maquina local para
 * generar youtube-token.json, y luego pegas el contenido de ese archivo
 * como el Secret YOUTUBE_TOKEN_JSON (y el de credentials como
 * YOUTUBE_CREDENTIALS_JSON). El workflow los reconstruye en cada corrida.
 */
const CREDENTIALS_PATH = process.env.YOUTUBE_CREDENTIALS_PATH || './youtube-credentials.json';
const TOKEN_PATH = process.env.YOUTUBE_TOKEN_PATH || './youtube-token.json';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const PORT = 53682;

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`No encuentro ${CREDENTIALS_PATH}.`);
    console.error('Descargalo desde Google Cloud Console > APIs y servicios > Credenciales > tu OAuth client > Download JSON.');
    process.exit(1);
  }

  const { client_id, client_secret } = JSON.parse(fs.readFileSync(CREDENTIALS_PATH)).installed;
  const redirectUri = `http://localhost:${PORT}/oauth2callback`;
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });

  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/oauth2callback')) return;

    const code = new URL(req.url, redirectUri).searchParams.get('code');
    res.end('Autenticacion completada. Ya puedes cerrar esta pestana y volver a la terminal.');
    server.close();

    const { tokens } = await oauth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log(`Listo. Token guardado en ${TOKEN_PATH}. No necesitas repetir este paso.`);
    process.exit(0);
  });

  server.listen(PORT, () => {
    console.log('Abriendo el navegador para iniciar sesion con tu cuenta de YouTube...');
    console.log(`Si no se abre solo, entra manualmente a:\n${authUrl}`);
    try {
      const open = require('open');
      open(authUrl);
    } catch {
      // 'open' es opcional; si no esta, el usuario copia la URL a mano.
    }
  });
}

main();
