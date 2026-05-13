const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type Ingredient = {
  name: string;
  canonical_name?: string;
  quantity?: number | null;
  unit?: string;
};

export type IngredientSummary = {
  id: string;
  canonical_name: string;
  display_name: string;
  recipe_count: number;
};

export type IngredientDetail = {
  id: string;
  canonical_name: string;
  display_name: string;
};

export type MealType = 'plat' | 'dessert' | 'sauce' | 'boisson';
export type RecipeStatus = 'to_test' | 'validated';

export type RecipeSummary = {
  id: string;
  title: string;
  source_url: string;
  source_platform: 'youtube' | 'instagram' | 'web';
  thumbnail_url: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  servings: number | null;
  meal_type: MealType;
  status: RecipeStatus;
  created_at: string;
};

export type RecipeIngredientLink = {
  id: string;
  ingredient_id: string;
  raw_name: string | null;
  quantity: number | null;
  unit: string | null;
  position: number;
  ingredients: { id: string; canonical_name: string; display_name: string };
};

export type Recipe = RecipeSummary & {
  ingredients: Ingredient[];
  steps: string[];
  raw_transcript: string | null;
  // Joint depuis le catalogue normalisé. Vide si la recette n'a pas encore
  // été migrée — dans ce cas l'UI retombe sur le tableau `ingredients` jsonb.
  recipe_ingredients?: RecipeIngredientLink[];
};

export type ImportResponse = {
  recipe: Recipe & { source_url: string; source_platform: string };
  saved_id: string | null;
};

class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {}
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  listRecipes: () =>
    request<{ recipes: RecipeSummary[] }>('/recipes').then((r) => r.recipes),

  getRecipe: (id: string) =>
    request<{ recipe: Recipe }>(`/recipes/${id}`).then((r) => r.recipe),

  importRecipe: (url: string) =>
    request<ImportResponse>('/import-recipe', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  deleteRecipe: (id: string) =>
    request<{ ok: true }>(`/recipes/${id}`, { method: 'DELETE' }),

  updateRecipe: (id: string, patch: { status?: RecipeStatus; meal_type?: MealType }) =>
    request<{ recipe: Recipe }>(`/recipes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.recipe),

  listIngredients: (query?: string) => {
    const qs = query && query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    return request<{ ingredients: IngredientSummary[] }>(`/ingredients${qs}`).then(
      (r) => r.ingredients,
    );
  },

  getIngredient: (id: string) =>
    request<{ ingredient: IngredientDetail; recipes: RecipeSummary[] }>(`/ingredients/${id}`),
};

export { ApiError, API_URL };
