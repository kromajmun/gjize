# Gjize — App (Expo)

App mobile + web qui affiche les recettes importées par le serveur Railway.

## Stack

- **Expo SDK 52** + **expo-router** (routing fichier)
- **TypeScript**
- **TanStack Query** pour le cache des appels au backend
- 3 écrans : liste (`/`), import (`/import`), détail (`/recipe/[id]`)

## Configuration

```bash
cd app
cp .env.example .env
# Édite EXPO_PUBLIC_API_URL — voir le commentaire dans .env.example
npm install --legacy-peer-deps
```

**À savoir sur l'URL du backend** :
- `http://localhost:3000` marche pour le navigateur web (`npm run web`).
- Pour tester sur ton iPhone via **Expo Go**, "localhost" ne résout pas — utilise l'IP LAN de ton Mac : `ipconfig getifaddr en0` puis `EXPO_PUBLIC_API_URL=http://192.168.x.x:3000`.
- Mac et iPhone doivent être sur le même Wi-Fi.

## Démarrage

```bash
# Web (le plus rapide pour itérer)
npm run web

# iOS Simulator (nécessite Xcode installé)
npm run ios

# Android Emulator (nécessite Android Studio)
npm run android

# Téléphone réel via Expo Go
npm start         # puis scanner le QR code dans l'app Expo Go
```

## Écrans

| Route | Fichier | Rôle |
|-------|---------|------|
| `/` | `app/index.tsx` | Liste des recettes, FAB "+ Importer" |
| `/import` | `app/import.tsx` | Saisie d'URL + import (POST `/import-recipe`) |
| `/recipe/[id]` | `app/recipe/[id].tsx` | Fiche recette + bouton supprimer |

## Notes

- L'app passe **uniquement par le serveur Railway** — pas de connexion directe à Supabase. Ça nous évite de gérer RLS / clé anon en V1, et ça centralise la logique métier côté serveur.
- Pas d'auth en V1 : toutes les recettes sont visibles. Quand on ajoutera l'auth Supabase, on filtrera côté serveur via `user_id`.
