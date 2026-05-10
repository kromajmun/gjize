# Gjize — Journal de développement

> Application d'import et d'organisation de recettes depuis des vidéos YouTube et Instagram.

Ce fichier documente l'avancement, les décisions techniques et tout ce qui ne se déduit pas de la simple lecture du code.

---

## État actuel

**Phase : V1 fonctionnelle bout-en-bout — déploiements en cours**

| Composant | Statut |
|-----------|--------|
| Structure du projet | ✅ |
| Backend Express (Railway) | ✅ Live sur `gjize-production.up.railway.app` |
| Base de données Supabase | ✅ Schéma appliqué, persistance OK |
| App Expo (iOS / Android / Web) | ✅ Code prêt |
| App Android standalone (APK via EAS) | 🔧 En cours — eas.json configuré, build à lancer |
| App Web responsive (Railway) | 🔧 En cours — nixpacks + scripts prêts, service à créer |
| Test sur Instagram | ⏳ |

---

## Architecture

```
Gjize/
├── server/          # Backend Express (Railway)
│   └── src/
│       ├── index.js              # Entrée Express + CORS
│       ├── config.js             # Variables d'env validées
│       ├── routes/
│       │   ├── import.js         # POST /import-recipe
│       │   └── recipes.js        # GET /recipes, GET /recipes/:id, DELETE /recipes/:id
│       ├── pipeline/
│       │   ├── download.js       # yt-dlp → audio mp3 (mono 16kHz)
│       │   ├── transcribe.js     # Whisper via fetch natif (undici)
│       │   └── extract.js        # Claude Sonnet 4.6 + tool use
│       └── db/
│           └── supabase.js       # Client + saveRecipe / listRecipes / getRecipe / delete
├── supabase/
│   └── schema.sql                # Schéma à coller dans le SQL Editor
└── app/             # App Expo
    ├── app/
    │   ├── _layout.tsx           # Stack + QueryClient
    │   ├── index.tsx             # Liste des recettes (FlatList)
    │   ├── import.tsx            # Saisie d'URL + import
    │   └── recipe/[id].tsx       # Fiche détaillée + supprimer
    └── lib/
        ├── api.ts                # Wrapper fetch vers le backend
        └── theme.ts              # Couleurs / spacing
```

---

## Bugs rencontrés (et fixés)

