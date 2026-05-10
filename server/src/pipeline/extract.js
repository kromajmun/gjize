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
