// Crée (ou met à jour) le bucket Supabase Storage `thumbnails`.
// Idempotent : peut être ré-exécuté sans risque.
//
// Usage : depuis server/ → `node scripts/setup-thumbnails-bucket.js`

import 'dotenv/config';
import { getSupabase } from '../src/db/supabase.js';

const supabase = getSupabase();
if (!supabase) {
  console.error('Supabase non configuré (SUPABASE_URL / SUPABASE_SERVICE_KEY manquants).');
  process.exit(1);
}

const bucketConfig = {
  public: true,
  fileSizeLimit: 5 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
};

const { data: existing } = await supabase.storage.getBucket('thumbnails');
if (existing) {
  console.log('Bucket "thumbnails" existe déjà — mise à jour de la config.');
  const { error } = await supabase.storage.updateBucket('thumbnails', bucketConfig);
  if (error) {
    console.error('Erreur update :', error.message);
    process.exit(1);
  }
  console.log('✓ Bucket à jour.');
  process.exit(0);
}

console.log('Création du bucket "thumbnails"…');
const { error } = await supabase.storage.createBucket('thumbnails', bucketConfig);
if (error) {
  console.error('Erreur création :', error.message);
  process.exit(1);
}
console.log('✓ Bucket créé (public, max 5 Mo, jpg/png/webp/gif).');
