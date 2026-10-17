import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Search, X } from 'lucide-react-native';
import { useState } from 'react';
import { useFilters, useMe, useUnread } from '../state';
import { useTheme } from '../theme';
import { T } from './ui';

export function BellButton() {
  const t = useTheme();
  const unread = useUnread().data ?? 0;
  return (
    <Pressable onPress={() => router.push('/notifications')} style={{ width: 42, height: 42, borderRadius: 7, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`Notifications, ${unread} unread`}>
      <Bell color={t.text} size={20} />
      {unread > 0 && (
        <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: t.bg }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function TimelineSwitcher() {
  const t = useTheme();
  const me = useMe().data;
  const [filters, setFilters] = useFilters();
  if (!me || me.timelines.length < 2) return null;
  const own = me.timelines[0].id;
  const sel = filters.timelines ?? [own];
  const options = [
    ...me.timelines.map((x) => ({ key: x.id, label: x.mine ? 'Me' : x.name, color: x.color, value: x.mine ? undefined : [x.id] })),
    { key: 'all', label: me.timelines.length === 2 ? `Me + ${me.timelines[1].name}` : 'Combined', color: '', value: ['all'] },
  ];
  const on = (k: string) => (k === 'all' ? sel[0] === 'all' : sel.length === 1 && sel[0] === k && sel[0] !== 'all');
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 4, padding: 4, backgroundColor: t.card, borderRadius: 7, borderWidth: 1, borderColor: t.line }}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => setFilters({ ...filters, timelines: o.value })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 5, backgroundColor: on(o.key) ? t.raised : 'transparent' }}>
          {!!o.color && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: o.color }} />}
          <T size={13.5} bold={on(o.key)} muted={!on(o.key)}>{o.label}</T>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function FeedHeader({ onHome }: { onHome?: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [filters, setFilters] = useFilters();
  const [searching, setSearching] = useState(!!filters.q);
  const [q, setQ] = useState(filters.q ?? '');
  return (
    <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 14, paddingBottom: 8, backgroundColor: t.bg, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {searching ? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.card, borderRadius: 7, borderWidth: 1, borderColor: t.line, paddingHorizontal: 12 }}>
            <Search size={17} color={t.muted} />
            <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Search posts, tags, files…" placeholderTextColor={t.muted} returnKeyType="search"
              onSubmitEditing={() => setFilters({ ...filters, q: q.trim() || undefined })} style={{ flex: 1, color: t.text, paddingVertical: 10, fontSize: 15 }} />
            <Pressable hitSlop={10} onPress={() => (setQ(''), setSearching(false), setFilters({ ...filters, q: undefined }))}>
              <X size={18} color={t.muted} />
            </Pressable>
          </View>
        ) : (
          <>
            <View style={{ flex: 1, flexDirection: 'row' }}>
              <Pressable
                onPress={() => (setQ(''), setFilters({}), onHome?.(), router.navigate('/'))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Timeline home"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <Image source={require('../../assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 7 }} />
                <T bold size={26} style={{ letterSpacing: -0.5 }}>Timeline</T>
              </Pressable>
            </View>
            <Pressable onPress={() => setSearching(true)} style={{ width: 42, height: 42, borderRadius: 7, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Search">
              <Search color={t.text} size={20} />
            </Pressable>
          </>
        )}
        <BellButton />
      </View>
      <TimelineSwitcher />
    </View>
  );
}
