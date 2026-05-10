import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, MealType, RecipeSummary } from '../../lib/api';
import { colors, radii, spacing } from '../../lib/theme';

const MEAL_TYPE_LABEL: Record<MealType, string> = {
  plat: 'Plat',
  dessert: 'Dessert',
  sauce: 'Sauce',
  boisson: 'Boisson',
};

export default function IngredientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ['ingredient', id],
    queryFn: () => api.getIngredient(id),
  });

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: data?.ingredient.display_name ?? '' }} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Impossible de charger</Text>
          <Text style={styles.emptyText}>{(error as Error).message}</Text>
        </View>
      ) : (
        <FlatList
          data={data?.recipes ?? []}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={styles.subtitle}>
              {(data?.recipes.length ?? 0) > 1
                ? `${data?.recipes.length} recettes utilisent ${data?.ingredient.display_name.toLowerCase()}`
                : `1 recette utilise ${data?.ingredient.display_name.toLowerCase()}`}
            </Text>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>Aucune recette liée</Text>
            </View>
          }
          renderItem={({ item }) => (
            <RecipeCard recipe={item} onPress={() => router.push(`/recipe/${item.id}`)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function RecipeCard({ recipe, onPress }: { recipe: RecipeSummary; onPress: () => void }) {
  const totalMinutes =
    (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0) || null;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View>
        {recipe.thumbnail_url ? (
          <Image source={{ uri: recipe.thumbnail_url }} style={styles.cardImage} />
        ) : (
          <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
            <Text style={styles.cardImagePlaceholderText}>🍳</Text>
          </View>
        )}
        {recipe.status === 'to_test' && (
          <View style={styles.cardStatusBadge}>
            <Text style={styles.cardStatusBadgeText}>À tester</Text>
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.cardMealType}>{MEAL_TYPE_LABEL[recipe.meal_type]}</Text>
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {recipe.title}
        </Text>
        <View style={styles.cardMeta}>
          <Text style={styles.cardMetaText}>{recipe.source_platform}</Text>
          {totalMinutes ? (
            <>
              <Text style={styles.cardMetaSep}>·</Text>
              <Text style={styles.cardMetaText}>{totalMinutes} min</Text>
            </>
          ) : null}
          {recipe.servings ? (
            <>
              <Text style={styles.cardMetaSep}>·</Text>
              <Text style={styles.cardMetaText}>{recipe.servings} pers.</Text>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPressed: { opacity: 0.7 },
  cardImage: {
    width: 100,
    height: 100,
    backgroundColor: colors.accentMuted,
  },
  cardImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImagePlaceholderText: { fontSize: 32 },
  cardStatusBadge: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  cardStatusBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  cardBody: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  cardTopRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  cardMealType: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
    backgroundColor: colors.accentMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    overflow: 'hidden',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  cardMetaText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  cardMetaSep: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
