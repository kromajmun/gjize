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
    // "Requested format is not available" sur IP datacenter sans cookies frais :
    // YouTube ne renvoie aucun format exploitable (SABR + PO Token forcés).
    // Traité comme un signal cookies dans la même logique d'invalidation /
    // message actionnable, même si techniquement c'est une étape d'après.
    /requested format is not available/i,
  ],
};

// yt-dlp a bien téléchargé un fichier, mais ffprobe n'y trouve aucune piste
// audio : format video-only sélectionné, vidéo muette, ou post photo/carrousel.
// Rien à voir avec un problème d'accès — on ne veut pas envoyer l'utilisateur
// sur la fausse piste des cookies.
const NO_AUDIO_PATTERN = /unable to obtain file audio codec/i;

// Aucun format vidéo du tout : post photo ou carrousel d'images. Même issue que
// NO_AUDIO (import sur la description), mais inutile de retenter le
// téléchargement : il n'y a rien à récupérer.
const NO_MEDIA_PATTERN = /no video formats found|there'?s no video in this post|no media found/i;

function isAuthError(platform, message) {
  const patterns = AUTH_ERROR_PATTERNS[platform] ?? [];
  return patterns.some((re) => re.test(message ?? ''));
}

/**
 * Traduit une erreur yt-dlp en message actionnable pour l'utilisateur.
 * Effet de bord assumé : invalide le cache cookies quand l'erreur en signale
 * l'expiration, pour que le prochain essai les retélécharge depuis Storage.
 */
function buildDownloadError(platform, cookiesPath, errMsg) {
  if (isAuthError(platform, errMsg)) {
    invalidateCookiesCache(platform);
    if (platform === 'instagram') {
      return new Error(
        'Cookies Instagram expirés ou invalides. Va dans Supabase Dashboard > Storage > secrets > instagram_cookies.txt et remplace le fichier (export Netscape depuis Chrome avec ton compte dédié).',
      );
    }
    if (platform === 'youtube') {
      const action = cookiesPath
        ? 'remplace le fichier (export Netscape depuis Chrome avec un compte YouTube — idéalement dédié)'
        : 'upload un fichier youtube_cookies.txt (format Netscape, export depuis Chrome avec un compte YouTube — idéalement dédié)';
      return new Error(
        `YouTube demande une vérification "I'm not a bot" (typique sur IP Railway). Va dans Supabase Dashboard > Storage > secrets et ${action}.`,
      );
    }
  }
  if (platform === 'instagram') {
    return new Error(
      `Échec du téléchargement Instagram. Cette URL est peut-être privée ou inaccessible. Détail : ${errMsg}`,
    );
  }
  return new Error(`Échec du téléchargement (${platform}) : ${errMsg}`);
}

/**
 * Demande à ffprobe si le fichier contient au moins une piste audio.
 * Sortie vide (ou ffprobe en erreur) = pas d'audio.
 */
async function hasAudioStream(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${filePath}"`,
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Deuxième chance après "unable to obtain file audio codec".
 *
 * Le sélecteur `bestaudio` → `bestaudio*` → `best` s'arrête au PREMIER cran
 * qui matche :
 * si `bestaudio` attrape un rendu video-only (codecs `unknown`, fréquent sur
 * Instagram), yt-dlp télécharge celui-là et échoue — il ne retombe jamais sur
 * `best`. On refait donc le tour avec le média complet muxé, et c'est ffprobe
 * qui tranche : piste audio présente → on l'extrait nous-mêmes ; aucune →
 * le média est réellement muet (photo, carrousel, vidéo sans son).
 *
 * @returns {Promise<string|null>} chemin du mp3 extrait, ou null si média muet
 */
async function retryViaFullMedia(url, baseOpts, workDir, audioPath) {
  await youtubeDlExec(url, {
    ...baseOpts,
    output: path.join(workDir, 'media.%(ext)s'),
    format: 'best',
  });

  const media = (await readdir(workDir)).find((f) => f.startsWith('media.'));
  if (!media) return null;

  const mediaPath = path.join(workDir, media);
  if (!(await hasAudioStream(mediaPath))) return null;

  // Mêmes paramètres que le postprocessor yt-dlp : mono 16 kHz 64 kbps.
  await execAsync(
    `ffmpeg -i "${mediaPath}" -vn -ac 1 -ar 16000 -b:a 64k "${audioPath}" -y -loglevel error`,
  );
  return audioPath;
}

const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 24 Mo de marge sous la limite 25 Mo de Whisper
const SEGMENT_SECONDS = 600; // 10 min par segment si chunking nécessaire

export function detectPlatform(url) {
  const u = (url ?? '').toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('instagram.com')) return 'instagram';
  // Tout autre lien http(s) → import "web" (scraping JSON-LD schema.org/Recipe).
  if (u.startsWith('http://') || u.startsWith('https://')) return 'web';
  return 'unknown';
}

