import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import youtubeDlExec from 'youtube-dl-exec';
import { getInstagramCookiesPath, invalidateInstagramCookiesCache } from '../db/supabase.js';

const execAsync = promisify(exec);

// Patterns d'erreur yt-dlp qui signalent que les cookies sont expirés / absents.
// Détectés sur Instagram principalement — on remonte un message actionnable.
const AUTH_ERROR_PATTERNS = [
  /rate-?limit reached or login required/i,
  /login required/i,
  /requested content is not available/i,
  /this content isn't available/i,
];

function isInstagramAuthError(message) {
  return AUTH_ERROR_PATTERNS.some((re) => re.test(message ?? ''));
}

const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 24 Mo de marge sous la limite 25 Mo de Whisper
const SEGMENT_SECONDS = 600; // 10 min par segment si chunking nécessaire

export function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('instagram.com')) return 'instagram';
  return 'unknown';
}

/**
 * Télécharge l'audio d'une vidéo et le retourne en mp3 mono 64kbps.
 * Si le fichier dépasse 24 Mo, segmente en chunks de 10 min via ffmpeg.
 *
 * @returns {Promise<{
 *   audioFiles: string[],
 *   metadata: { title?: string, description?: string, thumbnailUrl?: string, durationSeconds?: number },
 *   workDir: string,
 *   cleanup: () => Promise<void>
 * }>}
 */
export async function downloadAudio(url) {
  const platform = detectPlatform(url);
  if (platform === 'unknown') {
    throw new Error(`URL non supportée. Plateformes acceptées : YouTube, Instagram. Reçu : ${url}`);
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'gjize-'));
  const audioPath = path.join(workDir, 'audio.mp3');

  const cleanup = () => rm(workDir, { recursive: true, force: true });

  // Pour Instagram, on injecte les cookies depuis Supabase Storage si dispo —
  // sinon yt-dlp retournera "rate-limit reached or login required" et on
  // remontera un message explicite pour rotater les cookies.
  let cookiesPath = null;
  if (platform === 'instagram') {
    cookiesPath = await getInstagramCookiesPath();
    if (!cookiesPath) {
      await cleanup();
      throw new Error(
        "Instagram nécessite des cookies d'authentification. Upload un fichier instagram_cookies.txt (format Netscape) dans Supabase Storage > bucket secrets.",
      );
    }
  }

  const baseOpts = {
    noWarnings: true,
    noCheckCertificates: true,
    ...(cookiesPath ? { cookies: cookiesPath } : {}),
  };

  let metadata = {};
  try {
    const info = await youtubeDlExec(url, {
      ...baseOpts,
      dumpSingleJson: true,
      preferFreeFormats: true,
    });
    metadata = {
      title: info.title,
      description: info.description,
      thumbnailUrl: info.thumbnail,
      durationSeconds: info.duration,
    };

    await youtubeDlExec(url, {
      ...baseOpts,
      output: audioPath,
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 5, // qualité moyenne, suffisant pour Whisper
      postprocessorArgs: 'ffmpeg:-ac 1 -ar 16000 -b:a 64k', // mono, 16kHz, 64kbps
    });
  } catch (err) {
    await cleanup();
    if (platform === 'instagram') {
      // Si yt-dlp signale un problème d'auth, on invalide le cache pour qu'au
      // prochain essai on retéléchargera les cookies depuis Storage (au cas où
      // l'utilisateur vient de les rotater).
      if (isInstagramAuthError(err.message ?? err.stderr)) {
        invalidateInstagramCookiesCache();
        throw new Error(
          'Cookies Instagram expirés ou invalides. Va dans Supabase Dashboard > Storage > secrets > instagram_cookies.txt et remplace le fichier (export Netscape depuis Chrome avec ton compte dédié).',
        );
      }
      throw new Error(
        `Échec du téléchargement Instagram. Cette URL est peut-être privée ou inaccessible. Détail : ${err.message}`,
      );
    }
    throw new Error(`Échec du téléchargement (${platform}) : ${err.message}`);
  }

  const { size } = await stat(audioPath);
  if (size <= WHISPER_MAX_BYTES) {
    return { audioFiles: [audioPath], metadata, workDir, cleanup };
  }

  // Chunking : ffmpeg -f segment
  const segmentPattern = path.join(workDir, 'chunk_%03d.mp3');
  await execAsync(
    `ffmpeg -i "${audioPath}" -f segment -segment_time ${SEGMENT_SECONDS} -c copy "${segmentPattern}" -y -loglevel error`,
  );

  const files = await readdir(workDir);
  const chunks = files
    .filter((f) => f.startsWith('chunk_') && f.endsWith('.mp3'))
    .sort()
    .map((f) => path.join(workDir, f));

  if (chunks.length === 0) {
    await cleanup();
    throw new Error('Le découpage audio a échoué (aucun chunk généré).');
  }

  return { audioFiles: chunks, metadata, workDir, cleanup };
}
