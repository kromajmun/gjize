import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, MealType, RecipeStatus, RecipeSummary } from '../../lib/api';
import { colors, radii, spacing } from '../../lib/theme';

type StatusFilter = 'all' | RecipeStatus;
type MealTypeFilter = 'all' | MealType;
type SortBy = 'recent' | 'oldest' | 'alpha';

const MEAL_TYPE_LABEL: Record<MealType, string> = {
  plat: 'Plat',
  dessert: 'Dessert',
  sauce: 'Sauce',
  boisson: 'Boisson',
};

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'to_test', label: 'À tester' },
  { value: 'validated', label: 'Validées' },
];

const MEAL_TYPE_OPTIONS: { value: MealTypeFilter; label: string }[] = [
  { value: 'all', label: 'Tous types' },
  { value: 'plat', label: 'Plats' },
  { value: 'dessert', label: 'Desserts' },
  { value: 'sauce', label: 'Sauces' },
  { value: 'boisson', label: 'Boissons' },
];

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'recent', label: 'Plus récentes' },
  { value: 'oldest', label: 'Plus anciennes' },
  { value: 'alpha', label: 'A → Z' },
];

export default function HomeScreen() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [mealTypeFilter, setMealTypeFilter] = useState<MealTypeFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [search, setSearch] = useState('');

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['recipes'],
    queryFn: api.listRecipes,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    let arr = data;
    if (statusFilter !== 'all') arr = arr.filter((r) => r.status === statusFilter);
    if (mealTypeFilter !== 'all') arr = arr.filter((r) => r.meal_type === mealTypeFilter);
    const q = search.trim().toLowerCase();
    if (q) arr = arr.filter((r) => r.title.toLowerCase().includes(q));

    const sorted = [...arr];
    if (sortBy === 'recent') {
      sorted.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    } else if (sortBy === 'oldest') {
      sorted.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    } else {
      // localeCompare 'fr' gère correctement l'ordre des accents (é < f).
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
    }
    return sorted;
  }, [data, statusFilter, mealTypeFilter, sortBy, search]);

  const showControls = !!data && data.length > 0;
  const noMatch = !!data && data.length > 0 && filtered.length === 0;

  return (
    <SafeAreaView style={styles.container}>
      {showControls && (
        <View style={styles.controls}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Rechercher une recette…"
            placeholderTextColor={colors.textMuted}
            style={styles.search}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          <View style={styles.dropdownRow}>
            <Dropdown
              title="Statut"
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={setStatusFilter}
            />
            <Dropdown
              title="Type"
              options={MEAL_TYPE_OPTIONS}
              value={mealTypeFilter}
              onChange={setMealTypeFilter}
            />
            <Dropdown
              title="Tri"
              options={SORT_OPTIONS}
              value={sortBy}
              onChange={setSortBy}
            />
          </View>
        </View>
      )}
      <FlatList
        data={filtered}
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
          ) : data && data.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Aucune recette pour l'instant</Text>
              <Text style={styles.emptyText}>
                Colle un lien YouTube ou Instagram pour importer ta première recette.
              </Text>
            </View>
          ) : noMatch ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Rien ne correspond</Text>
              <Text style={styles.emptyText}>
                Essaie d'élargir tes filtres ou de modifier ta recherche.
              </Text>
            </View>
          ) : null
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

function Dropdown<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? '';

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.dropdownButton, pressed && styles.dropdownButtonPressed]}
      >
        <Text style={styles.dropdownLabel} numberOfLines={1}>
          {current}
        </Text>
        <Text style={styles.dropdownChevron}>▾</Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          {/* Pressable interne stoppe la propagation du tap pour ne pas fermer la modal en cliquant dans la carte. */}
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>{title}</Text>
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.modalOption,
                    active && styles.modalOptionActive,
                    pressed && styles.modalOptionPressed,
                  ]}
                >
                  <Text style={[styles.modalOptionText, active && styles.modalOptionTextActive]}>
                    {opt.label}
                  </Text>
                  {active && <Text style={styles.modalOptionCheck}>✓</Text>}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
  controls: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
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
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text,
  },
  dropdownRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dropdownButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  dropdownButtonPressed: { opacity: 0.7 },
  dropdownLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
  },
  dropdownChevron: {
    fontSize: 12,
    color: colors.textMuted,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 27, 22, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  modalTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  modalOptionActive: {
    backgroundColor: colors.accentMuted,
  },
  modalOptionPressed: {
    backgroundColor: colors.bg,
  },
  modalOptionText: {
    fontSize: 15,
    color: colors.text,
  },
  modalOptionTextActive: {
    fontWeight: '600',
    color: colors.accent,
  },
  modalOptionCheck: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.accent,
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
