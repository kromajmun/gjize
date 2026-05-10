import 'dotenv/config';

const required = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
];

const optional = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `\n[config] Variables d'environnement manquantes : ${missing.join(', ')}\n` +
      `Copie server/.env.example vers server/.env et remplis-les.\n`,
  );
  process.exit(1);
}

const missingOptional = optional.filter((key) => !process.env[key]);
if (missingOptional.length > 0) {
  console.warn(
    `[config] Variables Supabase non définies (${missingOptional.join(', ')}). ` +
      `La persistance DB sera désactivée — l'extraction marche, mais les recettes ne seront pas sauvegardées.`,
  );
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    enabled: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
  },
  anthropicModel: 'claude-sonnet-4-6',
  whisperModel: 'whisper-1',
};
