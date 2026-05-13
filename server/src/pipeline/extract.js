import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SYSTEM_PROMPT = `Tu es un assistant qui extrait des recettes de cuisine depuis des transcriptions de vidéos.

Tu reçois la transcription parlée d'une vidéo de cuisine (parfois accompagnée du titre et de la description de la vidéo). Ton travail est d'extraire la recette de façon structurée et propre, en français.

Règles strictes :

1. **Titre** — Extrais ou déduis un titre clair et appétissant. Si la vidéo a un titre fourni, tu peux t'en inspirer mais nettoie-le (enlève les hashtags, emojis, "TUTO", "RECETTE FACILE", etc.).

2. **Ingrédients** — Liste tous les ingrédients mentionnés avec leur quantité quand elle est précisée.
   - "name" : le nom tel qu'il apparaît dans la recette ("courgettes jaunes", "oignon rouge", "huile d'olive extra vierge").
   - "canonical_name" : le nom générique au singulier, lowercase, sans qualificatif. Cela sert à regrouper les recettes : "courgettes jaunes" et "courgette" doivent toutes deux donner "courgette". "oignon rouge" et "oignon nouveau" → "oignon". "huile d'olive extra vierge" et "huile d'olive" → "huile d'olive" (déjà au bon niveau, on ne sur-simplifie pas en "huile"). Pour les ingrédients composés (sauce soja, pâte de curry, lait de coco), garde le terme courant en cuisine. Pas d'accents typographiques exotiques, pas de majuscule.
   - "quantity" : un nombre (3, 1.5, 0.5) ou null si non précisé ("à goût", "selon goût").
   - "unit" : "g", "kg", "ml", "L", "cl", "cuillère à soupe", "cuillère à café", "pincée", "gousse", "pièce", etc.

3. **Étapes** — Une étape par phrase d'instruction, dans l'ordre, à l'impératif ("Préchauffer le four à 200°C.", "Mélanger les œufs et le sucre."). Pas de numérotation dans le texte (l'ordre du tableau suffit). Reformule pour être clair et concis — n'invente PAS d'étapes qui ne sont pas dans la transcription.

4. **Temps et portions** — Renseigne prep_time_minutes, cook_time_minutes, servings UNIQUEMENT si la vidéo les mentionne explicitement. Sinon, omets ces champs.

5. **Si la transcription ne contient PAS de recette** (vlog, tutoriel non culinaire, etc.) — appelle quand même save_recipe mais avec title="Pas une recette" et ingredients=[], steps=[]. Le serveur détectera ce cas.

6. **N'invente jamais** une quantité, une étape ou un ingrédient absent de la transcription. Si tu hésites, omets plutôt qu'inventer.

7. **meal_type** — Catégorise la recette dans une (et une seule) des valeurs suivantes :
   - "plat" : tout ce qui est salé (entrée, plat principal, accompagnement, apéro, petit-déjeuner salé, sandwich, soupe…)
   - "dessert" : tout ce qui est sucré (gâteau, biscuit, crème, fruit cuit sucré, glace, viennoiserie…)
   - "sauce" : sauce, vinaigrette, condiment, marinade qui se prépare seul
   - "boisson" : cocktail, smoothie, boisson chaude, jus, infusion
   En cas d'ambiguïté, choisis "plat" par défaut.

Appelle TOUJOURS le tool "save_recipe" avec ta réponse — ne réponds jamais en texte libre.`;

