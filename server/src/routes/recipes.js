import { Router } from 'express';
import { listRecipes, getRecipeById, deleteRecipe } from '../db/supabase.js';

export const recipesRouter = Router();

recipesRouter.get('/recipes', async (_req, res) => {
  try {
    const recipes = await listRecipes();
    res.json({ recipes });
  } catch (err) {
    console.error('[recipes] list :', err);
    res.status(500).json({ error: err.message });
  }
});

recipesRouter.get('/recipes/:id', async (req, res) => {
  try {
    const recipe = await getRecipeById(req.params.id);
    if (!recipe) return res.status(404).json({ error: 'Recette introuvable.' });
    res.json({ recipe });
  } catch (err) {
    console.error('[recipes] get :', err);
    res.status(500).json({ error: err.message });
  }
});

recipesRouter.delete('/recipes/:id', async (req, res) => {
  try {
    await deleteRecipe(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[recipes] delete :', err);
    res.status(500).json({ error: err.message });
  }
});
