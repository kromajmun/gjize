# Gjize — Journal de développement

> Application d'import et d'organisation de recettes depuis des vidéos YouTube/Instagram et des pages web (JSON-LD schema.org).

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
| App Web responsive (Railway) | ✅ Live, SPA mode |
| Catégorisation (meal_type auto + status manuel) | ✅ V1.1 |
| Catalogue ingrédients normalisé (recherche, regroupement) | ✅ V1.2 |
| Filtres + tri + recherche sur la liste de recettes | ✅ V1.3 |
| Import depuis pages web (JSON-LD schema.org/Recipe) | ✅ V1.4 |
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
│       │   ├── download.js       # yt-dlp → audio mp3 (mono 16kHz) + detectPlatform
│       │   ├── transcribe.js     # Whisper via fetch natif (undici)
│       │   ├── scrape.js         # Pages web → JSON-LD schema.org/Recipe (cheerio)
│       │   └── extract.js        # Claude Sonnet 4.6 + tool use (vidéo OU JSON-LD)
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

### Auth via cookies (Instagram **et** YouTube — compte dédié)
- **Pourquoi** : yt-dlp en anonyme se fait jeter — Instagram avec "rate-limit reached or login required" (la tendance long-terme est claire : Instagram exige une session), et YouTube depuis Railway avec "Sign in to confirm you're not a bot" (les IP datacenter sont bloquées de plus en plus agressivement par YouTube).
- **Pattern utilisé** : un compte dédié à Gjize sur chaque plateforme (créé sur un email à part). Ses cookies de session sont uploadés dans Supabase Storage et lus par le serveur. Le compte principal de l'utilisateur n'est jamais exposé.
- **Stockage** : bucket privé `secrets` (Supabase Storage), fichiers `instagram_cookies.txt` et `youtube_cookies.txt` au format Netscape. Accessibles uniquement via la `service_role` key côté serveur.
- **Pas d'endpoint admin** : la rotation se fait directement via l'interface web Supabase (Dashboard > Storage > secrets > replace). Pas de UI custom à maintenir.
- **Cache TTL 1 min par plateforme** : le serveur retélécharge le fichier au plus toutes les 60s. Une nouvelle version est donc prise en compte rapidement après l'upload. L'absence du fichier est aussi cachée pour ne pas re-tenter Storage à chaque import.
- **Obligatoire vs optionnel** :
  - Instagram : **obligatoire**. Sans cookies, le pipeline coupe court avec un message d'upload.
  - YouTube : **optionnel mais utilisés si présents**. Si le bot check apparaît, le serveur invalide le cache et demande à l'utilisateur d'uploader (ou rotater) `youtube_cookies.txt`.
- **Détection d'expiration** : si yt-dlp échoue avec un pattern d'auth, le serveur invalide le cache de la plateforme concernée et renvoie un message actionnable à l'app ("Cookies Instagram expirés…" / "YouTube demande une vérification 'I'm not a bot'…").
- **Espérance de vie** : quelques jours à quelques semaines. Refaire la procédure de rotation quand l'erreur apparaît.
- **Code** : `getCookiesPath(platform)` / `invalidateCookiesCache(platform)` dans `server/src/db/supabase.js`.

#### Procédure de rotation des cookies (à faire à chaque expiration)
1. Ouvre Chrome avec le **compte Gjize dédié à la plateforme** (pas le compte principal).
2. Visite `instagram.com` ou `youtube.com`, vérifie que la session est bien active.
3. Installe l'extension **"Get cookies.txt LOCALLY"** si pas déjà fait (extension open-source, ne télécharge rien en ligne).
4. Sur le site concerné, clique sur l'extension > "Export" au format **Netscape** (.txt).
5. Va dans Supabase Dashboard > **Storage** > bucket **`secrets`**.
6. Si le fichier (`instagram_cookies.txt` ou `youtube_cookies.txt`) existe déjà : clique dessus > **Replace**. Sinon : drag-and-drop le fichier exporté en le **renommant** au bon nom.
7. C'est tout — le serveur prendra en compte la nouvelle version au prochain import (max 1 min).

#### Pour garder les comptes dédiés "actifs"
- Logge-toi 30 secondes une fois par mois pour scroller le feed (Instagram) / regarder une vidéo (YouTube) depuis Chrome — juste pour que la plateforme ne marque pas le compte comme dormant.
- Suivre / s'abonner à quelques comptes cuisine populaires augmente la vraisemblance du profil.

