import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
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

export default function ImportScreen() {
  const [url, setUrl] = useState('');
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

  const isValidUrl = /^https?:\/\/.+(youtube\.com|youtu\.be|instagram\.com)/i.test(url.trim());

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
          <Text style={styles.hint}>YouTube ou Instagram. TikTok n'est pas supporté pour l'instant.</Text>

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
            <View style={styles.statusBox}>
              <Text style={styles.statusTitle}>En cours…</Text>
              <Text style={styles.statusText}>
                Téléchargement de l'audio, transcription, puis extraction de la recette.
                Compter 30 secondes à 1 minute selon la durée de la vidéo.
              </Text>
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
  content: { padding: spacing.lg, gap: spacing.md },
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
});
