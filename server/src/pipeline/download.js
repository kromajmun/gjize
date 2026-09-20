import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, stat, readdir } from 'node:fs/promises';
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

// Le post ne contient aucune vidéo (photo seule) : l'extracteur s'arrête avant
// de renvoyer quoi que ce soit, on n'a donc même pas de description à exploiter.
// Formulation exacte côté yt-dlp : "There is no video in this post"
// (extractor/instagram.py) — la variante "there's" ne matchait jamais.
const NO_MEDIA_PATTERN = /there is no video in this post|no video formats found|no media found/i;

// Combien de formats on tente avant d'abandonner. Au-delà on paie du temps de
// téléchargement pour des rendus de plus en plus improbables.
const MAX_FORMAT_CANDIDATES = 4;
// Deux passes sur la liste : un 403 / rate-limit Instagram depuis une IP
// datacenter est transitoire, alors qu'un média réellement muet le reste.
const DOWNLOAD_PASSES = 2;
const PASS_BACKOFF_MS = 2000;

function isAuthError(platform, message) {
  const patterns = AUTH_ERROR_PATTERNS[platform] ?? [];
  return patterns.some((re) => re.test(message ?? ''));
}

/** Sortie d'erreur yt-dlp : stderr en priorité, c'est là qu'est le détail utile. */
function errText(err) {
  return String(err?.stderr || err?.message || '').trim();
}

/** Les dernières lignes d'une sortie yt-dlp, pour les glisser dans un message court. */
function errExcerpt(text, maxChars = 300) {
  const tail = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-2)
    .join(' / ');
  return tail.length > maxChars ? `${tail.slice(0, maxChars)}…` : tail;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * ffprobe : le fichier contient-il au moins une piste audio ?
 *
 * Throw si ffprobe lui-même échoue (binaire absent, fichier tronqué ou
 * illisible). Une erreur ffprobe n'est PAS une preuve d'absence d'audio —
 * c'est exactement cette confusion qui faisait passer des vidéos sonores pour
 * des médias muets, et produisait des recettes aux étapes devinées.
 */
async function hasAudioStream(filePath) {
  const { stdout } = await execAsync(
    `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${filePath}"`,
  );
  return stdout.trim().length > 0;
}

/**
 * Formats susceptibles de porter de l'audio, du moins cher au plus cher.
 *
 * Les formats explicitement video-only (`acodec: 'none'`) sont écartés : ils ne
 * donneront jamais rien. Les codecs `unknown` d'Instagram sont gardés — ce sont
 * souvent des rendus muxés parfaitement sonores.
 *
 * @returns {string[]} format_id, dans l'ordre à essayer
 */
function pickAudioCandidates(info) {
  const formats = (Array.isArray(info?.formats) ? info.formats : []).filter((f) => f?.format_id);
  const isVideoOnly = (f) => f.acodec === 'none';
  const isAudioOnly = (f) => f.vcodec === 'none' && !isVideoOnly(f);
  // Taille inconnue en dernier : on ne sait pas ce qu'on s'apprête à tirer.
  const weight = (f) => f.filesize ?? f.filesize_approx ?? Number.POSITIVE_INFINITY;
  const bySize = (a, b) => weight(a) - weight(b);

  const audioOnly = formats.filter(isAudioOnly).sort(bySize);
  const maybeMuxed = formats.filter((f) => !isAudioOnly(f) && !isVideoOnly(f)).sort(bySize);

  return [...audioOnly, ...maybeMuxed].slice(0, MAX_FORMAT_CANDIDATES).map((f) => f.format_id);
}

/**
 * Télécharge UN format précis et en sort un mp3 mono 16 kHz 64 kbps.
 *
 * On cible un format_id explicite plutôt qu'un sélecteur en cascade du type
 * `bestaudio` puis `bestaudio*` puis `best` : un sélecteur s'arrête au PREMIER
 * cran qui matche, donc un rendu video-only capté par `bestaudio*` faisait
 * échouer tout le téléchargement sans jamais essayer les formats suivants.
 *
 * @returns {Promise<boolean>} true si un mp3 a été écrit ; false si le fichier
 *   téléchargé ne contient réellement aucune piste audio
 * @throws si le téléchargement, ffprobe ou ffmpeg échoue (erreur technique)
 */
async function extractAudioFromFormat(url, baseOpts, formatId, workDir, audioPath, tag) {
  const attemptDir = path.join(workDir, `fmt-${tag}`);
  await mkdir(attemptDir, { recursive: true });

  await youtubeDlExec(url, {
    ...baseOpts,
    output: path.join(attemptDir, 'media.%(ext)s'),
    format: formatId,
  });

  const media = (await readdir(attemptDir)).find((f) => f.startsWith('media.'));
  if (!media) throw new Error(`yt-dlp n'a écrit aucun fichier pour le format ${formatId}.`);

  const mediaPath = path.join(attemptDir, media);
  if (!(await hasAudioStream(mediaPath))) return false;

  // Mêmes paramètres que le postprocessor yt-dlp : mono 16 kHz 64 kbps.
  await execAsync(
    `ffmpeg -i "${mediaPath}" -vn -ac 1 -ar 16000 -b:a 64k "${audioPath}" -y -loglevel error`,
  );
  return true;
}

