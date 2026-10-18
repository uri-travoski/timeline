import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Inbox, SlidersHorizontal } from 'lucide-react';
import { api, filtersToQuery, type Page, type Post } from '../lib/api';
import { countActiveFilters, useFilters, useMe } from '../lib/hooks';
import { PostCard } from '../components/PostCard';
import { FilterPanel } from '../components/Filters';
import { Empty, Modal, Spinner } from '../components/ui';

export function usePostsQuery(filters: ReturnType<typeof useFilters>[0]) {
  const qs = filtersToQuery(filters);
  return useInfiniteQuery({
    queryKey: ['posts', qs],
    queryFn: ({ pageParam }) => api.get<Page<Post>>(`/posts?${filtersToQuery(filters, { cursor: pageParam ?? undefined, limit: '20' })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 60_000,
  });
}

export default function Feed() {
  const [filters, set, clear] = useFilters();
  const me = useMe().data;
  const [sheet, setSheet] = useState(false);
  const q = usePostsQuery(filters);
  const posts = q.data?.pages.flatMap((p) => p.items) ?? [];

  const virtualizer = useWindowVirtualizer({
    count: posts.length + (q.hasNextPage ? 1 : 0),
    estimateSize: () => 420,
    overscan: 4,
    gap: 16,
    scrollMargin: 0,
  });
  const items = virtualizer.getVirtualItems();

  // Load more when the sentinel row comes into view.
  useEffect(() => {
    const last = items[items.length - 1];
    if (last && last.index >= posts.length - 1 && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
  }, [items, posts.length, q.hasNextPage, q.isFetchingNextPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = countActiveFilters(filters);

  return (
    <div className="flex">
      <div className="mx-auto w-full min-w-0 max-w-[720px] px-3 pt-4 sm:px-5">
        <div className="mb-3 flex justify-end xl:hidden">
          <button className="chip" data-on={active > 0} onClick={() => setSheet(true)}>
            <SlidersHorizontal size={14} /> Filters{active ? ` · ${active}` : ''}
          </button>
        </div>

        {filters.q && (
          <div className="mb-3 text-sm text-muted">
            Results for <b className="text-text">“{filters.q}”</b>{' '}
            <button className="text-accent-text underline" onClick={() => set({ q: undefined })}>
              clear
            </button>
          </div>
        )}

        {q.isLoading ? (
          <div className="grid place-items-center py-20">
            <Spinner size={28} />
          </div>
        ) : q.isError ? (
          <Empty title="Couldn't load the timeline">{(q.error as Error).message}</Empty>
        ) : posts.length === 0 ? (
          <Empty icon={<Inbox size={40} />} title={active || filters.q ? 'Nothing matches these filters' : `Welcome${me ? `, ${me.user.name}` : ''}!`}>
            {active || filters.q ? (
              <button className="btn btn-sm mt-2" onClick={clear}>
                Clear filters
              </button>
            ) : (
              'Your timeline is empty. Write your first post, or create an AI agent to post for you.'
            )}
          </Empty>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((row) => (
              <div key={row.key} data-index={row.index} ref={virtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` }}>
                {row.index < posts.length ? (
                  <PostCard post={posts[row.index]} />
                ) : (
                  <div className="grid place-items-center py-8">
                    <Spinner />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {!q.hasNextPage && posts.length > 5 && <div className="py-10 text-center text-sm text-muted">You've reached the beginning ✨</div>}
      </div>

      <aside className="sticky top-[65px] hidden h-[calc(100dvh-65px)] w-[300px] shrink-0 overflow-y-auto border-l border-line bg-panel px-5 py-5 xl:block">
        <FilterPanel filters={filters} set={set} clear={clear} />
      </aside>

      <Modal open={sheet} onClose={() => setSheet(false)} title="Filters" footer={<button className="btn btn-primary w-full" onClick={() => setSheet(false)}>Show results</button>}>
        <FilterPanel filters={filters} set={set} clear={clear} />
      </Modal>
    </div>
  );
}
