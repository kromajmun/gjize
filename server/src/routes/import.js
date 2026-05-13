import { Router } from 'express';
import { downloadAudio, detectPlatform } from '../pipeline/download.js';
import { transcribeAudio } from '../pipeline/transcribe.js';
import { extractRecipe, extractRecipeFromJsonLd } from '../pipeline/extract.js';
import { scrapeRecipePage } from '../pipeline/scrape.js';
import { saveRecipe, uploadThumbnailFromUrl } from '../db/supabase.js';

export const importRouter = Router();

importRouter.post('/import-recipe', async (req, res) => {
  const { url, userId } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Le champ "url" est requis (string).' });
  }

  const platform = detectPlatform(url);
  if (platform === 'unknown') {
    return res.status(400).json({ error: 'URL invalide (http/https attendu).' });
  }

  let cleanup = null;
  try {
    let recipe;
    let metadata;
    let transcript = null;

    if (platform === 'web') {
      console.log('[import] web — scraping JSON-LD…');
      const scraped = await scrapeRecipePage(url);
      metadata = scraped.metadata;
      console.log(
        `[import] JSON-LD : "${scraped.recipe.title}" (${scraped.recipe.ingredients.length} ingrédients bruts, ${scraped.recipe.steps.length} étapes)`,
      );
      console.log('[import] normalisation Claude…');
      recipe = await extractRecipeFromJsonLd(scraped.recipe, metadata);
    } else {
      console.log(`[import] ${platform} — téléchargement audio…`);
      const downloadResult = await downloadAudio(url);
      cleanup = downloadResult.cleanup;
      const { audioFiles } = downloadResult;
      metadata = downloadResult.metadata;
      console.log(`[import] téléchargé (${audioFiles.length} chunk${audioFiles.length > 1 ? 's' : ''})`);

      console.log('[import] transcription Whisper…');
      transcript = await transcribeAudio(audioFiles);
      console.log(`[import] transcrit (${transcript.length} caractères)`);

      console.log('[import] extraction Claude…');
      recipe = await extractRecipe(transcript, metadata);
    }

    console.log(
      `[import] extrait : "${recipe.title}" (${recipe.ingredients.length} ingrédients, ${recipe.steps.length} étapes)`,
    );

    if (!recipe.isRecipe) {
      return res.status(422).json({
        error:
          platform === 'web'
            ? "La page ne semble pas contenir une recette de cuisine."
            : 'Cette vidéo ne semble pas contenir de recette de cuisine.',
        transcript_excerpt: transcript ? transcript.slice(0, 200) : undefined,
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
        // status est appliqué côté DB (défaut 'to_test'), on le renvoie pour cohérence UI.
        status: saved?.status ?? 'to_test',
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
