import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Search, SlidersHorizontal, X } from 'lucide-react-native';
import { useState } from 'react';
import { activeFilterCount, useFilters, useMe, useUnread } from '../state';
import { useTheme } from '../theme';
import { T } from './ui';
import { FilterSheet } from './FilterSheet';

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

export function FeedHeader({ onHome }: { onHome?: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [filters, setFilters] = useFilters();
  const [searching, setSearching] = useState(!!filters.q);
  const [q, setQ] = useState(filters.q ?? '');
  const [sheet, setSheet] = useState(false);
  const active = activeFilterCount(filters);
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
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <T bold size={25} style={{ letterSpacing: -0.5, fontWeight: '900' }}>Timeline</T>
              </Pressable>
            </View>
            <Pressable onPress={() => setSearching(true)} style={{ width: 42, height: 42, borderRadius: 7, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Search">
              <Search color={t.text} size={20} />
            </Pressable>
            <Pressable onPress={() => setSheet(true)} style={{ width: 42, height: 42, borderRadius: 7, backgroundColor: active ? t.accent : t.card, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={active ? `Filters, ${active} active` : 'Filters'}>
              <SlidersHorizontal color={active ? '#fff' : t.text} size={20} />
            </Pressable>
          </>
        )}
        <BellButton />
      </View>
      <FilterSheet open={sheet} onClose={() => setSheet(false)} />
    </View>
  );
}
