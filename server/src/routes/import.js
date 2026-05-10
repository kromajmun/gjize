import { Router } from 'express';
import { downloadAudio, detectPlatform } from '../pipeline/download.js';
import { transcribeAudio } from '../pipeline/transcribe.js';
import { extractRecipe } from '../pipeline/extract.js';
import { saveRecipe, uploadThumbnailFromUrl } from '../db/supabase.js';

export const importRouter = Router();

importRouter.post('/import-recipe', async (req, res) => {
  const { url, userId } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Le champ "url" est requis (string).' });
  }

  const platform = detectPlatform(url);
  if (platform === 'unknown') {
    return res.status(400).json({
      error: 'URL non supportée. Plateformes acceptées : YouTube, Instagram.',
    });
  }

  let cleanup = null;
  try {
    console.log(`[import] ${platform} — téléchargement audio…`);
    const downloadResult = await downloadAudio(url);
    cleanup = downloadResult.cleanup;
    const { audioFiles, metadata } = downloadResult;
    console.log(`[import] téléchargé (${audioFiles.length} chunk${audioFiles.length > 1 ? 's' : ''})`);

    console.log('[import] transcription Whisper…');
    const transcript = await transcribeAudio(audioFiles);
    console.log(`[import] transcrit (${transcript.length} caractères)`);

    console.log('[import] extraction Claude…');
    const recipe = await extractRecipe(transcript, metadata);
    console.log(
      `[import] extrait : "${recipe.title}" (${recipe.ingredients.length} ingrédients, ${recipe.steps.length} étapes)`,
    );

    if (!recipe.isRecipe) {
      return res.status(422).json({
        error: 'Cette vidéo ne semble pas contenir de recette de cuisine.',
        transcript_excerpt: transcript.slice(0, 200),
      });
    }

    let stableThumbnailUrl = metadata.thumbnailUrl ?? null;
    if (metadata.thumbnailUrl) {
      console.log('[import] upload thumbnail dans Supabase Storage…');
      const stored = await uploadThumbnailFromUrl(url, metadata.thumbnailUrl);
      if (stored) {
        stableThumbnailUrl = stored;
        console.log('[import] thumbnail uploadée');
      } else {
        console.warn('[import] thumbnail non uploadée, fallback sur URL CDN d\'origine');
      }
    }

    let saved = null;
    try {
      saved = await saveRecipe({
        userId,
        sourceUrl: url,
        sourcePlatform: platform,
        recipe: { ...recipe, thumbnailUrl: stableThumbnailUrl },
        transcript,
      });
      if (saved) console.log(`[import] sauvegardé en DB : ${saved.id}`);
      else console.log('[import] DB désactivée — recette renvoyée sans sauvegarde');
    } catch (dbErr) {
      console.warn(`[import] sauvegarde DB échouée (recette renvoyée quand même) : ${dbErr.message}`);
    }

    console.log('[import] terminé ✓');
    return res.json({
      recipe: {
        ...recipe,
        source_url: url,
        source_platform: platform,
        thumbnail_url: stableThumbnailUrl,
      },
      saved_id: saved?.id ?? null,
    });
  } catch (err) {
    console.error('[import] erreur :', err);
    return res.status(500).json({ error: err.message ?? 'Erreur interne.' });
  } finally {
    if (cleanup) {
      cleanup().catch((e) => console.warn('[import] cleanup échec :', e.message));
    }
  }
});
