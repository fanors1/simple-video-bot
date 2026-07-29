# simple-video-bot

Sistema automatico de contenido para **Curious4D** e **Hipotesis4D**. Genera y publica 3 formatos en YouTube, Facebook e Instagram (TikTok pendiente de API):

- **Reels** (video de 7 segmentos) -> YouTube + Facebook + Instagram
- **Historias** (video corto) -> Facebook + Instagram Stories
- **Posts de imagen** (foto impactante + titular) -> Facebook + Instagram feed

Cada corrida procesa AMBOS canales. Contenido diferenciado por nicho, con historial anti-repeticion, hashtags virales y correccion de ortografia.

## Cadencia diaria (20 piezas/dia = 10 corridas x 2 canales)

| Hora CO | Contenido | Workflow |
|---------|-----------|----------|
| 6:00am  | Historia #1 | stories.yml |
| 7:30am  | Reel #1 | reels.yml |
| 9:30am  | Imagen #1 | image-posts.yml |
| 11:30am | Reel #2 | reels.yml |
| 1:30pm  | Reel #3 | reels.yml |
| 3:00pm  | Historia #2 | stories.yml |
| 4:30pm  | Reel #4 | reels.yml |
| 6:00pm  | Imagen #2 | image-posts.yml |
| 7:30pm  | Reel #5 | reels.yml |
| 9:00pm  | Reel #6 | reels.yml |

## Despliegue en GitHub Actions

### 1. Secrets (Settings -> Secrets and variables -> Actions -> New repository secret)

| Secret | Contenido |
|--------|-----------|
| `ACCOUNTS_JSON` | Todo el contenido de tu accounts.json (con los tokens) |
| `AGNES_API_KEY` | Tu clave de Agnes AI |
| `YOUTUBE_CREDENTIALS_JSON` | Contenido de youtube-credentials.json |
| `YOUTUBE_TOKEN_JSON` | Contenido de youtube-token.json (Curious4D) |
| `YOUTUBE_TOKEN_CANAL2_JSON` | Contenido de accounts/canal2/youtube-token.json (Hipotesis4D) |

### 2. Variable (pestaña Variables)
- `DRY_RUN` = `true` para las primeras pruebas en la nube; cambiar a `false` cuando todo funcione.

### 3. Probar
Actions -> elige un workflow -> Run workflow (con DRY_RUN en true primero).

## Anti-repeticion (historial)
Cada canal guarda sus temas en `data/historial-<canal>.json`. Los workflows commitean el historial de vuelta al repo tras cada corrida, para que persista entre ejecuciones y no se repita contenido.

## Uso local
1. `npm install`
2. Copiar `.env.example` a `.env` y `accounts.example.json` a `accounts.json`, rellenar.
3. Probar: `DRY_RUN=true node generate-random.js` (o generate-story.js / generate-image-post.js)

## Datos no secretos
- Curious4D Page ID: 1193866613810828
- Hipotesis4D Page ID: 1220213537839259
- Meta App ID: 2780399452339019
