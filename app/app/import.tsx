import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { colors, radii, spacing } from '../lib/theme';

const PUSHEEN_GIFS = [
  'https://pusheen.com/wp-content/uploads/2017/10/tumblr_owum6vsKMa1qhy6c9o1_1280.gif',
  'https://pusheen.com/wp-content/uploads/2021/04/How_To_Make_the_Perfect_Birthday_Cake.gif',
  'https://pusheen.com/wp-content/uploads/2020/11/Pusheens-Guide-to-Baking-Substitutions.gif',
  'https://pusheen.com/wp-content/uploads/2020/11/Baking-for-Hamsters-1.gif',
  'https://pusheen.com/wp-content/uploads/2015/03/tumblr_nl86t1fj2w1qhy6c9o1_r2_1280.gif',
  'https://pusheen.com/wp-content/uploads/2021/12/Pusheen_vs_Udon.gif',
  'https://pusheen.com/wp-content/uploads/2015/08/tumblr_nsktwmmPYl1qhy6c9o2_r1_540.gif',
];

// Étapes simulées côté client : le serveur ne stream pas son avancement, on
// affiche les phases dans l'ordre où le pipeline les exécute, avec des durées
// indicatives. La dernière reste affichée jusqu'à la réponse finale.
const IMPORT_STEPS = [
  { label: 'Téléchargement de la vidéo…', delayMs: 0 },
  { label: "Transcription de l'audio…", delayMs: 6000 },
  { label: 'Extraction de la recette par Claude…', delayMs: 16000 },
  { label: 'Sauvegarde…', delayMs: 26000 },
];

export default function ImportScreen() {
  const [url, setUrl] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: api.importRecipe,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      if (data.saved_id) {
        router.replace(`/recipe/${data.saved_id}`);
      } else {
        router.back();
      }
    },
  });

  useEffect(() => {
    if (!mutation.isPending) return;
    setStepIndex(0);
    setGifUrl(PUSHEEN_GIFS[Math.floor(Math.random() * PUSHEEN_GIFS.length)]);
    const timers = IMPORT_STEPS.slice(1).map((step, i) =>
      setTimeout(() => setStepIndex(i + 1), step.delayMs),
    );
    return () => timers.forEach(clearTimeout);
  }, [mutation.isPending]);

  const isValidUrl = /^https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be|instagram\.com)\//i.test(
    url.trim(),
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Lien de la vidéo</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://www.youtube.com/watch?v=..."
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
            editable={!mutation.isPending}
          />
          <Text style={styles.hint}>YouTube ou Instagram.</Text>

          <Pressable
            onPress={() => mutation.mutate(url.trim())}
            disabled={!isValidUrl || mutation.isPending}
            style={({ pressed }) => [
              styles.button,
              (!isValidUrl || mutation.isPending) && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.buttonText}>Importer la recette</Text>
            )}
          </Pressable>

          {mutation.isPending && (
            <View style={styles.progressBox}>
              <Text style={styles.progressStep} numberOfLines={1}>
                {IMPORT_STEPS[stepIndex].label}
              </Text>
              {gifUrl && (
                <Image source={{ uri: gifUrl }} style={styles.progressGif} resizeMode="contain" />
              )}
            </View>
          )}

          {mutation.isError && (
            <View style={[styles.statusBox, styles.statusError]}>
              <Text style={styles.statusTitle}>Échec de l'import</Text>
              <Text style={styles.statusText}>{(mutation.error as Error).message}</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  kav: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  hint: { fontSize: 12, color: colors.textMuted },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  statusBox: {
    backgroundColor: colors.accentMuted,
    padding: spacing.md,
    borderRadius: radii.md,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  statusError: {
    backgroundColor: '#F8E5E2',
  },
  statusTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  statusText: { fontSize: 13, color: colors.text, lineHeight: 18 },
  progressBox: {
    marginTop: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  progressGif: {
    width: '100%',
    maxWidth: 640,
    height: 440,
  },
  progressStep: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    textAlign: 'center',
  },
});
