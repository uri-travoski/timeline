import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, Inbox, SlidersHorizontal } from 'lucide-react-native';
import { api, filtersToQuery, type Page, type Post } from '../../src/api';
import { activeFilterCount, markRead, useCategories, useFilters, useMe } from '../../src/state';
import { useTheme } from '../../src/theme';
import { PostCard } from '../../src/components/PostCard';
import { FeedHeader } from '../../src/components/Header';
import { FilterSheet } from '../../src/components/FilterSheet';
import { Chip, Empty, Loading, T } from '../../src/components/ui';

export default function Feed() {
  const t = useTheme();
  const qc = useQueryClient();
  const [filters, setFilters] = useFilters();
  const [sheet, setSheet] = useState(false);
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

  const isCat = (n: string) => !!filters.categories?.includes(n);
  const active = activeFilterCount(filters);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FeedHeader onHome={() => list.current?.scrollToOffset({ offset: 0, animated: true })} />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 14, paddingBottom: 10 }}>
          <Chip label={active ? `Filters · ${active}` : 'Filters'} on={active > 0} onPress={() => setSheet(true)} icon={<SlidersHorizontal size={14} color={t.muted} />} />
          <Chip label="All" on={!filters.categories?.length} onPress={() => setFilters({ ...filters, categories: undefined })} />
          {names.map((c) => (
            <Chip key={c.id} label={c.name} color={c.color} on={isCat(c.name)} onPress={() => setFilters({ ...filters, categories: isCat(c.name) ? filters.categories!.filter((x) => x !== c.name) : [...(filters.categories ?? []), c.name] })} />
          ))}
          <Chip label="Unread" on={!!filters.unread} onPress={() => setFilters({ ...filters, unread: !filters.unread })} />
          <Chip label="Videos" icon={<Clapperboard size={14} color={t.muted} />} onPress={() => router.navigate('/reels')} />
        </ScrollView>
      </View>
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
      <FilterSheet open={sheet} onClose={() => setSheet(false)} />
    </View>
  );
}
