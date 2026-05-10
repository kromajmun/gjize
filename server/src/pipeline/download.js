import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import youtubeDlExec from 'youtube-dl-exec';
import { getCookiesPath, invalidateCookiesCache } from '../db/supabase.js';

const execAsync = promisify(exec);

// Patterns d'erreur yt-dlp qui signalent un besoin d'auth / cookies, par plateforme.
// On les détecte pour invalider le cache et remonter un message actionnable à l'utilisateur.
const AUTH_ERROR_PATTERNS = {
  instagram: [
    /rate-?limit reached or login required/i,
    /login required/i,
    /requested content is not available/i,
    /this content isn't available/i,
  ],
  youtube: [
    /sign in to confirm (you'?re|that you are) not a bot/i,
    /confirm you'?re not a bot/i,
    /this video is unavailable/i, // souvent corrélé au bot check côté Railway
    /use --cookies/i, // yt-dlp suggère lui-même de fournir des cookies
  ],
};

function isAuthError(platform, message) {
  const patterns = AUTH_ERROR_PATTERNS[platform] ?? [];
  return patterns.some((re) => re.test(message ?? ''));
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

  // Cookies depuis Supabase Storage :
  // - Instagram : obligatoires (yt-dlp échoue d'office sans).
  // - YouTube : optionnels mais utilisés si présents — depuis Railway, YouTube
  //   bloque souvent avec "Sign in to confirm you're not a bot" sur IP datacenter.
  //   Si l'utilisateur a uploadé youtube_cookies.txt, on l'injecte d'emblée.
  let cookiesPath = await getCookiesPath(platform);
  if (platform === 'instagram' && !cookiesPath) {
    await cleanup();
    throw new Error(
      "Instagram nécessite des cookies d'authentification. Upload un fichier instagram_cookies.txt (format Netscape) dans Supabase Storage > bucket secrets.",
    );
  }

  const baseOpts = {
    noWarnings: true,
    noCheckCertificates: true,
    ...(cookiesPath ? { cookies: cookiesPath } : {}),
    // YouTube renvoie des listes de formats différentes selon le client
    // simulé. La majorité des imports étant des Shorts, on commence par
    // `mweb` (mobile web) qui expose l'audio des Shorts de façon fiable —
    // `default` et `web_safari` servent de fallback pour les vidéos longues.
    ...(platform === 'youtube'
      ? { extractorArgs: 'youtube:player_client=mweb,default,web_safari' }
      : {}),
  };

  let metadata = {};
  try {
    const info = await youtubeDlExec(url, {
      ...baseOpts,
      dumpSingleJson: true,
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
      // Sélecteur explicite avec fallback : `bestaudio*` couvre audio-only
      // ET muxed-with-audio (utile sur Shorts où l'audio-only pur n'existe
      // parfois pas). Évite "Requested format is not available" quand le
      // défaut implicite (`bestaudio/best`) ne matche rien.
      format: 'bestaudio*/best',
      postprocessorArgs: 'ffmpeg:-ac 1 -ar 16000 -b:a 64k', // mono, 16kHz, 64kbps
    });
  } catch (err) {
    await cleanup();
    const errMsg = err.message ?? err.stderr ?? '';
    // Si yt-dlp signale un problème d'auth, on invalide le cache pour qu'au
    // prochain essai on retéléchargera les cookies depuis Storage (au cas où
    // l'utilisateur vient de les rotater).
    if (isAuthError(platform, errMsg)) {
      invalidateCookiesCache(platform);
      if (platform === 'instagram') {
        throw new Error(
          'Cookies Instagram expirés ou invalides. Va dans Supabase Dashboard > Storage > secrets > instagram_cookies.txt et remplace le fichier (export Netscape depuis Chrome avec ton compte dédié).',
        );
      }
      if (platform === 'youtube') {
        const action = cookiesPath
          ? 'remplace le fichier (export Netscape depuis Chrome avec un compte YouTube — idéalement dédié)'
          : 'upload un fichier youtube_cookies.txt (format Netscape, export depuis Chrome avec un compte YouTube — idéalement dédié)';
        throw new Error(
          `YouTube demande une vérification "I'm not a bot" (typique sur IP Railway). Va dans Supabase Dashboard > Storage > secrets et ${action}.`,
        );
      }
    }
    if (platform === 'instagram') {
      throw new Error(
        `Échec du téléchargement Instagram. Cette URL est peut-être privée ou inaccessible. Détail : ${errMsg}`,
      );
    }
    throw new Error(`Échec du téléchargement (${platform}) : ${errMsg}`);
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
