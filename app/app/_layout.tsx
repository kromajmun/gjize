import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { colors, fonts } from '../lib/theme';

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTitleStyle: {
            fontFamily: fonts.display,
            fontWeight: '600',
            color: colors.text,
          },
          headerTintColor: colors.accent,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ title: 'Gjizë' }} />
        <Stack.Screen name="import" options={{ title: 'Importer une recette' }} />
        <Stack.Screen name="recipe/[id]" options={{ title: '' }} />
        <Stack.Screen name="ingredients/[id]" options={{ title: '' }} />
      </Stack>
    </QueryClientProvider>
  );
}
