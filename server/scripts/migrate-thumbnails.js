// Re-télécharge les miniatures CDN (YouTube/Instagram) des recettes existantes
// et les ré-upload dans Supabase Storage. À lancer une seule fois après avoir
// déployé le code qui utilise le bucket `thumbnails`.
//
// Usage : depuis server/ → `node scripts/migrate-thumbnails.js`
// Le script lit server/.env (credentials Supabase) et tape la DB de prod.

import 'dotenv/config';
import { getSupabase, uploadThumbnailFromUrl } from '../src/db/supabase.js';

const supabase = getSupabase();
if (!supabase) {
  console.error('Supabase non configuré (SUPABASE_URL / SUPABASE_SERVICE_KEY manquants).');
  process.exit(1);
}

const { data: rows, error } = await supabase
  .from('recipes')
  .select('id, source_url, thumbnail_url')
  .not('thumbnail_url', 'is', null);

if (error) {
  console.error('Erreur récupération recettes :', error.message);
  process.exit(1);
}

const supabaseHost = new URL(process.env.SUPABASE_URL).host;
console.log(`${rows.length} recette(s) avec thumbnail à inspecter.`);

let migrated = 0;
let alreadyOk = 0;
let failed = 0;

for (const row of rows) {
  if (row.thumbnail_url.includes(supabaseHost)) {
    alreadyOk += 1;
    continue;
  }

  console.log(`→ ${row.id} : migration depuis ${row.thumbnail_url.slice(0, 80)}…`);
  const newUrl = await uploadThumbnailFromUrl(row.source_url, row.thumbnail_url);

  if (!newUrl) {
    failed += 1;
    console.warn(`  ✗ échec (URL CDN probablement expirée ou 404), thumbnail_url inchangé.`);
    continue;
  }

  const { error: updateErr } = await supabase
    .from('recipes')
    .update({ thumbnail_url: newUrl })
    .eq('id', row.id);

  if (updateErr) {
    failed += 1;
    console.warn(`  ✗ update DB échec : ${updateErr.message}`);
    continue;
  }

  migrated += 1;
  console.log(`  ✓ ok`);
}

console.log(
  `\nRésumé : ${migrated} migrée(s), ${alreadyOk} déjà sur Storage, ${failed} en échec.`,
);
process.exit(0);
