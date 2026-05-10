// Migration des recettes existantes vers le catalogue normalisé d'ingrédients.
//
// Pour chaque recette qui n'a pas encore de lignes dans recipe_ingredients :
//   1. Récupère son tableau jsonb `ingredients`
//   2. Demande à Claude de mapper chaque "name" → "canonical_name" (1 appel par batch global)
//   3. Upsert dans `ingredients` puis insert dans `recipe_ingredients`
//
// Idempotent : skip les recettes déjà migrées.
//
// Usage : depuis server/ → `node scripts/migrate-ingredients.js`

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from '../src/db/supabase.js';
import { config } from '../src/config.js';

const supabase = getSupabase();
if (!supabase) {
  console.error('Supabase non configuré.');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

// 1. Lecture des recettes + détection de celles déjà migrées
const { data: allRecipes, error: recErr } = await supabase
  .from('recipes')
  .select('id, title, ingredients');
if (recErr) {
  console.error('Erreur lecture recipes :', recErr.message);
  process.exit(1);
}

const { data: existingLinks } = await supabase.from('recipe_ingredients').select('recipe_id');
const migratedSet = new Set((existingLinks ?? []).map((r) => r.recipe_id));

const todo = (allRecipes ?? []).filter((r) => !migratedSet.has(r.id));
console.log(`${allRecipes?.length ?? 0} recettes au total, ${todo.length} à migrer.`);

if (todo.length === 0) {
  console.log('Rien à faire ✓');
  process.exit(0);
}

// 2. Aggrégation des noms uniques pour normalisation en 1 appel Claude
const uniqueNames = new Set();
for (const recipe of todo) {
  for (const ing of recipe.ingredients ?? []) {
    if (ing?.name) uniqueNames.add(ing.name);
  }
}
const namesArr = [...uniqueNames];
console.log(`${namesArr.length} noms d'ingrédients uniques à normaliser via Claude…`);

const NORMALIZE_TOOL = {
  name: 'normalize_ingredients',
  description: 'Normalise une liste de noms d\'ingrédients vers leur canonical_name.',
  input_schema: {
    type: 'object',
    properties: {
      mapping: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            raw: { type: 'string', description: 'Le nom original' },
            canonical: { type: 'string', description: 'Le nom générique singulier lowercase' },
          },
          required: ['raw', 'canonical'],
        },
      },
    },
    required: ['mapping'],
  },
};

const NORMALIZE_PROMPT = `Tu vas recevoir une liste de noms d'ingrédients de cuisine en français, tels qu'ils apparaissent dans des recettes. Pour chacun, fournis son "canonical_name" : le nom générique au singulier, lowercase, sans qualificatif.

Règles :
- "courgettes jaunes" → "courgette"
- "oignon rouge" → "oignon"
- "huile d'olive extra vierge" → "huile d'olive" (composé qu'on ne sur-simplifie pas)
- "sauce soja" → "sauce soja"
- "fromage râpé" → "fromage" SAUF si le fromage est précisé ("parmesan râpé" → "parmesan")
- Pas d'accent typographique exotique, pas de majuscule.

Appelle TOUJOURS le tool "normalize_ingredients" avec le mapping complet.`;

const response = await anthropic.messages.create({
  model: config.anthropicModel,
  max_tokens: 4096,
  system: NORMALIZE_PROMPT,
  tools: [NORMALIZE_TOOL],
  tool_choice: { type: 'tool', name: 'normalize_ingredients' },
  messages: [
    {
      role: 'user',
      content: `Voici la liste à normaliser :\n${namesArr.map((n) => `- ${n}`).join('\n')}`,
    },
  ],
});

const toolUse = response.content.find((b) => b.type === 'tool_use');
if (!toolUse) {
  console.error('Claude n\'a pas appelé le tool.');
  process.exit(1);
}

const map = new Map();
for (const item of toolUse.input.mapping ?? []) {
  if (item.raw && item.canonical) {
    map.set(item.raw, String(item.canonical).trim().toLowerCase());
  }
}
console.log(`Mapping reçu : ${map.size} entrées.`);

// 3. Upsert ingredients + insert recipe_ingredients pour chaque recette
const cache = new Map(); // canonical → ingredientId

async function upsertIngredient(canonical) {
  if (cache.has(canonical)) return cache.get(canonical);
  const display = canonical.charAt(0).toUpperCase() + canonical.slice(1);

  const { data: existing } = await supabase
    .from('ingredients')
    .select('id')
    .eq('canonical_name', canonical)
    .maybeSingle();

  if (existing) {
    cache.set(canonical, existing.id);
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from('ingredients')
    .insert({ canonical_name: canonical, display_name: display })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: retry } = await supabase
        .from('ingredients')
        .select('id')
        .eq('canonical_name', canonical)
        .single();
      cache.set(canonical, retry.id);
      return retry.id;
    }
    throw error;
  }
  cache.set(canonical, inserted.id);
  return inserted.id;
}

let migrated = 0;
let failed = 0;
for (const recipe of todo) {
  try {
    const rows = [];
    const ings = recipe.ingredients ?? [];
    for (let i = 0; i < ings.length; i++) {
      const ing = ings[i];
      if (!ing?.name) continue;
      const canonical = map.get(ing.name);
      if (!canonical) {
        console.warn(`  ⚠ pas de mapping pour "${ing.name}" (recette ${recipe.title})`);
        continue;
      }
      const ingredientId = await upsertIngredient(canonical);
      rows.push({
        recipe_id: recipe.id,
        ingredient_id: ingredientId,
        raw_name: ing.name,
        quantity: typeof ing.quantity === 'number' ? ing.quantity : null,
        unit: ing.unit ?? null,
        position: i,
      });
    }
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('recipe_ingredients').insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
    migrated += 1;
    console.log(`  ✓ ${recipe.title} (${rows.length} ingrédients liés)`);
  } catch (err) {
    failed += 1;
    console.warn(`  ✗ ${recipe.title} : ${err.message}`);
  }
}

console.log(`\nRésumé : ${migrated} recette(s) migrée(s), ${failed} en échec.`);
process.exit(0);
