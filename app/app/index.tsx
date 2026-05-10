import { Link, useRouter } from 'expo-router';
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
import { api, RecipeSummary } from '../lib/api';
import { colors, radii, spacing } from '../lib/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['recipes'],
    queryFn: api.listRecipes,
  });

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={data ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />
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
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Aucune recette pour l'instant</Text>
              <Text style={styles.emptyText}>
                Colle un lien YouTube ou Instagram pour importer ta première recette.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <RecipeCard recipe={item} onPress={() => router.push(`/recipe/${item.id}`)} />
        )}
      />
      <Link href="/import" asChild>
        <Pressable style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}>
          <Text style={styles.fabIcon}>+</Text>
          <Text style={styles.fabText}>Importer</Text>
        </Pressable>
      </Link>
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
      {recipe.thumbnail_url ? (
        <Image source={{ uri: recipe.thumbnail_url }} style={styles.cardImage} />
      ) : (
        <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
          <Text style={styles.cardImagePlaceholderText}>🍳</Text>
        </View>
      )}
      <View style={styles.cardBody}>
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
  cardBody: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'space-between',
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
    bottom: spacing.xl,
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
    elevation: 6,
  },
  fabPressed: { opacity: 0.85 },
  fabIcon: { color: '#FFF', fontSize: 20, fontWeight: '300', lineHeight: 22 },
  fabText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
