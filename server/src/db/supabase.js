import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import { config } from '../config.js';

const THUMBNAIL_BUCKET = 'thumbnails';
const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

let client = null;

export function getSupabase() {
  if (!config.supabase.enabled) return null;
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false },
      // Node 20 n'a pas de WebSocket natif (arrivé en Node 22).
      // Supabase v2.45+ exige un transport explicite, sinon le module realtime
      // throw au chargement du client — même si on ne l'utilise pas.
      realtime: { transport: WebSocket },
    });
  }
  return client;
}

/**
 * Sauvegarde une recette dans Supabase. No-op si Supabase n'est pas configuré.
 * Renvoie la ligne insérée, ou null si DB désactivée.
 */
export async function saveRecipe({ userId, sourceUrl, sourcePlatform, recipe, transcript }) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('recipes')
    .insert({
      user_id: userId ?? null,
      source_url: sourceUrl,
      source_platform: sourcePlatform,
      title: recipe.title,
      servings: recipe.servings ?? null,
      prep_time_minutes: recipe.prep_time_minutes ?? null,
      cook_time_minutes: recipe.cook_time_minutes ?? null,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      thumbnail_url: recipe.thumbnailUrl ?? null,
      raw_transcript: transcript,
    })
    .select()
    .single();

  if (error) throw new Error(`Erreur Supabase : ${error.message}`);
  return data;
}

/**
 * Liste les recettes (V1 : toutes, ordre antéchronologique).
 * Le payload exclut volontairement raw_transcript pour rester léger côté liste.
 */
export async function listRecipes({ limit = 100 } = {}) {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, source_url, source_platform, thumbnail_url, prep_time_minutes, cook_time_minutes, servings, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Erreur Supabase : ${error.message}`);
  return data ?? [];
}

/** Récupère une recette par ID, avec ingrédients et étapes complets. */
export async function getRecipeById(id) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase.from('recipes').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Erreur Supabase : ${error.message}`);
  return data;
}

/** Supprime une recette par ID. */
export async function deleteRecipe(id) {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase.from('recipes').delete().eq('id', id);
  if (error) throw new Error(`Erreur Supabase : ${error.message}`);
  return true;
}

/**
 * Télécharge une miniature depuis son URL d'origine (CDN YouTube/Instagram) et
 * la ré-upload dans Supabase Storage. Retourne l'URL publique stable, ou null
 * si l'opération échoue (auquel cas l'appelant garde l'URL originale).
 *
 * Nom de fichier = sha256(source_url) tronqué → idempotent : ré-importer la
 * même URL écrase le fichier précédent.
 */
export async function uploadThumbnailFromUrl(sourceUrl, thumbnailUrl) {
  const supabase = getSupabase();
  if (!supabase || !thumbnailUrl) return null;

  try {
    const response = await fetch(thumbnailUrl, { redirect: 'follow' });
    if (!response.ok) {
      console.warn(`[thumbnail] fetch ${response.status} sur ${thumbnailUrl}`);
      return null;
    }
    const contentType = (response.headers.get('content-type') ?? 'image/jpeg')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const ext = EXTENSION_BY_MIME[contentType] ?? 'jpg';
    const buffer = Buffer.from(await response.arrayBuffer());

    const hash = crypto.createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16);
    const objectPath = `${hash}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from(THUMBNAIL_BUCKET)
      .upload(objectPath, buffer, {
        contentType,
        upsert: true,
        cacheControl: '604800', // 7 jours côté CDN Supabase
      });

    if (uploadErr) {
      console.warn(`[thumbnail] upload échec : ${uploadErr.message}`);
      return null;
    }

    const { data } = supabase.storage.from(THUMBNAIL_BUCKET).getPublicUrl(objectPath);
    return data?.publicUrl ?? null;
  } catch (err) {
    console.warn(`[thumbnail] erreur : ${err.message}`);
    return null;
  }
}
