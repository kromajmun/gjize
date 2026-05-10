import { Router } from 'express';
import {
  listIngredients,
  getIngredientById,
  listRecipesByIngredient,
} from '../db/supabase.js';

export const ingredientsRouter = Router();

ingredientsRouter.get('/ingredients', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const ingredients = await listIngredients({ query: q });
    res.json({ ingredients });
  } catch (err) {
    console.error('[ingredients] list :', err);
    res.status(500).json({ error: err.message });
  }
});

ingredientsRouter.get('/ingredients/:id', async (req, res) => {
  try {
    const ingredient = await getIngredientById(req.params.id);
    if (!ingredient) return res.status(404).json({ error: 'Ingrédient introuvable.' });
    const recipes = await listRecipesByIngredient(ingredient.id);
    res.json({ ingredient, recipes });
  } catch (err) {
    console.error('[ingredients] get :', err);
    res.status(500).json({ error: err.message });
  }
});
