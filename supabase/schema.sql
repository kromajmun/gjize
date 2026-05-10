-- Schéma Gjize — à coller dans Supabase → SQL Editor → New query → Run
-- Idempotent : peut être ré-exécuté sans casser l'existant.

create extension if not exists "pgcrypto";

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  source_url text not null,
  source_platform text check (source_platform in ('youtube', 'instagram')),
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
