import express from 'express';
import { config } from './config.js';
import { importRouter } from './routes/import.js';
import { recipesRouter } from './routes/recipes.js';

const app = express();

// CORS permissif pour la V1 — l'app Expo (web et natif) appelle le serveur
// directement. À durcir quand on aura un domaine en prod.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    model: config.anthropicModel,
    whisper: config.whisperModel,
    supabase_enabled: config.supabase.enabled,
  });
});

app.use(importRouter);
app.use(recipesRouter);

app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Erreur serveur inattendue.' });
});

app.listen(config.port, () => {
  console.log(`[gjize] serveur démarré sur http://localhost:${config.port}`);
  console.log(`[gjize] healthcheck : GET /health`);
  console.log(`[gjize] import : POST /import-recipe { "url": "..." }`);
});
