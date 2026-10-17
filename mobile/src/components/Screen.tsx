import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useTheme } from '../theme';
import { T } from './ui';

/** Screen with a simple title bar (and back button when pushed on the stack). */
export function Screen({ title, back, right, children }: { title: string; back?: boolean; right?: ReactNode; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {back && (
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12}>
            <ArrowLeft color={t.text} size={24} />
          </Pressable>
        )}
        <T bold size={back ? 20 : 26} style={{ flex: 1, letterSpacing: -0.4 }}>{title}</T>
        {right}
      </View>
      {children}
    </View>
  );
}
