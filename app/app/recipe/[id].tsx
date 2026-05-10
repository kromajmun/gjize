import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, Ingredient, MealType, Recipe, RecipeStatus } from '../../lib/api';
import { colors, radii, spacing } from '../../lib/theme';

const MEAL_TYPE_LABEL: Record<MealType, string> = {
  plat: 'Plat',
  dessert: 'Dessert',
  sauce: 'Sauce',
  boisson: 'Boisson',
};

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: recipe, isLoading, error } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => api.getRecipe(id),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteRecipe(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      router.back();
    },
  });

  const statusMutation = useMutation({
    mutationFn: (next: RecipeStatus) => api.updateRecipe(id, { status: next }),
    onMutate: async (next) => {
      // Optimistic update : on bascule l'UI immédiatement, le rollback gérera l'échec.
      await queryClient.cancelQueries({ queryKey: ['recipe', id] });
      const previous = queryClient.getQueryData<Recipe>(['recipe', id]);
      if (previous) {
        queryClient.setQueryData<Recipe>(['recipe', id], { ...previous, status: next });
      }
      return { previous };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['recipe', id], ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['recipe', id] });
    },
  });

  const confirmDelete = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Supprimer cette recette ?')) deleteMutation.mutate();
      return;
    }
    Alert.alert('Supprimer', 'Supprimer cette recette ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (error || !recipe) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorTitle}>Recette introuvable</Text>
        <Text style={styles.errorText}>
          {(error as Error)?.message ?? 'Cette recette a peut-être été supprimée.'}
        </Text>
      </SafeAreaView>
    );
  }

  const totalMinutes =
    (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0) || null;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={confirmDelete} hitSlop={12} style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <Text style={styles.deleteHeader}>Supprimer</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {recipe.thumbnail_url && (
          <Image source={{ uri: recipe.thumbnail_url }} style={styles.hero} />
        )}

        <View style={styles.body}>
          <Text style={styles.eyebrow}>{MEAL_TYPE_LABEL[recipe.meal_type]}</Text>
          <Text style={styles.title}>{recipe.title}</Text>

          <View style={styles.metaRow}>
            <Pressable onPress={() => Linking.openURL(recipe.source_url)}>
              <Text style={styles.sourceLink}>Voir la vidéo source ↗</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() =>
              statusMutation.mutate(recipe.status === 'to_test' ? 'validated' : 'to_test')
            }
            disabled={statusMutation.isPending}
            style={({ pressed }) => [
              styles.statusToggle,
              recipe.status === 'validated' && styles.statusToggleValidated,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              style={[
                styles.statusToggleText,
                recipe.status === 'validated' && styles.statusToggleTextValidated,
              ]}
            >
              {recipe.status === 'to_test' ? '◯ À tester · marquer validée' : '✓ Validée · marquer à tester'}
            </Text>
          </Pressable>

          {(totalMinutes || recipe.servings) && (
            <View style={styles.statsRow}>
              {recipe.prep_time_minutes ? (
                <Stat label="Préparation" value={`${recipe.prep_time_minutes} min`} />
              ) : null}
              {recipe.cook_time_minutes ? (
                <Stat label="Cuisson" value={`${recipe.cook_time_minutes} min`} />
              ) : null}
              {recipe.servings ? <Stat label="Portions" value={String(recipe.servings)} /> : null}
            </View>
          )}

          <Section title="Ingrédients">
            {recipe.ingredients.map((ing, i) => (
              <IngredientRow key={`${ing.name}-${i}`} ingredient={ing} />
            ))}
          </Section>

          <Section title="Étapes">
            {recipe.steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <Text style={styles.stepNumber}>{i + 1}</Text>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </Section>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function IngredientRow({ ingredient }: { ingredient: Ingredient }) {
  const qty =
    ingredient.quantity != null
      ? `${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ''}`
      : ingredient.unit ?? '';
  return (
    <View style={styles.ingredientRow}>
      <Text style={styles.ingredientName}>{ingredient.name}</Text>
      {qty ? <Text style={styles.ingredientQty}>{qty}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  errorTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  errorText: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  content: {
    paddingBottom: spacing.xxl,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  hero: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.accentMuted },
  body: { padding: spacing.lg, gap: spacing.lg },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: -spacing.md,
  },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, lineHeight: 32 },
  metaRow: { marginTop: -spacing.sm },
  sourceLink: { color: colors.accent, fontSize: 14, fontWeight: '500' },
  statusToggle: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  statusToggleValidated: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.success,
  },
  statusToggleText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  statusToggleTextValidated: {
    color: colors.success,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  stat: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 96,
  },
  statValue: { fontSize: 16, fontWeight: '600', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  section: { gap: spacing.sm },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  sectionBody: { gap: spacing.sm },
  ingredientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  ingredientName: { flex: 1, fontSize: 15, color: colors.text },
  ingredientQty: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  stepRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentMuted,
    color: colors.accent,
    fontWeight: '700',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 28,
  },
  stepText: { flex: 1, fontSize: 15, color: colors.text, lineHeight: 22 },
  deleteHeader: { color: colors.danger, fontSize: 15, fontWeight: '500' },
});
