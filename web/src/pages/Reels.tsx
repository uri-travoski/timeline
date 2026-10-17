import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Clapperboard, ExternalLink, MessageCircle, Pause, Pencil, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import { api, filtersToQuery, type Attachment, type Page, type Post } from '../lib/api';
import { countActiveFilters, queueMarkRead, timeAgo, useFilters, useMe } from '../lib/hooks';
import { Video, loadHls, type Preload, type VideoHandle } from '../components/Video';
import { AgentBadge, Empty, Modal, Spinner } from '../components/ui';
import { FilterPanel } from '../components/Filters';
import { CategoryPill, Comments } from '../components/PostCard';
import { useComposer } from '../components/Composer';

interface ReelItem {
  attachment: Attachment;
  post: Post;
}

/**
 * How far ahead to warm up players. Each "warm" player buffers ~4 s of the lowest-latency
 * rendition, so a swipe starts playback from memory instead of the network.
 */
function lookahead(dataSaver: boolean) {
  const c = (navigator as any).connection;
  if (dataSaver || c?.saveData) return 1;
  if (c?.effectiveType && c.effectiveType !== '4g') return 1;
  if (c?.type === 'cellular') return 2;
  return 4;
}

function preloadFor(distance: number, ahead: number): Preload {
  if (distance === 0) return 'full';
  if (distance > 0 && distance <= ahead) return 'warm';
  if (distance === -1) return 'warm'; // swiping back is instant too
  return 'none';
}

