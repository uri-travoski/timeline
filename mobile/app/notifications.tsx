import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Bell } from 'lucide-react-native';
import { api, type Notification } from '../src/api';
import { timeAgo } from '../src/state';
import { GOLD, GOLD_TINT, useTheme } from '../src/theme';
import { Screen } from '../src/components/Screen';
import { Avatar, Chip, Empty, Loading, Row, T } from '../src/components/ui';

export default function Notifications() {
  const t = useTheme();
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = useQuery({ queryKey: ['notifications', unreadOnly], queryFn: () => api.get<{ unread: number; items: Notification[] }>(`/notifications?limit=100${unreadOnly ? '&unread=true' : ''}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['unread'] });
  };
  const open = async (n: Notification) => {
    if (!n.readAt) await api.post('/notifications/read', { ids: [n.id] }).catch(() => {});
    refresh();
    if (n.type === 'share') router.push('/settings');
    else if (n.postId) router.push(`/post/${n.postId}`);
  };
  return (
    <Screen title="Notifications" back>
      <Row style={{ paddingHorizontal: 14, paddingBottom: 10 }} gap={8}>
        <Chip label={`Unread${q.data ? ` · ${q.data.unread}` : ''}`} on={unreadOnly} onPress={() => setUnreadOnly(true)} />
        <Chip label="All" on={!unreadOnly} onPress={() => setUnreadOnly(false)} />
        <Chip label="Mark all read" onPress={async () => (await api.post('/notifications/read', { all: true }), refresh())} />
      </Row>
      {q.isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={q.data?.items ?? []}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.accent} colors={[t.accent]} />}
          ListEmptyComponent={<Empty icon={<Bell size={40} color={t.muted} />} title={unreadOnly ? "You're all caught up" : 'No notifications yet'} />}
          renderItem={({ item: n }) => (
            <Pressable onPress={() => open(n)} style={{ flexDirection: 'row', gap: 12, padding: 12, borderRadius: 7, backgroundColor: t.card, overflow: 'hidden', borderLeftWidth: n.readAt ? 0 : 3, borderLeftColor: GOLD }}>
              {!n.readAt && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: GOLD_TINT }]} />}
              {n.type === 'reminder' ? (
                <View style={{ width: 40, height: 40, borderRadius: 7, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' }}>
                  <AlarmClock size={19} color="#1a1400" />
                </View>
              ) : n.actor ? (
                <Avatar name={n.actor.name} color={n.actor.color} src={n.actor.avatarUrl} kind={n.actor.kind} size={40} />
              ) : (
                <Avatar name="T" color={t.accent} size={40} />
              )}
              <View style={{ flex: 1 }}>
                <T bold size={14.5}>{n.title}</T>
                {!!n.body && <T muted size={13} numberOfLines={2}>{n.body}</T>}
                <T muted size={11.5} style={{ marginTop: 3 }}>{timeAgo(n.createdAt)}</T>
              </View>
              {!n.readAt && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: GOLD, marginTop: 6 }} />}
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
