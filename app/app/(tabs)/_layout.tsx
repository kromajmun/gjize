import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../lib/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Recettes',
          tabBarIcon: ({ color, size }) => <Text style={{ color, fontSize: size * 0.9 }}>🍽️</Text>,
        }}
      />
      <Tabs.Screen
        name="ingredients"
        options={{
          title: 'Ingrédients',
          tabBarIcon: ({ color, size }) => <Text style={{ color, fontSize: size * 0.9 }}>🥦</Text>,
        }}
      />
    </Tabs>
  );
}
