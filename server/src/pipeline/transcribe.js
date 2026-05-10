import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_ATTEMPTS = 3;

/**
 * Transcrit un ou plusieurs fichiers audio via Whisper.
 *
 * On utilise le `fetch` natif de Node 20 (undici) plutôt que le SDK OpenAI :
 * en pratique le SDK retombe sur node-fetch en interne et son upload
 * multipart se fait couper (ECONNRESET) sur certains réseaux. Undici
 * gère mieux les uploads multipart sur connexions instables.
 *
 * @param {string[]} audioFiles
 * @param {string} [language='fr']
 * @returns {Promise<string>}
 */
export async function transcribeAudio(audioFiles, language = 'fr') {
  if (!audioFiles || audioFiles.length === 0) {
    throw new Error('Aucun fichier audio à transcrire.');
  }

  const transcriptions = await Promise.all(
    audioFiles.map((filePath) => transcribeOne(filePath, language)),
  );
  return transcriptions.join('\n').trim();
}

async function transcribeOne(filePath, language) {
  const { size } = await stat(filePath);
  console.log(`[transcribe] ${path.basename(filePath)} : ${(size / 1024).toFixed(1)} Ko`);

  if (size < 1024) {
    throw new Error(
      `Fichier audio trop petit (${size} octets) — yt-dlp a probablement échoué silencieusement. ` +
        `La vidéo n'a peut-être pas de piste audio extractible.`,
    );
  }
  if (size > 25 * 1024 * 1024) {
    throw new Error(
      `Fichier audio trop gros (${(size / 1024 / 1024).toFixed(1)} Mo, max 25). ` +
        `Le découpage en chunks a échoué.`,
    );
  }

  const buffer = await readFile(filePath);
  const filename = path.basename(filePath);

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: 'audio/mpeg' }), filename);
      form.append('model', config.whisperModel);
      form.append('language', language);
      form.append('response_format', 'text');

      const response = await fetch(WHISPER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.openaiApiKey}` },
        body: form,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Whisper API ${response.status} : ${text || response.statusText}`);
      }
      return await response.text();
    } catch (err) {
      lastErr = err;
      const code = err.cause?.code ?? err.code;
      const retryable = code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'ETIMEDOUT';
      if (attempt < MAX_ATTEMPTS && retryable) {
        const wait = 1000 * 2 ** (attempt - 1);
        console.warn(
          `[transcribe] tentative ${attempt}/${MAX_ATTEMPTS} échouée (${code ?? err.message}), retry dans ${wait}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