const SAVE_RECIPE_TOOL = {
  name: 'save_recipe',
  description: 'Sauvegarde la recette extraite au format structuré.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Titre clair de la recette en français' },
      meal_type: {
        type: 'string',
        enum: ['plat', 'dessert', 'sauce', 'boisson'],
        description: 'Catégorie de la recette : "plat" pour tout ce qui est salé, "dessert" pour tout ce qui est sucré, "sauce" pour les sauces/condiments seuls, "boisson" pour les cocktails et boissons.',
      },
      servings: { type: 'integer', description: 'Nombre de portions (omettre si non précisé)' },
      prep_time_minutes: { type: 'integer', description: 'Temps de préparation en minutes (omettre si non précisé)' },
      cook_time_minutes: { type: 'integer', description: 'Temps de cuisson en minutes (omettre si non précisé)' },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: "Nom tel qu'il apparaît dans la recette (ex: 'courgettes jaunes')." },
            canonical_name: {
              type: 'string',
              description: "Nom générique singulier lowercase pour regrouper (ex: 'courgette', 'oignon', 'huile d'olive'). Ne pas sur-simplifier les composés.",
            },
            quantity: { type: ['number', 'null'], description: 'Quantité numérique, ou null si non précisé' },
            unit: { type: 'string', description: 'Unité (g, ml, cuillère à soupe, etc.)' },
          },
          required: ['name', 'canonical_name'],
        },
      },
      steps: {
        type: 'array',
        items: { type: 'string', description: "Une étape, à l'impératif" },
      },
    },
    required: ['title', 'meal_type', 'ingredients', 'steps'],
  },
};

/**
 * Extrait une recette structurée depuis une transcription.
 *
 * @param {string} transcript - Transcription brute de la vidéo
 * @param {object} [metadata] - Métadonnées optionnelles { title, description }
 * @returns {Promise<{
 *   title: string,
 *   meal_type: 'plat' | 'dessert' | 'sauce' | 'boisson',
 *   servings?: number,
 *   prep_time_minutes?: number,
 *   cook_time_minutes?: number,
 *   ingredients: Array<{name: string, canonical_name: string, quantity?: number|null, unit?: string}>,
 *   steps: string[],
 *   isRecipe: boolean
 * }>}
 */
export async function extractRecipe(transcript, metadata = {}) {
  if (!transcript || transcript.trim().length < 20) {
    throw new Error('Transcription trop courte ou vide pour extraire une recette.');
  }

  const userParts = [];
  if (metadata.title) userParts.push(`Titre de la vidéo : ${metadata.title}`);
  if (metadata.description) {
    const truncated = metadata.description.slice(0, 1000);
    userParts.push(`Description : ${truncated}`);
  }
  userParts.push(`Transcription parlée :\n${transcript}`);

  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [SAVE_RECIPE_TOOL],
    tool_choice: { type: 'tool', name: 'save_recipe' },
    messages: [{ role: 'user', content: userParts.join('\n\n') }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error("Claude n'a pas appelé le tool save_recipe (réponse inattendue).");
  }

  const recipe = toolUse.input;
  const isRecipe =
    recipe.title !== 'Pas une recette' &&
    Array.isArray(recipe.ingredients) &&
    recipe.ingredients.length > 0 &&
    Array.isArray(recipe.steps) &&
    recipe.steps.length > 0;

  return { ...recipe, isRecipe };
}

