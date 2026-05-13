import * as cheerio from 'cheerio';

// UA navigateur explicite : certains sites (Marmiton, etc.) renvoient du 403
// quand le User-Agent ressemble à un bot ou est absent.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Cherche récursivement le premier objet `@type: "Recipe"` dans un noeud JSON-LD.
 * Gère @graph, arrays, et @type qui peut être string ou array (un noeud peut
 * être ["Recipe", "BlogPosting"]).
 */
function findRecipeNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
    return null;
  }
  const type = node['@type'];
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
    return node;
  }
  if (node['@graph']) {
    return findRecipeNode(node['@graph']);
  }
  return null;
}

/** Convertit une durée ISO 8601 ("PT1H30M") en minutes. Null si non parsable. */
function parseIsoDurationMinutes(iso) {
  if (typeof iso !== 'string') return null;
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  return hours * 60 + minutes;
}

/**
 * Aplatit recipeInstructions schema.org vers un tableau de strings.
 * Gère : string, array of strings, HowToStep, HowToSection nested.
 */
function flattenInstructions(instructions) {
  if (!instructions) return [];
  if (typeof instructions === 'string') return [instructions];
  if (!Array.isArray(instructions)) {
    if (instructions.text) return [instructions.text];
    return [];
  }
  const out = [];
  for (const item of instructions) {
    if (typeof item === 'string') {
      out.push(item);
    } else if (item?.['@type'] === 'HowToSection') {
      out.push(...flattenInstructions(item.itemListElement ?? []));
    } else if (item?.text) {
      out.push(item.text);
    } else if (item?.name) {
      out.push(item.name);
    }
  }
  return out;
}

function normalizeYield(y) {
  if (y == null) return null;
  if (typeof y === 'number') return String(y);
  if (typeof y === 'string') return y.trim() || null;
  if (Array.isArray(y) && y.length > 0) return normalizeYield(y[0]);
  return null;
}

function pickImageUrl(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) {
    for (const item of image) {
      const url = pickImageUrl(item);
      if (url) return url;
    }
    return null;
  }
  if (image.url) return image.url;
  return null;
}

/**
 * Récupère une page web et extrait la recette JSON-LD schema.org/Recipe.
 *
 * Pas de fallback HTML/LLM : si le JSON-LD Recipe est absent ou incomplet,
 * on throw une erreur explicite (l'utilisateur ouvrira un autre lien).
 *
 * @param {string} url
 * @returns {Promise<{
 *   recipe: {
 *     title: string,
 *     description?: string,
 *     ingredients: string[],     // raw strings ("200 g de farine")
 *     steps: string[],
 *     servings?: string|null,
 *     prepTimeMinutes?: number|null,
 *     cookTimeMinutes?: number|null,
 *   },
 *   metadata: {
 *     title?: string,
 *     thumbnailUrl?: string|null,
 *   }
 * }>}
 */
export async function scrapeRecipePage(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
  } catch (err) {
    throw new Error(`Impossible de récupérer la page : ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(`La page a répondu en HTTP ${response.status}.`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const jsonLdScripts = $('script[type="application/ld+json"]').toArray();
  if (jsonLdScripts.length === 0) {
    throw new Error(
      "Aucune donnée structurée (JSON-LD) trouvée sur cette page. L'import web ne supporte pour l'instant que les sites avec schema.org/Recipe (Marmiton, Cuisine AZ, 750g, Cuisine Actuelle, etc.).",
    );
  }

  let recipeNode = null;
  for (const script of jsonLdScripts) {
    const raw = $(script).contents().text();
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw);
      recipeNode = findRecipeNode(parsed);
      if (recipeNode) break;
    } catch {
      // JSON-LD parfois mal échappé sur certains sites → on tente le suivant.
    }
  }

  if (!recipeNode) {
    throw new Error(
      "Cette page contient du JSON-LD mais aucune recette (schema.org/Recipe). C'est probablement une page d'accueil, un article ou une liste. Vérifie l'URL.",
    );
  }

  const ingredients = Array.isArray(recipeNode.recipeIngredient)
    ? recipeNode.recipeIngredient.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const steps = flattenInstructions(recipeNode.recipeInstructions)
    .map((s) => String(s).trim())
    .filter(Boolean);

  if (ingredients.length === 0 || steps.length === 0) {
    throw new Error(
      `Recette schema.org trouvée mais incomplète (${ingredients.length} ingrédient(s), ${steps.length} étape(s)). Impossible d'importer.`,
    );
  }

  const title =
    (typeof recipeNode.name === 'string' && recipeNode.name.trim()) ||
    $('title').first().text().trim() ||
    'Sans titre';

  const ogImage = $('meta[property="og:image"]').attr('content') ?? null;
  const thumbnailUrl = pickImageUrl(recipeNode.image) ?? ogImage;

  return {
    recipe: {
      title,
      description: typeof recipeNode.description === 'string' ? recipeNode.description : undefined,
      ingredients,
      steps,
      servings: normalizeYield(recipeNode.recipeYield),
      prepTimeMinutes: parseIsoDurationMinutes(recipeNode.prepTime),
      cookTimeMinutes: parseIsoDurationMinutes(recipeNode.cookTime),
    },
    metadata: {
      title,
      thumbnailUrl,
    },
  };
}