### 1. Whisper : `ECONNRESET` sur le upload
**Symptôme** : le SDK OpenAI échoue à uploader l'audio, même sur un fichier valide < 25 Mo.
**Cause** : le SDK OpenAI v4 retombe sur `node-fetch` en interne, et son upload multipart se fait couper sur certains réseaux (les serveurs voient un upload en streaming sans `Content-Length` connu d'avance).
**Fix** : bypass complet du SDK pour `transcribe.js`, utilisation du `fetch` natif de Node 20 (basé sur undici) avec `FormData` standard et un retry exponentiel (`transcribe.js`).

### 2. Supabase : `Node.js 20 detected without native WebSocket support`
**Cause** : le SDK Supabase v2.45+ exige un transport WebSocket explicite si Node < 22, même quand on n'utilise pas le module realtime.
**Fix** : `npm install ws` + `realtime: { transport: WebSocket }` à la création du client (`db/supabase.js`).

---

## Décisions techniques

### Modèle Claude : Sonnet 4.6
- ID exact : `claude-sonnet-4-6`. Pricing : $3 / $15 par million de tokens (input/output).
- L'extraction de recette est une tâche structurée, pas du raisonnement profond → Sonnet suffit largement et coûte ~5× moins cher qu'Opus.

### Tool use plutôt que JSON brut
Le `save_recipe` tool a un `input_schema` strict. Plus fiable que demander "réponds en JSON" — Claude pouvait halluciner des virgules manquantes ou wrap le JSON dans du markdown.

### Prompt caching (5 min)
Le prompt système (~1.5k tokens d'instructions) est cacheable via `cache_control: { type: 'ephemeral' }`. À partir du 2e import dans la même fenêtre de 5 min, on lit le cache plutôt que d'envoyer à nouveau le système → ~90% d'économie sur l'input.

### Whisper via `fetch` natif (pas le SDK OpenAI)
Cf bug #1. L'OpenAI SDK reste utilisé en dépendance pour le helper `toFile`, mais on l'a finalement supprimé du code de transcription au profit d'un appel direct à `https://api.openai.com/v1/audio/transcriptions`.

### App passe uniquement par le serveur, pas directement par Supabase
- Évite de gérer la clé anon Supabase + les politiques RLS en V1 (mono-user, pas d'auth).
- Centralise la logique métier (filtres, validations, futurs hooks).
- Quand on ajoutera l'auth, on filtrera côté serveur via `user_id`.

### CORS permissif (`*`)
Pour la V1 — l'app web Expo doit pouvoir appeler le backend depuis n'importe quelle origine en dev. À durcir quand on aura un domaine Railway en prod.

### Pas de TikTok en V1
yt-dlp gère YouTube et Instagram public — c'est ce dont l'utilisateur a besoin.

### Pas d'auth en V1
Toutes les recettes ont `user_id = null`. Quand on ajoutera l'auth (Supabase magic link probablement), il suffira de scoper `listRecipes` par user_id côté serveur.

### Expo SDK 54 + expo-router v6
- Routing fichier (un fichier = un écran) → moins de boilerplate qu'avec react-navigation.
- TypeScript par défaut, types pour les routes via `experiments.typedRoutes: true`.
- Build Web en mode SPA (`web.output: "single"`) — un seul `index.html`, routing client. Choix forcé par les routes dynamiques (`/recipe/[id]`) dont les IDs sont inconnus à la compilation.

### Distribution Android : APK preview via EAS Build
- Profil `preview` dans `eas.json` avec `android.buildType: "apk"` (vs `app-bundle` qui ne s'installe pas hors Play Store).
- Variable `EXPO_PUBLIC_API_URL` injectée directement dans `eas.json` par profil — le `.env` étant gitignored, il n'est pas visible côté serveur EAS.
- Build cloud, ~15 min, lien APK à télécharger et installer manuellement (sideload). Pas besoin de payer pour Play Store en V1.

### Distribution Web : Railway (2e service)
- Choix de Railway plutôt que Vercel/Netlify pour garder l'écosystème homogène (1 plateforme = 1 dashboard).
- Service séparé du backend, root directory = `app/`, build via `expo export --platform web`, serve avec le package `serve` en mode SPA (`-s`).
- Configuration via `app/nixpacks.toml` pour reproductibilité.

### Responsivité desktop
- `maxWidth: 720` (640 sur l'import) + `alignSelf: 'center'` sur les conteneurs principaux des 3 écrans.
- Invisible sur mobile (largeur écran < maxWidth), centre proprement le contenu sur grand écran. Pas de media queries CSS, fait avec les flex props natives de RN — ça marche pareil sur web et natif.

### Thème : ivoire chaud + accent rouille
Couleurs définies dans `app/lib/theme.ts`. Volontairement pas le défaut "cream + serif italics" qui sort de tous les modèles génératifs — palette de cuisine méditerranéenne, sobre et lisible.

---

## Variables d'environnement

### Backend (`server/.env`)
| Variable | Source |
|----------|--------|
| `ANTHROPIC_API_KEY` | console.anthropic.com → Plans & Billing (recharger pour utiliser l'API) |
| `OPENAI_API_KEY` | platform.openai.com → API Keys |
| `SUPABASE_URL` | supabase.com → Project Settings → API |
| `SUPABASE_SERVICE_KEY` | Idem (clé `service_role`) |
| `PORT` | Railway l'injecte, défaut 3000 en local |

### App (`app/.env`)
| Variable | Valeur |
|----------|--------|
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000` (web), `http://192.168.x.x:3000` (iPhone), `https://....up.railway.app` (prod) |

---

## Endpoints backend

| Méthode | Route | Réponse |
|---------|-------|---------|
| `GET` | `/health` | `{ status, model, whisper, supabase_enabled }` |
| `POST` | `/import-recipe` | `{ recipe, saved_id }` — body `{ url }` |
| `GET` | `/recipes` | `{ recipes: [...] }` — liste antéchronologique |
| `GET` | `/recipes/:id` | `{ recipe }` — recette complète + ingredients/steps |
| `DELETE` | `/recipes/:id` | `{ ok: true }` |

---

## Coûts mesurés

Sur la première vidéo testée (Short YouTube, ~1 min, 1160 Ko d'audio compressé) :
- Whisper : ~$0.006
- Claude (3000 input, 500 output) : ~$0.017
- **Total : ~$0.023 par import**

Avec 5$ chargés sur chaque API : ~290 imports avant de devoir recharger. À 2 imports/semaine, ça tient ~3 ans sur ce solde initial.

---

## Roadmap

- [x] Structure projet + documentation
- [x] Backend Express + healthcheck
- [x] Pipeline yt-dlp + ffmpeg + chunking
- [x] Whisper transcription (avec retry et fetch natif)
- [x] Claude tool use + prompt caching
- [x] Endpoint POST /import-recipe orchestré
- [x] Test bout-en-bout sur YouTube ✅
- [x] Schéma Supabase + persistance
- [x] Endpoints GET/DELETE /recipes
- [x] App Expo (3 écrans + thème + API client)
- [x] Tester l'app sur Android via Expo Go
- [x] Déploiement backend Railway
- [x] Pointer l'app prod sur l'URL Railway
- [x] App responsive desktop (maxWidth centré)
- [ ] Build APK Android standalone via EAS (preview profile)
- [ ] Déploiement web Railway (2e service depuis app/)
- [ ] Tester l'import sur une URL Instagram réelle
- [ ] (Plus tard) Auth Supabase magic link, multi-user
- [ ] (Plus tard) Collections, partage entre devices
- [ ] (Plus tard) Custom domain pour l'app web (gjize.app ?)

---

## Notes pour la suite

- **Re-extraction** : le `raw_transcript` est conservé en DB, donc si on améliore le prompt Claude, on peut re-extraire toutes les recettes existantes sans repayer Whisper.
- **Déduplication URL** : si la même URL est importée 2× (par soi-même ou un autre user), on pourrait servir directement l'extraction existante. À ajouter quand on aura l'auth.
- **Mode hors-ligne** : à l'avenir on pourrait cacher les recettes localement avec `expo-sqlite` pour qu'elles soient consultables sans connexion. Pas une priorité V1.
- **Image hero** : on prend la `thumbnail_url` fournie par yt-dlp (= la miniature YouTube/Instagram). Pas besoin de re-uploader l'image, on pointe directement dessus depuis l'app.
