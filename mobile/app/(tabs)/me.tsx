import { Alert, Pressable, ScrollView, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Bot, Camera, ChevronRight, LogOut, Settings, Trash2 } from 'lucide-react-native';
import { api, session, uploadAvatar } from '../../src/api';
import { useMe, useUnread } from '../../src/state';
import { useTheme } from '../../src/theme';
import { Screen } from '../../src/components/Screen';
import { Avatar, Button, Card, T } from '../../src/components/ui';

export default function Me() {
  const t = useTheme();
  const me = useMe().data;
  const unread = useUnread().data ?? 0;
  const qc = useQueryClient();
  const rows = [
    { to: '/notifications', icon: Bell, label: 'Notifications', badge: unread },
    { to: '/agents', icon: Bot, label: 'AI agents' },
    { to: '/trash', icon: Trash2, label: 'Recycle bin' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ] as const;
  const refresh = () => {
    for (const k of ['me', 'posts', 'reels', 'comments']) qc.invalidateQueries({ queryKey: [k] });
  };
  const pickAvatar = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (r.canceled) return;
    try {
      await uploadAvatar(r.assets[0].uri, r.assets[0].mimeType ?? 'image/jpeg');
      refresh();
    } catch (e) {
      Alert.alert('Could not update picture', (e as Error).message);
    }
  };
  const avatarMenu = () =>
    Alert.alert('Profile picture', undefined, [
      { text: 'Choose a photo', onPress: pickAvatar },
      ...(me?.user.avatarUrl ? [{ text: 'Remove picture', style: 'destructive' as const, onPress: async () => (await api.del('/me/avatar').catch(() => {}), refresh()) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  return (
    <Screen title="Me">
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
        {me && (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={avatarMenu} accessibilityLabel="Change profile picture" hitSlop={6}>
              <Avatar name={me.user.name} color={me.user.color} src={me.user.avatarUrl} size={64} />
              <View style={{ position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: t.accent, borderWidth: 2, borderColor: t.card, alignItems: 'center', justifyContent: 'center' }}>
                <Camera size={11} color="#fff" />
              </View>
            </Pressable>
            <View>
              <T bold size={18}>{me.user.name}</T>
              <T muted size={13}>{me.user.email}</T>
              <T muted size={12}>{session.server}</T>
            </View>
          </Card>
        )}
        <Card style={{ padding: 0 }}>
          {rows.map((r, i) => (
            <Pressable key={r.to} onPress={() => router.push(r.to)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderTopWidth: i ? 1 : 0, borderColor: t.line }}>
              <r.icon size={21} color={t.muted} />
              <T style={{ flex: 1 }}>{r.label}</T>
              {'badge' in r && r.badge > 0 && (
                <View style={{ backgroundColor: t.danger, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 }}>
                  <T bold size={12} style={{ color: '#fff' }}>{r.badge}</T>
                </View>
              )}
              <ChevronRight size={18} color={t.muted} />
            </Pressable>
          ))}
        </Card>
        <Button
          title="Sign out"
          icon={<LogOut size={18} color={t.danger} />}
          onPress={async () => {
            await api.post('/auth/logout').catch(() => {});
            qc.clear();
            await session.signOut();
          }}
        />
      </ScrollView>
    </Screen>
  );
}