### Catalogue d'ingrédients V1.2 : tables normalisées + recherche
- **Modèle DB** : `ingredients` (`canonical_name` UNIQUE) + table de jointure `recipe_ingredients` avec `raw_name`/`quantity`/`unit`/`position`. Le jsonb `recipes.ingredients` reste source de vérité pour l'affichage de la fiche (pas de jointure pour rien) ; les tables relationnelles servent à l'agrégation (catalogue + recherche par ingrédient).
- **Pourquoi `canonical_name`** : "courgettes jaunes", "courgette", "1 grosse courgette" doivent toutes mapper sur la même entité pour permettre `Courgette · 5 recettes`. Claude renvoie ce champ pendant l'extraction au même moment que `name`/`quantity`/`unit`. Règles : singulier, lowercase, on ne sur-simplifie pas les composés ("huile d'olive" reste "huile d'olive", pas "huile").
- **Recherche** : ILIKE `%q%` sur `canonical_name`. Pas de full-text/trigram pour l'instant — pour ~100 ingrédients la perf est négligeable et la simplicité l'emporte.
- **Migration des recettes existantes** : `node server/scripts/migrate-ingredients.js`. Stratégie 1-shot : un seul appel Claude avec tous les noms uniques de toutes les recettes pour obtenir un mapping `name → canonical_name` global, puis remplissage des tables. Idempotent (skip les recettes déjà liées).
- **Lecture côté app** : `getRecipeById` joint `recipe_ingredients` + `ingredients` pour exposer `ingredient_id` à l'UI. Si la jointure est vide (recette pré-migration), l'app retombe sur le jsonb. Les ingrédients tappables (couleur accent) signalent qu'on peut naviguer vers `/ingredients/:id`.
- **Navigation** : refonte en bottom tabs (`(tabs)/index` + `(tabs)/ingredients`). Le Stack racine garde `import`, `recipe/[id]` et `ingredients/[id]` au-dessus pour les vues détaillées.

### Filtres / tri / recherche V1.3 : tout côté client

- **Pourquoi côté client** : `listRecipes` plafonne à 100 entrées, c'est négligeable. On évite un aller-retour réseau à chaque keystroke / changement de pill, et on garde l'écran réactif quand le réseau est lent.
- **Axes** : 4 contrôles cumulables — recherche par titre (substring case-insensitive), filtre statut (`Toutes` / `À tester` / `Validées`), filtre type de plat (`Tous types` / `Plats` / `Desserts` / `Sauces` / `Boissons`), tri (`Plus récentes` / `Plus anciennes` / `A → Z`).
- **Cumul** : un seul `useMemo` applique tous les filtres en chaîne puis trie. Pas de logique async, pas de cache, le réétat dérivé est instantané.
- **Tri alphabétique** : `localeCompare(b, 'fr', { sensitivity: 'base' })` — gère les accents (é équivalent à e pour le classement) et la casse. Important pour ne pas voir "Île flottante" relégué après "Zucchini".
- **UI** : barre de recherche + une seule rangée de 3 dropdowns (Statut / Type / Tri). Chaque dropdown ouvre une `Modal` plein écran avec backdrop semi-opaque et carte centrée listant les options ; l'option courante est marquée d'un check. Choix dropdown plutôt que pills horizontales pour économiser l'espace vertical (gain ~80px) et garder le header compact même quand on ajoutera d'autres axes. Header sticky (sorti de la `FlatList`, pas en `ListHeaderComponent`) pour ne pas perdre le focus du `TextInput` au re-render.
- **Empty state contextualisé** : "Aucune recette" si la base est vide, "Rien ne correspond" si les filtres excluent tout.

### Catégorisation V1.1 : `meal_type` auto + `status` manuel
- **`meal_type`** (`plat` | `dessert` | `sauce` | `boisson`) : extrait automatiquement par Claude pendant `extractRecipe`. Enum strict côté tool schema → pas d'incohérences ("italien" / "italienne" / "Italie"). Défaut `plat` si Claude est en panne.
- **`status`** (`to_test` | `validated`) : entièrement manuel, défaut DB `to_test` à l'import. Toggle d'un tap dans la fiche détaillée.
- **Pourquoi pas plus d'axes** (cuisine, régime, tags libres) : risque d'incohérences pour peu de gain — l'utilisateur sait déjà végétaliser, fusionne souvent les cuisines, et redoute la dérive sémantique des tags libres.
- **Schéma DB** : valeurs ASCII (`to_test` / `validated`) pour éviter les pièges encoding/comparaison ; mapping vers labels FR ("À tester" / "Validée") fait dans l'UI uniquement.
- **Endpoint** : `PATCH /recipes/:id` accepte `{ status, meal_type }` partiel. Toggle status dans la fiche utilise un optimistic update React Query.

### Import web V1.4 : JSON-LD-first, pas de fallback

