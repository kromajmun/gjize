import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, IngredientSummary } from '../../lib/api';
import { colors, radii, spacing } from '../../lib/theme';

export default function IngredientsScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['ingredients', query],
    queryFn: () => api.listIngredients(query),
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher un ingrédient…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
        />
      </View>
      <FlatList
        data={data ?? []}
        keyExtractor={(i) => i.id}
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
              <Text style={styles.emptyTitle}>Impossible de charger</Text>
              <Text style={styles.emptyText}>{(error as Error).message}</Text>
            </View>
          ) : query ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Aucun résultat pour « {query} »</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Aucun ingrédient pour l'instant</Text>
              <Text style={styles.emptyText}>
                Importe quelques recettes pour remplir le catalogue.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <IngredientRow ingredient={item} onPress={() => router.push(`/ingredients/${item.id}`)} />
        )}
      />
    </SafeAreaView>
  );
}

function IngredientRow({
  ingredient,
  onPress,
}: {
  ingredient: IngredientSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={styles.rowName}>{ingredient.display_name}</Text>
      <Text style={styles.rowCount}>
        {ingredient.recipe_count} {ingredient.recipe_count > 1 ? 'recettes' : 'recette'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
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
    fontSize: 16,
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowPressed: { opacity: 0.7 },
  rowName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    flex: 1,
  },
  rowCount: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
});
