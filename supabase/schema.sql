-- Schéma Gjize — à coller dans Supabase → SQL Editor → New query → Run
-- Idempotent : peut être ré-exécuté sans casser l'existant.

create extension if not exists "pgcrypto";

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  source_url text not null,
  source_platform text check (source_platform in ('youtube', 'instagram', 'web')),
  title text not null,
  servings integer,
  prep_time_minutes integer,
  cook_time_minutes integer,
  ingredients jsonb not null,
  steps jsonb not null,
  thumbnail_url text,
  raw_transcript text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipes_user_idx on recipes(user_id, created_at desc);

-- V1.3 : ajout de 'web' à source_platform (import de pages web via JSON-LD).
-- ALTER idempotent pour mettre à jour la contrainte sur les bases existantes.
alter table recipes
  drop constraint if exists recipes_source_platform_check;
alter table recipes
  add constraint recipes_source_platform_check
  check (source_platform in ('youtube', 'instagram', 'web'));

-- Catégorisation V1.1 : type de plat (auto à l'import) + statut (manuel).
-- ALTER idempotent pour pouvoir ré-exécuter ce fichier sur une base existante.
alter table recipes add column if not exists meal_type text;
alter table recipes add column if not exists status text;

alter table recipes
  drop constraint if exists recipes_meal_type_check;
alter table recipes
  add constraint recipes_meal_type_check
  check (meal_type in ('plat', 'dessert', 'sauce', 'boisson'));

alter table recipes
  drop constraint if exists recipes_status_check;
alter table recipes
  add constraint recipes_status_check
  check (status in ('to_test', 'validated'));

alter table recipes alter column meal_type set default 'plat';
alter table recipes alter column status set default 'to_test';

update recipes set meal_type = 'plat' where meal_type is null;
update recipes set status = 'to_test' where status is null;

alter table recipes alter column meal_type set not null;
alter table recipes alter column status set not null;

create index if not exists recipes_meal_type_idx on recipes(meal_type);
create index if not exists recipes_status_idx on recipes(status);

-- ----------------------------------------------------------------------------
-- V1.2 — Ingrédients normalisés.
-- "ingredients" = catalogue déduplé (canonical_name unique).
-- "recipe_ingredients" = relation N-N avec quantité/unité spécifiques à la recette.
-- Le champ jsonb recipes.ingredients est conservé comme source d'affichage de la
-- fiche (pas de jointure pour l'écran détail) ; les nouvelles tables servent à
-- l'agrégation (page liste + recherche par ingrédient).
-- ----------------------------------------------------------------------------

create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists ingredients_canonical_name_idx on ingredients(canonical_name);

create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  raw_name text,
  quantity numeric,
  unit text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists recipe_ingredients_recipe_idx on recipe_ingredients(recipe_id);
create index if not exists recipe_ingredients_ingredient_idx on recipe_ingredients(ingredient_id);

alter table ingredients enable row level security;
alter table recipe_ingredients enable row level security;

drop policy if exists "ingredients readable by all" on ingredients;
create policy "ingredients readable by all" on ingredients
  for select using (true);

drop policy if exists "users see own recipe_ingredients" on recipe_ingredients;
create policy "users see own recipe_ingredients" on recipe_ingredients
  for all using (
    exists (select 1 from recipes r where r.id = recipe_id and (r.user_id is null or r.user_id = auth.uid()))
  );

create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists recipe_collections (
  recipe_id uuid references recipes(id) on delete cascade,
  collection_id uuid references collections(id) on delete cascade,
  primary key (recipe_id, collection_id)
);

-- Row-Level Security : un user ne voit que ses propres recettes/collections.
-- Le serveur Railway utilise la service_role key qui bypasse RLS, c'est OK.

alter table recipes enable row level security;
alter table collections enable row level security;
alter table recipe_collections enable row level security;

drop policy if exists "users see own recipes" on recipes;
create policy "users see own recipes" on recipes
  for all using (auth.uid() = user_id);

drop policy if exists "users see own collections" on collections;
create policy "users see own collections" on collections
  for all using (auth.uid() = user_id);

drop policy if exists "users see own recipe_collections" on recipe_collections;
create policy "users see own recipe_collections" on recipe_collections
  for all using (
    exists (select 1 from recipes r where r.id = recipe_id and r.user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Storage : bucket public pour les miniatures de recettes.
-- Le serveur Railway téléchargera les thumbnails depuis YouTube/Instagram et
-- les ré-uploadera ici → URLs stables et permanentes (Instagram expire sinon).
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'thumbnails',
  'thumbnails',
  true,
  5242880, -- 5 Mo, large pour des miniatures
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lecture publique (le bucket public le permet déjà, mais on est explicite).
drop policy if exists "public read thumbnails" on storage.objects;
create policy "public read thumbnails" on storage.objects
  for select using (bucket_id = 'thumbnails');

-- ----------------------------------------------------------------------------
-- Storage : bucket privé pour les "secrets" applicatifs (cookies yt-dlp etc.).
-- Accès uniquement via la service_role key (= le serveur Railway).
-- Aucune policy d'accès public, jamais.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'secrets',
  'secrets',
  false,
  1048576, -- 1 Mo, largement suffisant pour un cookies.txt
  array['text/plain']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
