import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { config } from '../config.js';

const THUMBNAIL_BUCKET = 'thumbnails';
const SECRETS_BUCKET = 'secrets';
const COOKIES_CACHE_TTL_MS = 60_000; // 1 min — assez court pour que la rotation soit prise en compte rapidement
const COOKIES_OBJECT_BY_PLATFORM = {
  instagram: 'instagram_cookies.txt',
  youtube: 'youtube_cookies.txt',
};

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Cache par plateforme : on retient le dernier chemin local + un timestamp.
// `localPath: null` mis en cache aussi → évite de re-tenter Storage en boucle si
// le fichier n'existe pas (cas YouTube quand l'utilisateur n'a pas de cookies).
const cookiesCache = {
  instagram: { fetchedAt: 0, localPath: null },
  youtube: { fetchedAt: 0, localPath: null },
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
 * Normalise un canonical_name : trim, lowercase, espaces multiples → simple.
 * On garde les accents (différencier "epinard" et "épinard" est trop fragile).
 */
function normalizeCanonical(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Capitalise la première lettre pour l'affichage UI ("courgette" → "Courgette").
 */
function toDisplayName(canonical) {
  if (!canonical) return '';
  return canonical.charAt(0).toUpperCase() + canonical.slice(1);
}

/**
 * Upsert d'un ingrédient dans le catalogue. Renvoie l'id existant ou nouveau.
 * Utilise une transaction logique : SELECT puis INSERT si manquant.
 */
async function upsertIngredient(supabase, canonicalRaw) {
  const canonical = normalizeCanonical(canonicalRaw);
  if (!canonical) return null;

  const { data: existing, error: selErr } = await supabase
    .from('ingredients')
    .select('id')
    .eq('canonical_name', canonical)
    .maybeSingle();

  if (selErr) throw new Error(`Erreur ingredients select : ${selErr.message}`);
  if (existing) return existing.id;

  const { data: inserted, error: insErr } = await supabase
    .from('ingredients')
    .insert({ canonical_name: canonical, display_name: toDisplayName(canonical) })
    .select('id')
    .single();

  // Race condition possible si 2 imports concurrents : on retombe sur SELECT.
  if (insErr) {
    if (insErr.code === '23505') {
      const { data: retry } = await supabase
        .from('ingredients')
        .select('id')
        .eq('canonical_name', canonical)
        .single();
      return retry?.id ?? null;
    }
    throw new Error(`Erreur ingredients insert : ${insErr.message}`);
  }
  return inserted.id;
}

/**
 * Lie un tableau d'ingrédients (issu de l'extraction Claude) à une recette.
 * Pour chaque ingrédient : upsert dans `ingredients` + insert dans `recipe_ingredients`.
 */
async function linkRecipeIngredients(supabase, recipeId, ingredients) {
  const rows = [];
  for (let i = 0; i < ingredients.length; i++) {
    const ing = ingredients[i];
    const ingredientId = await upsertIngredient(supabase, ing.canonical_name ?? ing.name);
    if (!ingredientId) continue;
    rows.push({
      recipe_id: recipeId,
      ingredient_id: ingredientId,
      raw_name: ing.name ?? null,
      quantity: typeof ing.quantity === 'number' ? ing.quantity : null,
      unit: ing.unit ?? null,
      position: i,
    });
  }
  if (rows.length === 0) return;
  const { error } = await supabase.from('recipe_ingredients').insert(rows);
  if (error) throw new Error(`Erreur recipe_ingredients insert : ${error.message}`);
}

/**
 * Sauvegarde une recette dans Supabase. No-op si Supabase n'est pas configuré.
 * Renvoie la ligne insérée, ou null si DB désactivée.
 *
 * Alimente aussi le catalogue normalisé (ingredients + recipe_ingredients) pour
 * la recherche par ingrédient. Le jsonb `ingredients` reste source de vérité
 * pour l'affichage de la fiche.
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
      meal_type: recipe.meal_type ?? 'plat',
      servings: recipe.servings ?? null,
      prep_time_minutes: recipe.prep_time_minutes ?? null,
      cook_time_minutes: recipe.cook_time_minutes ?? null,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      thumbnail_url: recipe.thumbnailUrl ?? null,
      raw_transcript: transcript,
      // status omis volontairement → la DB applique le défaut 'to_test'.
    })
    .select()
    .single();

  if (error) throw new Error(`Erreur Supabase : ${error.message}`);

  // Catalogue normalisé : best-effort. En cas d'échec, la recette reste créée
  // (le jsonb sur `recipes` couvre l'affichage), seule la recherche dégrade.
  try {
    await linkRecipeIngredients(supabase, data.id, recipe.ingredients ?? []);
  } catch (linkErr) {
    console.warn(`[saveRecipe] catalogue ingrédients : ${linkErr.message}`);
  }

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
    .select('id, title, source_url, source_platform, thumbnail_url, prep_time_minutes, cook_time_minutes, servings, meal_type, status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Erreur Supabase : ${error.message}`);
  return data ?? [];
}

/**
 * Récupère une recette par ID, avec ingrédients (jointure recipe_ingredients +
 * ingredients pour avoir les ingredient_id navigables) et étapes complets.
 *
 * Si la recette n'a pas encore été migrée vers le catalogue normalisé, le tableau
 * recipe_ingredients sera vide et l'app retombera sur le jsonb `ingredients`.
 */
export async function getRecipeById(id) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('recipes')
    .select(
      `*,
       recipe_ingredients (
         id, ingredient_id, raw_name, quantity, unit, position,
         ingredients ( id, canonical_name, display_name )
       )`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Erreur Supabase : ${error.message}`);
  if (data?.recipe_ingredients) {
    data.recipe_ingredients.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
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
 * Télécharge le fichier de cookies (Netscape) d'une plateforme depuis le bucket
 * privé `secrets` et l'écrit dans /tmp/. Renvoie le chemin local, ou null si le
 * fichier n'existe pas dans Storage (cookies optionnels selon les plateformes).
 *
 * Cache TTL court (60s) par plateforme pour éviter de retélécharger à chaque
 * appel — la rotation est donc prise en compte au pire après 1 min.
 *
 * Pour rotater : remplace le fichier dans Supabase Dashboard > Storage >
 * secrets > {platform}_cookies.txt (drag-and-drop / Replace).
 */
export async function getCookiesPath(platform) {
  const objectName = COOKIES_OBJECT_BY_PLATFORM[platform];
  if (!objectName) return null;

  const supabase = getSupabase();
  if (!supabase) return null;

  const cache = cookiesCache[platform];
  const now = Date.now();
  if (now - cache.fetchedAt < COOKIES_CACHE_TTL_MS) {
    return cache.localPath; // peut être null (absent confirmé) → pas de retry tant que TTL non expiré
  }

  const { data, error } = await supabase.storage.from(SECRETS_BUCKET).download(objectName);

  if (error) {
    // 404 attendu si le fichier n'a jamais été uploadé.
    console.warn(`[cookies:${platform}] indisponibles dans Storage : ${error.message}`);
    cookiesCache[platform] = { fetchedAt: now, localPath: null };
    return null;
  }

  const text = await data.text();
  const dir = path.join(tmpdir(), 'gjize-secrets');
  await mkdir(dir, { recursive: true });
  const localPath = path.join(dir, objectName);
  await writeFile(localPath, text, 'utf8');

  cookiesCache[platform] = { fetchedAt: now, localPath };
  return localPath;
}

/** Force le prochain getCookiesPath(platform) à retélécharger depuis Storage. */
export function invalidateCookiesCache(platform) {
  if (cookiesCache[platform]) {
    cookiesCache[platform] = { fetchedAt: 0, localPath: null };
  }
}

/**
 * Renvoie la liste des canonical_name existants (triés, déduplés).
 * Utilisé pour injecter le catalogue dans le prompt Claude et éviter les doublons.
 */
export async function listCanonicalNames() {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('ingredients')
    .select('canonical_name')
    .order('canonical_name', { ascending: true });

  if (error) {
    console.warn(`[listCanonicalNames] ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => r.canonical_name);
}

/**
 * Liste les ingrédients du catalogue avec le nombre de recettes qui les utilisent.
 * Si `query` est fourni, filtre par sous-chaîne sur canonical_name (ILIKE %q%).
 */
export async function listIngredients({ query } = {}) {
  const supabase = getSupabase();
  if (!supabase) return [];

  let req = supabase
    .from('ingredients')
    .select('id, canonical_name, display_name, recipe_ingredients(recipe_id)')
    .order('canonical_name', { ascending: true });

  if (query && query.trim()) {
    const q = query.trim().toLowerCase();
    req = req.ilike('canonical_name', `%${q}%`);
  }

  const { data, error } = await req;
  if (error) throw new Error(`Erreur Supabase : ${error.message}`);

  return (data ?? [])
    .map((row) => ({
      id: row.id,
      canonical_name: row.canonical_name,
      display_name: row.display_name,
      recipe_count: Array.isArray(row.recipe_ingredients) ? row.recipe_ingredients.length : 0,
    }))
    .filter((row) => row.recipe_count > 0); // on n'expose que ceux liés à au moins 1 recette
}

/** Détail d'un ingrédient. */
export async function getIngredientById(id) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('ingredients')
    .select('id, canonical_name, display_name')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Erreur Supabase : ${error.message}`);
  return data;
}

/** Liste les recettes utilisant un ingrédient donné, mêmes colonnes que listRecipes. */
export async function listRecipesByIngredient(ingredientId, { limit = 100 } = {}) {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('recipe_ingredients')
    .select(
      'recipes(id, title, source_url, source_platform, thumbnail_url, prep_time_minutes, cook_time_minutes, servings, meal_type, status, created_at)',
    )
    .eq('ingredient_id', ingredientId)
    .limit(limit);

  if (error) throw new Error(`Erreur Supabase : ${error.message}`);

  // Dédupliquer si une recette utilise plusieurs fois le même ingrédient.
  const seen = new Set();
  const out = [];
  for (const row of data ?? []) {
    const r = row.recipes;
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out;
}

const ALLOWED_STATUS = new Set(['to_test', 'validated']);
const ALLOWED_MEAL_TYPE = new Set(['plat', 'dessert', 'sauce', 'boisson']);

/**
 * Met à jour partiellement une recette (status et/ou meal_type).
 * Renvoie la ligne mise à jour, ou null si Supabase est désactivé / id introuvable.
 */
export async function updateRecipe(id, { status, mealType } = {}) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const patch = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    if (!ALLOWED_STATUS.has(status)) {
      throw new Error(`status invalide (attendu: to_test | validated, reçu: ${status})`);
    }
    patch.status = status;
  }
  if (mealType !== undefined) {
    if (!ALLOWED_MEAL_TYPE.has(mealType)) {
      throw new Error(`meal_type invalide (attendu: plat | dessert | sauce | boisson, reçu: ${mealType})`);
    }
    patch.meal_type = mealType;
  }

  const { data, error } = await supabase
    .from('recipes')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Erreur Supabase : ${error.message}`);
  return data;
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
