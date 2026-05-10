const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type Ingredient = {
  name: string;
  quantity?: number | null;
  unit?: string;
};

export type MealType = 'plat' | 'dessert' | 'sauce' | 'boisson';
export type RecipeStatus = 'to_test' | 'validated';

export type RecipeSummary = {
  id: string;
  title: string;
  source_url: string;
  source_platform: 'youtube' | 'instagram';
  thumbnail_url: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  servings: number | null;
  meal_type: MealType;
  status: RecipeStatus;
  created_at: string;
};

export type Recipe = RecipeSummary & {
  ingredients: Ingredient[];
  steps: string[];
  raw_transcript: string | null;
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
};

export { ApiError, API_URL };
