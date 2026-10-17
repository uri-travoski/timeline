import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { RemoteImage } from '../src/components/RemoteImage';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Download, X } from 'lucide-react-native';

export default function Viewer() {
  const { url } = useLocalSearchParams<{ url: string; name?: string }>();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <RemoteImage uri={url} fit="contain" showError />
      <View style={{ position: 'absolute', top: insets.top + 8, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X color="#fff" size={26} />
        </Pressable>
        <Pressable onPress={() => Linking.openURL(`${url}?download=1`)} hitSlop={12}>
          <Download color="#fff" size={24} />
        </Pressable>
      </View>
    </View>
  );
}