- **Détection** : `detectPlatform(url)` renvoie maintenant `'web'` pour toute URL http(s) qui n'est ni YouTube ni Instagram. Plus de white-list de domaines — le pipeline tente le scraping et remonte une erreur claire si ça ne passe pas.
- **Stratégie** : aller chercher la balise `<script type="application/ld+json">` qui contient un noeud `@type: "Recipe"` (schema.org). 90%+ des gros sites de recettes français l'exposent (Marmiton, Cuisine AZ, 750g, Cuisine Actuelle, etc.). Mapping direct des champs : `name`, `recipeIngredient`, `recipeInstructions` (avec `HowToStep` / `HowToSection`), `prepTime` / `cookTime` (ISO 8601), `recipeYield`, `image`.
- **Pourquoi pas de fallback HTML/LLM** : décision V1 pour rester simple — si pas de JSON-LD, on remonte une erreur explicite à l'utilisateur ("aucune donnée structurée trouvée"). On verra plus tard si le besoin de fallback se confirme.
- **Pourquoi quand même Claude** : `recipeIngredient` schema.org est une liste de strings brutes ("200 g de farine", "Pour la pâte", "2 œufs"). Sans LLM, on n'a ni `canonical_name` (le catalogue normalisé V1.2 ne marche plus) ni détection des titres de section, ni `meal_type`. Un appel Claude court avec un system prompt dédié (`extractRecipeFromJsonLd`) gère la normalisation. Le titre, les étapes et les durées sont passés tels quels — Claude est instruit de les recopier sans inventer.
- **Coût** : ordre de grandeur identique à un import vidéo (~$0.002 par recette web pour Sonnet 4.6), donc 0 transcription Whisper → moins cher qu'un import vidéo.
- **`raw_transcript`** : la colonne sert maintenant aussi à stocker le JSON-LD source sérialisé pour les imports web (utile si on améliore le prompt Claude plus tard). À ne pas renommer pour ne pas casser les requêtes — sémantiquement c'est devenu `raw_content`.
- **User-Agent** : envoi d'un UA Chrome desktop pour ne pas se faire jeter en 403 par certains sites.
- **Thumbnail** : extraite depuis `image` du JSON-LD (string, array, ou `ImageObject`) puis fallback `<meta property="og:image">`. Upload Supabase Storage identique au pipeline vidéo (`uploadThumbnailFromUrl`).
- **Schema DB** : `source_platform` accepte maintenant `'web'` en plus de `'youtube'` / `'instagram'`. ALTER idempotent dans `schema.sql` à ré-exécuter.

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
| `GET` | `/recipes/:id` | `{ recipe }` — recette complète + ingredients/steps + recipe_ingredients (joint) |
| `PATCH` | `/recipes/:id` | `{ recipe }` — body `{ status?, meal_type? }` (partiel) |
| `DELETE` | `/recipes/:id` | `{ ok: true }` |
| `GET` | `/ingredients` | `{ ingredients: [{ id, canonical_name, display_name, recipe_count }] }` — query param optionnel `?q=` pour filtrer (ILIKE) |
| `GET` | `/ingredients/:id` | `{ ingredient, recipes }` — détail + recettes liées |

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
- [x] Build APK Android standalone via EAS (preview profile)
- [x] Déploiement web Railway (2e service depuis app/)
- [x] Stockage des miniatures dans Supabase Storage (vs CDN direct)
- [x] Catégorisation V1.1 : `meal_type` auto à l'import + `status` manuel (à tester / validée)
- [x] Catalogue ingrédients V1.2 : tables normalisées, recherche, page dédiée, ingrédients tappables sur la fiche recette
- [x] Auth Instagram via cookies depuis Supabase Storage (compte dédié, rotation manuelle via dashboard)
- [x] Auth YouTube via cookies (optionnel) — même mécanisme, contourne le bot check sur IP Railway
- [x] Filtres / tri / recherche sur la liste de recettes (V1.3)
- [x] Import depuis pages web via JSON-LD schema.org/Recipe (V1.4)
- [ ] Tester l'import sur une URL Instagram réelle
- [ ] (Plus tard) Auth Supabase magic link, multi-user
- [ ] (Plus tard) Collections, partage entre devices
- [ ] (Plus tard) Custom domain pour l'app web (gjize.app ?)

---

## Notes pour la suite

- **Re-extraction** : le `raw_transcript` est conservé en DB, donc si on améliore le prompt Claude, on peut re-extraire toutes les recettes existantes sans repayer Whisper.
- **Déduplication URL** : si la même URL est importée 2× (par soi-même ou un autre user), on pourrait servir directement l'extraction existante. À ajouter quand on aura l'auth.
- **Mode hors-ligne** : à l'avenir on pourrait cacher les recettes localement avec `expo-sqlite` pour qu'elles soient consultables sans connexion. Pas une priorité V1.
- **Image hero** : la miniature est désormais re-uploadée dans Supabase Storage (bucket public `thumbnails`) pendant l'import. Le pointage direct vers le CDN YouTube/Instagram était fragile — Instagram signe ses URLs avec une expiration de quelques heures, et `maxresdefault.jpg` YouTube renvoie parfois 404. Cache CDN Supabase 7j, fallback sur l'URL d'origine si l'upload échoue.
  - Helper : `uploadThumbnailFromUrl()` dans `db/supabase.js`.
  - Migration des recettes existantes : `node server/scripts/migrate-thumbnails.js` (script idempotent).
