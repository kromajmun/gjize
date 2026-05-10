# Gjize — Server (Railway)

Backend Express qui transforme une URL YouTube/Instagram en recette structurée.

## Prérequis local

```bash
brew install ffmpeg   # nécessaire pour le découpage audio et yt-dlp
```

(`yt-dlp` est bundlé avec `youtube-dl-exec` — pas besoin de l'installer séparément.)

## Démarrage

```bash
cd server
cp .env.example .env   # puis remplis les clés API
npm install
npm run dev            # mode watch
```

Healthcheck :

```bash
curl http://localhost:3000/health
```

## Test du pipeline

```bash
curl -X POST http://localhost:3000/import-recipe \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://www.youtube.com/watch?v=..."}'
```

Le pipeline :

1. Télécharge l'audio (mp3 mono 64kbps via yt-dlp + ffmpeg)
2. Si > 24 Mo, segmente en chunks de 10 min
3. Transcrit chaque chunk via Whisper (OpenAI)
4. Extrait la recette structurée via Claude Sonnet 4.6 (tool use)
5. Sauvegarde dans Supabase (si configuré) et renvoie le JSON

## Déploiement Railway

1. Pousser ce dossier sur GitHub
2. Sur Railway : `New Project` → `Deploy from GitHub repo` → choisir le repo
3. Configurer les variables d'environnement (cf `.env.example`)
4. Railway détecte `nixpacks.toml` et installe ffmpeg automatiquement

## Variables d'environnement

| Variable | Obligatoire | Source |
|----------|-------------|--------|
| `ANTHROPIC_API_KEY` | ✅ | console.anthropic.com → Settings → API Keys |
| `OPENAI_API_KEY` | ✅ | platform.openai.com → API Keys |
| `SUPABASE_URL` | ⚠️ | supabase.com → Project Settings → API |
| `SUPABASE_SERVICE_KEY` | ⚠️ | Idem (clé `service_role`) |
| `PORT` | — | Railway l'injecte automatiquement |

Sans Supabase, le serveur fonctionne quand même : les recettes sont extraites et renvoyées, mais pas sauvegardées.
