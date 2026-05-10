import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config } from '../config.js';

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
