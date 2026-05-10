import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, MealType, RecipeStatus, RecipeSummary } from '../../lib/api';
import { colors, radii, spacing } from '../../lib/theme';

type StatusFilter = 'all' | RecipeStatus;

const MEAL_TYPE_LABEL: Record<MealType, string> = {
  plat: 'Plat',
  dessert: 'Dessert',
  sauce: 'Sauce',
  boisson: 'Boisson',
};

export default function HomeScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<StatusFilter>('all');

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['recipes'],
    queryFn: api.listRecipes,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === 'all') return data;
    return data.filter((r) => r.status === filter);
  }, [data, filter]);

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          data && data.length > 0 ? (
            <FilterBar filter={filter} onChange={setFilter} />
          ) : null
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : error ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Impossible de joindre le serveur</Text>
              <Text style={styles.emptyText}>{(error as Error).message}</Text>
              <Text style={styles.emptyHint}>
                Vérifie que le backend tourne et que EXPO_PUBLIC_API_URL pointe au bon endroit.
              </Text>
            </View>
          ) : data && data.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Aucune recette pour l'instant</Text>
              <Text style={styles.emptyText}>
                Colle un lien YouTube ou Instagram pour importer ta première recette.
              </Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Rien dans ce filtre</Text>
              <Text style={styles.emptyText}>
                {filter === 'to_test'
                  ? 'Toutes tes recettes sont marquées comme validées.'
                  : 'Aucune recette validée pour l’instant.'}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <RecipeCard recipe={item} onPress={() => router.push(`/recipe/${item.id}`)} />
        )}
      />
      <Pressable
        onPress={() => router.push('/import')}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <Text style={styles.fabIcon}>+</Text>
        <Text style={styles.fabText}>Importer</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function FilterBar({ filter, onChange }: { filter: StatusFilter; onChange: (f: StatusFilter) => void }) {
  const options: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Toutes' },
    { value: 'to_test', label: 'À tester' },
    { value: 'validated', label: 'Validées' },
  ];
  return (
    <View style={styles.filterBar}>
      {options.map((opt) => {
        const active = filter === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.filterPill, active && styles.filterPillActive]}
          >
            <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: 96,
    gap: spacing.md,
    flexGrow: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    minHeight: 240,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  filterBar: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  filterPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  },
  filterPillTextActive: {
    color: '#FFF',
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
  fab: {
    position: 'absolute',
    bottom: spacing.lg,
    right: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 999,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    zIndex: 10,
  },
  fabPressed: { opacity: 0.85 },
  fabIcon: { color: '#FFF', fontSize: 20, fontWeight: '300', lineHeight: 22 },
  fabText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