export default function Reels() {
  const [filters, set, clear] = useFilters();
  const [params] = useSearchParams();
  const startId = params.get('start');
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMe().data;
  const composer = useComposer();
  const settings = me?.user.settings;
  const [muted, setMuted] = useState(() => settings?.reelsMuted ?? true);
  const [active, setActive] = useState(0);
  const [sheet, setSheet] = useState<'filters' | 'comments' | null>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => void loadHls(), []);

  const qs = filtersToQuery({ ...filters, fileTypes: undefined });
  const q = useInfiniteQuery({
    queryKey: ['reels', qs],
    queryFn: ({ pageParam }) => api.get<Page<ReelItem>>(`/reels?${filtersToQuery({ ...filters, fileTypes: undefined }, { cursor: pageParam ?? undefined, limit: '12' })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
  });

  // "Open in Reels" from a post: put that video first.
  const startItem = useQuery({
    queryKey: ['reel-start', startId],
    enabled: !!startId,
    queryFn: async () => {
      const att = await api.get<Attachment>(`/attachments/${startId}`);
      const post = await api.get<Post>(`/posts/${att.postId}`);
      return { attachment: post.attachments.find((a) => a.id === startId) ?? att, post } as ReelItem;
    },
  });

  const items = useMemo(() => {
    const list = q.data?.pages.flatMap((p) => p.items) ?? [];
    if (!startItem.data) return list;
    return [startItem.data, ...list.filter((x) => x.attachment.id !== startId)];
  }, [q.data, startItem.data, startId]);

  const ahead = lookahead(!!settings?.dataSaver);

  // Track which slide is on screen.
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll('[data-index]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items.length]);

  // Fetch more before reaching the end.
  useEffect(() => {
    if (active >= items.length - 4 && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
  }, [active, items.length, q.hasNextPage, q.isFetchingNextPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warm the image cache with upcoming posters, so even "cold" slides show a frame instantly.
  useEffect(() => {
    for (const it of items.slice(active + 1, active + 9)) {
      if (it.attachment.posterUrl) new Image().src = it.attachment.posterUrl;
    }
  }, [active, items]);

  const go = useCallback((delta: number) => {
    const root = container.current;
    if (root) root.scrollBy({ top: delta * root.clientHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea') || sheet) return;
      if (e.key === 'ArrowDown' || e.key === 'j') (e.preventDefault(), go(1));
      if (e.key === 'ArrowUp' || e.key === 'k') (e.preventDefault(), go(-1));
      if (e.key === 'm') setMuted((m) => !m);
      if (e.key === 'Escape') nav(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, nav, sheet]);

  const toggleMute = () => {
    setMuted((m) => {
      api.patch('/me', { settings: { reelsMuted: !m } }).catch(() => {});
      return !m;
    });
  };

  const current = items[active];
  const activeFilters = countActiveFilters({ ...filters, fileTypes: undefined });

  return (
    <div className="fixed inset-0 z-40 bg-black text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/60 to-transparent px-3 pb-8 pt-3 safe-top">
        <button className="pointer-events-auto rounded-full p-2 hover:bg-white/10" onClick={() => nav('/')} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <div className="flex flex-1 items-center justify-center gap-2 font-bold">
          <Clapperboard size={18} /> Reels
        </div>
        <button className="pointer-events-auto relative rounded-full p-2 hover:bg-white/10" onClick={() => setSheet('filters')} aria-label="Filters">
          <SlidersHorizontal size={21} />
          {activeFilters > 0 && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-accent" />}
        </button>
      </div>

      {q.isLoading ? (
        <div className="grid h-full place-items-center">
          <Spinner size={30} />
        </div>
      ) : items.length === 0 ? (
        <div className="grid h-full place-items-center">
          <Empty icon={<Clapperboard size={40} />} title="No videos here yet">
            Videos you or your agents post will show up here.
            {activeFilters > 0 && (
              <div>
                <button className="btn btn-sm mt-3" onClick={clear}>
                  Clear filters
                </button>
              </div>
            )}
          </Empty>
        </div>
      ) : (
        <div ref={container} className="reels">
          {items.map((it, i) => (
            <ReelSlide
              key={it.attachment.id}
              index={i}
              item={it}
              preload={preloadFor(i - active, ahead)}
              active={i === active}
              muted={muted}
              autoRead={(settings?.markRead ?? 'auto') === 'auto'}
              onRead={() => queueMarkRead(qc, it.post.id)}
              onUnmute={toggleMute}
            />
          ))}
          {q.isFetchingNextPage && (
            <div className="reel grid place-items-center">
              <Spinner size={28} />
            </div>
          )}
        </div>
      )}

      {current && (
        <div className="absolute bottom-28 right-3 z-20 flex flex-col items-center gap-5 sm:right-[max(12px,calc(50%-min(28vh,320px)-72px))]">
          <Action icon={<MessageCircle size={24} />} label={String(current.post.commentCount || '')} onClick={() => setSheet('comments')} />
          {current.post.permissions.canEdit && <Action icon={<Pencil size={22} />} label="Edit" onClick={() => composer.open(current.post)} />}
          <Action icon={muted ? <VolumeX size={23} /> : <Volume2 size={23} />} label={muted ? 'Muted' : 'Sound'} onClick={toggleMute} />
          {!current.post.isRead && (settings?.markRead === 'manual') && <Action icon={<Check size={23} />} label="Read" onClick={() => queueMarkRead(qc, current.post.id)} />}
          <Link to={`/post/${current.post.id}`} className="flex flex-col items-center gap-1 text-xs font-semibold">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/15 backdrop-blur">
              <ExternalLink size={21} />
            </span>
            Post
          </Link>
        </div>
      )}

      <Modal open={sheet === 'filters'} onClose={() => setSheet(null)} title="Reels filters" footer={<button className="btn btn-primary w-full" onClick={() => setSheet(null)}>Done</button>}>
        <div className="text-text">
          <FilterPanel filters={filters} set={set} clear={clear} hideFileTypes />
        </div>
      </Modal>
      <Modal open={sheet === 'comments' && !!current} onClose={() => setSheet(null)} title="Comments">
        <div className="text-text">{current && <Comments post={current.post} />}</div>
      </Modal>
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="flex flex-col items-center gap-1 text-xs font-semibold" onClick={onClick}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25">{icon}</span>
      {label}
    </button>
  );
}

function ReelSlide({ item, index, preload, active, muted, autoRead, onRead, onUnmute }: {
  item: ReelItem; index: number; preload: Preload; active: boolean; muted: boolean; autoRead: boolean; onRead: () => void; onUnmute: () => void;
}) {
  const ref = useRef<VideoHandle>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const { post, attachment: att } = item;
  const portrait = !att.width || !att.height || att.height >= att.width;

  useEffect(() => {
    const v = ref.current?.el;
    if (!v) return;
    if (active) {
      v.muted = muted;
      const p = v.play();
      // Browsers block autoplay with sound until the user interacts; fall back to muted.
      p?.catch(() => {
        v.muted = true;
        v.play().catch(() => {});
      });
      setPaused(false);
    } else {
      v.pause();
    }
  }, [active, muted, preload]);

  // Count as read after 2 s on screen.
  useEffect(() => {
    if (!active || !autoRead || post.isRead) return;
    const t = setTimeout(onRead, 2000);
    return () => clearTimeout(t);
  }, [active, autoRead, post.isRead]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    const v = ref.current?.el;
    if (!v) return;
    if (v.muted && muted === false) v.muted = false;
    if (v.paused) {
      v.play();
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  };

  const author = post.author;
  return (
    <section className="reel flex items-center justify-center" data-index={index}>
      <div className="relative h-full w-full" style={{ maxWidth: portrait ? 'calc(100dvh * 9 / 16)' : undefined }}>
        {att.posterUrl && preload === 'none' ? (
          <img src={att.posterUrl} className={`h-full w-full ${portrait ? 'object-cover' : 'object-contain'}`} alt="" />
        ) : (
          <Video
            ref={ref}
            att={att}
            preload={preload}
            loop
            muted={muted}
            onClick={toggle}
            onTime={active ? setProgress : undefined}
            className={`h-full w-full ${portrait ? 'object-cover' : 'object-contain'}`}
          />
        )}
        {paused && active && (
          <button className="absolute left-1/2 top-1/2 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/40 backdrop-blur" onClick={toggle} aria-label="Play">
            <Pause size={34} />
          </button>
        )}
        {active && muted && (
          <button className="absolute left-1/2 top-16 -translate-x-1/2 rounded-md bg-black/50 px-3 py-1.5 text-xs font-semibold backdrop-blur" onClick={onUnmute}>
            <VolumeX size={13} className="mr-1 inline" /> Tap for sound
          </button>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-4 pb-8 pt-24">
          <div className="pointer-events-auto mr-16 max-w-xl">
            <div className="flex items-center gap-2 font-semibold">
              {author?.name}
              {author?.kind === 'agent' && <AgentBadge />}
              <span className="text-xs font-normal opacity-70">· {timeAgo(post.postedAt)}</span>
            </div>
            {(post.title || post.body) && (
              <button className={`mt-1.5 block text-left text-sm leading-snug opacity-95 ${expanded ? '' : 'line-clamp-2'}`} onClick={() => setExpanded((e) => !e)}>
                {post.title && <b>{post.title} </b>}
                {post.body}
              </button>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-85">
              {post.category && <CategoryPill c={post.category} />}
              {post.tags.slice(0, 4).map((t) => (
                <span key={t}>#{t}</span>
              ))}
              {(post.sourceName || post.sourceUrl) && <span className="truncate opacity-80">from {post.sourceName || post.sourceUrl}</span>}
            </div>
          </div>
          <div className="mt-4 h-[3px] w-full rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white" style={{ width: `${active ? progress * 100 : 0}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
