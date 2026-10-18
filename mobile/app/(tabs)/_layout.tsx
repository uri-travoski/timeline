import { Pressable, View } from 'react-native';
import { Tabs, router, useSegments } from 'expo-router';
import { AlarmClock, Clapperboard, Home, Plus, User } from 'lucide-react-native';
import { useTheme } from '../../src/theme';
import { useTextDelta } from '../../src/text';

export default function TabsLayout() {
  const t = useTheme();
  const textDelta = useTextDelta();
  const seg = useSegments();
  const onReels = seg[seg.length - 1] === 'reels';
  const fg = onReels ? '#fff' : t.text;
  const muted = onReels ? '#9aa0b4' : t.muted;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: fg,
        tabBarInactiveTintColor: muted,
        tabBarStyle: { backgroundColor: onReels ? '#000' : t.panel, borderTopColor: onReels ? '#000' : t.line },
        tabBarLabelStyle: { fontSize: 10.5 + textDelta, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Timeline', tabBarIcon: ({ color }) => <Home color={color} size={24.15} /> }} />
      <Tabs.Screen name="reels" options={{ title: 'Reels', tabBarIcon: ({ color }) => <Clapperboard color={color} size={24.15} /> }} />
      <Tabs.Screen
        name="new"
        options={{
          title: '',
          tabBarButton: () => (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Pressable onPress={() => router.push('/compose')} style={{ width: 50, height: 42, borderRadius: 7, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="New post">
                <Plus color="#fff" size={25.2} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen name="reminders" options={{ title: 'Reminders', tabBarIcon: ({ color }) => <AlarmClock color={color} size={24.15} /> }} />
      <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: ({ color }) => <User color={color} size={24.15} /> }} />
    </Tabs>
  );
}
