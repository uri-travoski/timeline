import { Alert, FlatList, View } from 'react-native';
import { RemoteImage } from '../src/components/RemoteImage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react-native';
import { abs, api, type Post } from '../src/api';
import { timeAgo } from '../src/state';
import { useTheme } from '../src/theme';
import { Screen } from '../src/components/Screen';
import { Button, Empty, Loading, Row, T } from '../src/components/ui';

export default function Trash() {
  const t = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['trash'], queryFn: () => api.get<{ posts: Post[] }>('/trash') });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['trash'] });
    qc.invalidateQueries({ queryKey: ['posts'] });
    qc.invalidateQueries({ queryKey: ['reels'] });
  };
  return (
    <Screen title="Recycle bin" back right={<Button title="Empty" kind="danger" style={{ paddingVertical: 6 }} disabled={!q.data?.posts.length} onPress={() => Alert.alert('Empty the recycle bin?', 'Everything in it is deleted forever, files included.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Empty', style: 'destructive', onPress: async () => (await api.del('/trash'), refresh()) }])} />}>
      {q.isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={q.data?.posts ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          ListEmptyComponent={<Empty icon={<Trash2 size={40} color={t.muted} />} title="Recycle bin is empty">Deleted posts stay here for 30 days.</Empty>}
          renderItem={({ item: p }) => (
            <Row style={{ padding: 12, borderRadius: 7, backgroundColor: t.card, borderWidth: 1, borderColor: t.line }} gap={10}>
              <RemoteImage uri={abs(p.attachments[0]?.thumbUrl)} style={{ width: 48, height: 48, borderRadius: 5 }} />
              <View style={{ flex: 1 }}>
                <T numberOfLines={2}>{p.title || p.body || '(no text)'}</T>
                <T muted size={12}>deleted {timeAgo(p.deletedAt!)} · {p.attachments.length} file(s)</T>
              </View>
              <Button title="Restore" onPress={async () => (await api.post(`/trash/post/${p.id}/restore`), refresh())} style={{ paddingVertical: 6 }} />
            </Row>
          )}
        />
      )}
    </Screen>
  );
}
