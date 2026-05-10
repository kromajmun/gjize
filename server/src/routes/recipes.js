import { Router } from 'express';
import { listRecipes, getRecipeById, deleteRecipe, updateRecipe } from '../db/supabase.js';

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

recipesRouter.patch('/recipes/:id', async (req, res) => {
  try {
    const { status, meal_type: mealType } = req.body ?? {};
    if (status === undefined && mealType === undefined) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour (status ou meal_type).' });
    }
    const recipe = await updateRecipe(req.params.id, { status, mealType });
    if (!recipe) return res.status(404).json({ error: 'Recette introuvable.' });
    res.json({ recipe });
  } catch (err) {
    console.error('[recipes] patch :', err);
    res.status(400).json({ error: err.message });
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