/**
 * Télécharge l'audio d'une vidéo et le retourne en mp3 mono 64kbps.
 * Si le fichier dépasse 24 Mo, segmente en chunks de 10 min via ffmpeg.
 *
 * Si le média n'a aucune piste audio (photo, carrousel, vidéo muette), ce n'est
 * pas une erreur : on renvoie `audioFiles: []` + `noAudio: true` avec les
 * métadonnées, et l'appelant enchaîne sur la description seule.
 *
 * @returns {Promise<{
 *   audioFiles: string[],
 *   noAudio: boolean,
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
      ? {
          extractorArgs: 'youtube:player_client=mweb,default,web_safari',
          // CRUCIAL : sans runtime JS, yt-dlp ne peut pas résoudre le
          // "n-sig challenge" de YouTube et seul le format 18 (mp4 muxed
          // ~10 Mo) est récupérable. Avec node, on débloque les formats
          // audio-only (opus 251 ≈ 500 Ko pour un Short) → bien plus rapide
          // et fiable sur Railway. nixpacks.toml installe déjà nodejs_20.
          jsRuntimes: 'node',
          // Filet de sécurité : si jamais yt_dlp_ejs bundled est défaillant,
          // récupère les composants JS depuis GitHub à la volée.
          remoteComponents: 'ejs:github',
        }
      : {}),
  };

  let metadata = {};
  let noAudio = false;
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
      // Sélecteur explicite avec fallbacks, du plus sûr au plus permissif :
      // - `bestaudio` (sans `*`) ne matche QUE les formats audio-only : la
      //   piste audio est garantie. Sur Instagram c'est le DASH m4a (~200 Ko)
      //   au lieu du mp4 muxed (~7 Mo) — 30x moins de données à télécharger.
      // - `bestaudio*` couvre le muxed-with-audio, utile sur les Shorts où
      //   l'audio-only pur n'existe parfois pas.
      // - `best` en dernier recours, contre "Requested format is not available".
      // Sans le premier cran, yt-dlp classait les formats Instagram aux codecs
      // `unknown` au-dessus de la piste audio et pouvait retomber sur un rendu
      // video-only -> "unable to obtain file audio codec with ffprobe".
      format: 'bestaudio/bestaudio*/best',
      postprocessorArgs: 'ffmpeg:-ac 1 -ar 16000 -b:a 64k', // mono, 16kHz, 64kbps
    });
  } catch (err) {
    const errMsg = err.message ?? err.stderr ?? '';

    // Pas d'audio dans ce qui a été téléchargé : ce n'est pas forcément une
    // impasse. On retente sur le média complet, et si le média est vraiment
    // muet on rend la main sans audio — l'import continuera sur la seule
    // description (cf. routes/import.js).
    if (NO_AUDIO_PATTERN.test(errMsg) || NO_MEDIA_PATTERN.test(errMsg)) {
      let recovered = null;
      if (NO_AUDIO_PATTERN.test(errMsg)) {
        console.warn('[download] format sans piste audio — nouvelle tentative sur le média complet…');
        try {
          recovered = await retryViaFullMedia(url, baseOpts, workDir, audioPath);
        } catch (retryErr) {
          console.warn(`[download] retry média complet échoué : ${retryErr.message}`);
        }
      }
      if (recovered) {
        console.log('[download] audio récupéré depuis le média complet');
        noAudio = false;
      } else {
        console.warn('[download] média sans piste audio — extraction depuis la description seule');
        noAudio = true;
      }
    } else {
      await cleanup();
      throw buildDownloadError(platform, cookiesPath, errMsg);
    }
  }

  if (noAudio) {
    // Sans audio, la description (légende Instagram) est la seule source
    // possible : s'il n'y a rien non plus de ce côté, autant le dire tout de
    // suite plutôt que de payer un appel Claude pour rien.
    const fallbackSource = `${metadata.title ?? ''} ${metadata.description ?? ''}`.trim();
    if (!fallbackSource) {
      await cleanup();
      throw new Error(
        "Ce média n'a pas de piste audio (photo, carrousel ou vidéo muette) et aucune description exploitable : il n'y a rien à importer.",
      );
    }
    return { audioFiles: [], noAudio: true, metadata, workDir, cleanup };
  }

  const { size } = await stat(audioPath);
  if (size <= WHISPER_MAX_BYTES) {
    return { audioFiles: [audioPath], noAudio: false, metadata, workDir, cleanup };
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

  return { audioFiles: chunks, noAudio: false, metadata, workDir, cleanup };
}