/**
 * Essaie les formats candidats jusqu'à obtenir de l'audio.
 *
 * Distingue les deux issues que l'ancien code confondait :
 * - `silent` : TOUS les candidats ont été téléchargés et ffprobe n'y a trouvé
 *   aucune piste audio → le média est muet, c'est prouvé.
 * - `failed` : au moins un candidat n'a pas pu être vérifié (téléchargement ou
 *   ffprobe en erreur) → on ne sait pas, donc on n'invente rien.
 *
 * @returns {Promise<{ status: 'ok' | 'silent' | 'failed', error?: Error }>}
 */
async function extractAudioAnyFormat(url, baseOpts, candidates, workDir, audioPath) {
  const silentFormats = new Set();
  let lastError = null;

  for (let pass = 1; pass <= DOWNLOAD_PASSES; pass++) {
    for (const [index, formatId] of candidates.entries()) {
      if (silentFormats.has(formatId)) continue; // déjà prouvé sans audio
      try {
        const ok = await extractAudioFromFormat(
          url,
          baseOpts,
          formatId,
          workDir,
          audioPath,
          `${pass}-${index}`,
        );
        if (ok) {
          console.log(`[download] audio extrait du format ${formatId}`);
          return { status: 'ok' };
        }
        silentFormats.add(formatId);
        console.warn(`[download] format ${formatId} : aucune piste audio dans le fichier téléchargé`);
      } catch (err) {
        lastError = err;
        // stderr complet en log : c'est la seule trace qui permet de
        // diagnostiquer après coup ce que yt-dlp a refusé de faire.
        console.warn(`[download] format ${formatId} KO (passe ${pass}) :\n${errText(err)}`);
      }
    }

    if (silentFormats.size === candidates.length) break; // tout est prouvé muet
    if (pass < DOWNLOAD_PASSES) {
      console.warn(`[download] échec sur tous les formats — nouvelle passe dans ${PASS_BACKOFF_MS} ms…`);
      await sleep(PASS_BACKOFF_MS);
    }
  }

  if (silentFormats.size === candidates.length) return { status: 'silent' };
  return { status: 'failed', error: lastError };
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
 * Règle centrale : l'absence d'audio doit être PROUVÉE (aucun format porteur
 * d'audio dans les métadonnées, ou ffprobe qui ne trouve aucune piste dans les
 * fichiers effectivement téléchargés). Un échec de téléchargement n'est jamais
 * une preuve : dans ce cas on remonte une erreur plutôt que de basculer sur la
 * description seule, qui produirait une recette aux étapes devinées.
 *
 * Quand l'absence d'audio est prouvée (photo, carrousel, vidéo muette), on
 * renvoie `audioFiles: []` + `noAudio: true` et l'appelant enchaîne sur la
 * description.
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

  // 1. Métadonnées + liste des formats. C'est cette réponse qui fait foi sur la
  //    présence d'audio, jamais l'échec d'un téléchargement.
  let info;
  try {
    info = await youtubeDlExec(url, { ...baseOpts, dumpSingleJson: true });
  } catch (err) {
    const errMsg = errText(err);
    console.warn(`[download] métadonnées KO :\n${errMsg}`);
    await cleanup();
    if (NO_MEDIA_PATTERN.test(errMsg)) {
      throw new Error(
        "Ce post ne contient aucune vidéo (photo seule) : ni audio ni description récupérables. Copie la recette dans les notes pour l'importer quand même.",
      );
    }
    throw buildDownloadError(platform, cookiesPath, errMsg);
  }

  const metadata = {
    title: info.title,
    description: info.description,
    thumbnailUrl: info.thumbnail,
    durationSeconds: info.duration,
  };

  // Sans audio, la description (légende Instagram) est la seule source
  // possible : s'il n'y a rien non plus de ce côté, autant le dire tout de
  // suite plutôt que de payer un appel Claude pour rien.
  const noAudioResult = async () => {
    const fallbackSource = `${metadata.title ?? ''} ${metadata.description ?? ''}`.trim();
    if (!fallbackSource) {
      await cleanup();
      throw new Error(
        "Ce média n'a pas de piste audio (photo, carrousel ou vidéo muette) et aucune description exploitable : il n'y a rien à importer.",
      );
    }
    return { audioFiles: [], noAudio: true, metadata, workDir, cleanup };
  };

  // 2. Aucun format ne peut porter d'audio : carrousel d'images, ou vidéo dont
  //    tous les rendus sont explicitement video-only. Prouvé par les
  //    métadonnées, sans rien télécharger.
  const candidates = pickAudioCandidates(info);
  if (candidates.length === 0) {
    console.warn('[download] aucun format porteur d\'audio — extraction depuis la description seule');
    return noAudioResult();
  }

  // 3. Essai des formats un par un.
  console.log(`[download] ${candidates.length} format(s) candidat(s) : ${candidates.join(', ')}`);
  const outcome = await extractAudioAnyFormat(url, baseOpts, candidates, workDir, audioPath);

  if (outcome.status === 'silent') {
    console.warn('[download] média muet confirmé par ffprobe — extraction depuis la description seule');
    return noAudioResult();
  }

  if (outcome.status === 'failed') {
    // On ne dégrade PAS en import description-only : la vidéo a des formats
    // porteurs d'audio, on n'a simplement pas réussi à les récupérer. Importer
    // quand même donnerait une recette aux étapes inventées.
    const detail = errText(outcome.error);
    await cleanup();
    if (isAuthError(platform, detail)) {
      throw buildDownloadError(platform, cookiesPath, detail);
    }
    throw new Error(
      `Impossible de récupérer l'audio de cette vidéo (${candidates.length} format(s) essayé(s), ${DOWNLOAD_PASSES} passes). Réessaie dans un instant. Détail : ${errExcerpt(detail)}`,
    );
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
