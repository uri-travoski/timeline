import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react-native';
import { api, filtersToQuery, type Page, type Post } from '../../src/api';
import { activeFilterCount, markRead, useCategories, useFilters, useMe } from '../../src/state';
import { useTheme } from '../../src/theme';
import { PostCard } from '../../src/components/PostCard';
import { FeedHeader } from '../../src/components/Header';
import { Empty, Loading, T } from '../../src/components/ui';

export default function Feed() {
  const t = useTheme();
  const qc = useQueryClient();
  const [filters, setFilters] = useFilters();
  const me = useMe().data;
  const auto = (me?.user.settings.markRead ?? 'auto') === 'auto';
  const cats = useCategories().data ?? [];
  const names = [...new Map(cats.map((c) => [c.name.toLowerCase(), c])).values()];
  const qs = filtersToQuery(filters);
  const q = useInfiniteQuery({
    queryKey: ['posts', qs],
    queryFn: ({ pageParam }) => api.get<Page<Post>>(`/posts?${filtersToQuery(filters, { cursor: pageParam ?? undefined, limit: '20' })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
    refetchInterval: 60_000,
  });
  const posts = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  // Auto mark-as-read: a post counts as read after it has been at least half on screen for ~1.2 s.
  const seen = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const onViewable = useCallback(
    ({ viewableItems, changed }: { viewableItems: ViewToken<Post>[]; changed: ViewToken<Post>[] }) => {
      if (!auto) return;
      for (const c of changed) {
        const p = c.item;
        if (!p || p.isRead) continue;
        if (c.isViewable && !seen.current.has(p.id)) {
          seen.current.set(p.id, setTimeout(() => (markRead(qc, [p.id]), seen.current.delete(p.id)), 1200));
        } else if (!c.isViewable && seen.current.has(p.id)) {
          clearTimeout(seen.current.get(p.id));
          seen.current.delete(p.id);
        }
      }
      void viewableItems;
    },
    [auto, qc],
  );
  const viewability = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const list = useRef<FlashListRef<Post>>(null);

  const active = activeFilterCount(filters);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FeedHeader onHome={() => list.current?.scrollToOffset({ offset: 0, animated: true })} />
      {filters.q ? <T muted size={13} style={{ paddingHorizontal: 16, paddingBottom: 6 }}>Results for “{filters.q}”</T> : null}
      {q.isLoading ? (
        <Loading />
      ) : (
        <FlashList
          ref={list}
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: item.kind === 'reminder' ? 12 : 0, paddingBottom: 8 }}>
              <PostCard post={item} manualRead={!auto} />
            </View>
          )}
          getItemType={(p) => (p.kind === 'reminder' ? 'reminder' : p.attachments.length ? 'media' : 'text')}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          onEndReachedThreshold={0.6}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={viewability}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={t.accent} colors={[t.accent]} />}
          ListEmptyComponent={
            <Empty icon={<Inbox size={40} color={t.muted} />} title={active || filters.q ? 'Nothing matches' : 'Your timeline is empty'}>
              {active || filters.q ? 'Try clearing some filters.' : 'Tap + to write your first post.'}
            </Empty>
          }
          ListFooterComponent={q.isFetchingNextPage ? <Loading /> : <View style={{ height: 24 }} />}
        />
      )}
    </View>
  );
}