const JSONLD_SYSTEM_PROMPT = `Tu reçois une recette déjà extraite depuis le JSON-LD schema.org/Recipe d'une page web. Ton travail est de la normaliser au format Gjize — PAS de la ré-extraire ni de l'inventer.

Tu recevras un titre, parfois une description, une liste d'ingrédients en texte brut ("200 g de farine", "2 œufs", "1 pincée de sel"), une liste d'étapes, et parfois servings / prep_time_minutes / cook_time_minutes déjà fournis.

Règles strictes :

1. **Titre** — Reprends-le tel quel. Nettoie uniquement les hashtags, emojis ou suffixes promotionnels ("TUTO", "FACILE", "EN 5 MIN").

2. **Ingrédients** — Pour chaque ligne brute, produis un objet structuré :
   - "name" : le nom tel qu'il apparaît, sans la quantité ni l'unité ("farine", "œufs", "huile d'olive extra vierge").
   - "canonical_name" : nom générique singulier lowercase pour regrouper les recettes. "courgettes jaunes" et "courgette" → "courgette". "oignon rouge" et "oignon nouveau" → "oignon". "huile d'olive extra vierge" et "huile d'olive" → "huile d'olive" (déjà au bon niveau, ne pas sur-simplifier en "huile"). Pour les composés cuisinés (sauce soja, pâte de curry, lait de coco), garde le terme courant en cuisine. Pas de majuscule, pas d'accent typographique exotique.
   - "quantity" : un nombre (200, 3, 1.5, 0.5) ou null si non précisé.
   - "unit" : "g", "kg", "ml", "L", "cl", "cuillère à soupe", "cuillère à café", "pincée", "gousse", "pièce", etc. Omet le champ si la ligne n'a pas d'unité (ex: "2 œufs" → unit absent).
   - **IGNORE les lignes qui sont des titres de section** ("Pour la pâte", "Montage", "Pour la sauce", "Garniture") — ce ne sont PAS des ingrédients, ne les inclus pas dans le tableau.

3. **Étapes** — Reprends les étapes telles quelles, dans l'ordre. Corrige les fautes de frappe évidentes ("Préchuaffez" → "Préchauffez") mais n'invente RIEN. Pas de numérotation dans le texte (l'ordre du tableau suffit).

4. **Temps et portions** — Reprends prep_time_minutes / cook_time_minutes / servings si fournis dans l'input. Omet le champ si non fourni. Pour servings, extrais juste l'entier ("4 personnes" → 4, "4-6" → 4).

5. **meal_type** — Catégorise en UNE seule valeur :
   - "plat" : tout ce qui est salé (entrée, plat principal, accompagnement, apéro, sandwich, soupe, salade…)
   - "dessert" : tout ce qui est sucré (gâteau, crumble, tarte sucrée, biscuit, crème, glace, viennoiserie…)
   - "sauce" : sauce, vinaigrette, condiment, marinade qui se prépare seule
   - "boisson" : cocktail, smoothie, boisson chaude, jus, infusion
   En cas d'ambiguïté, "plat" par défaut.

Appelle TOUJOURS le tool "save_recipe".`;

/**
 * Normalise une recette déjà extraite depuis le JSON-LD schema.org en passant
 * par Claude pour structurer les ingrédients (canonical_name + quantity + unit)
 * et déduire le meal_type. Le titre, les étapes et les durées du JSON-LD sont
 * réutilisés tels quels (Claude doit les recopier sans inventer).
 *
 * @param {object} scrapedRecipe - Sortie de scrapeRecipePage().recipe
 * @param {object} [metadata]
 * @returns Même structure que extractRecipe()
 */
export async function extractRecipeFromJsonLd(scrapedRecipe, metadata = {}) {
  if (!scrapedRecipe || !Array.isArray(scrapedRecipe.ingredients) || scrapedRecipe.ingredients.length === 0) {
    throw new Error('JSON-LD vide ou invalide.');
  }

  const parts = [`Titre : ${scrapedRecipe.title}`];
  if (scrapedRecipe.description) {
    parts.push(`Description : ${scrapedRecipe.description.slice(0, 500)}`);
  }
  if (scrapedRecipe.servings) parts.push(`recipeYield (servings) : ${scrapedRecipe.servings}`);
  if (typeof scrapedRecipe.prepTimeMinutes === 'number') {
    parts.push(`prep_time_minutes : ${scrapedRecipe.prepTimeMinutes}`);
  }
  if (typeof scrapedRecipe.cookTimeMinutes === 'number') {
    parts.push(`cook_time_minutes : ${scrapedRecipe.cookTimeMinutes}`);
  }
  parts.push(
    `Ingrédients (texte brut, une ligne par item) :\n${scrapedRecipe.ingredients.map((l) => `- ${l}`).join('\n')}`,
  );
  parts.push(
    `Étapes (à recopier dans l'ordre) :\n${scrapedRecipe.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
  );

  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: JSONLD_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [SAVE_RECIPE_TOOL],
    tool_choice: { type: 'tool', name: 'save_recipe' },
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error("Claude n'a pas appelé le tool save_recipe (réponse inattendue).");
  }

  const recipe = toolUse.input;
  const isRecipe =
    recipe.title !== 'Pas une recette' &&
    Array.isArray(recipe.ingredients) &&
    recipe.ingredients.length > 0 &&
    Array.isArray(recipe.steps) &&
    recipe.steps.length > 0;

  return { ...recipe, isRecipe };
}
