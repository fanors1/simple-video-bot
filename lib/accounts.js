const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Anclamos a la raiz del proyecto (un nivel arriba de lib/) para que la
// ruta funcione sin importar desde que carpeta se lanzo el proceso —
// importa tanto en Windows Task Scheduler como en GitHub Actions.
const ACCOUNTS_PATH = process.env.ACCOUNTS_PATH || path.join(__dirname, '..', 'accounts.json');

function loadAccount(accountName) {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    return {
      youtubeTokenPath: process.env.YOUTUBE_TOKEN_PATH || './youtube-token.json',
      facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
      facebookPageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
      instagramAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
      tiktokTokenPath: process.env.TIKTOK_TOKEN_PATH || './tiktok-token.json',
    };
  }

  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH));
  const name = accountName || Object.keys(accounts)[0];

  if (!accounts[name]) {
    throw new Error(`No encuentro la cuenta "${name}" en ${ACCOUNTS_PATH}. Cuentas disponibles: ${Object.keys(accounts).join(', ')}`);
  }

  logger.info('Usando cuenta', { account: name });
  return accounts[name];
}

module.exports = { loadAccount };
