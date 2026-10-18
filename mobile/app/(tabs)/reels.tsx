import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../src/text';


import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { RemoteImage, prefetchImages } from '../../src/components/RemoteImage';
import NetInfo from '@react-native-community/netinfo';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clapperboard, ExternalLink, MessageCircle, Pause, Pencil, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react-native';
import { abs, api, filtersToQuery, type Attachment, type Page, type Post } from '../../src/api';
import { activeFilterCount, markRead, timeAgo, useFilters, useMe } from '../../src/state';
import { FilterSheet } from '../../src/components/FilterSheet';
import { CategoryPill } from '../../src/components/PostCard';
import { AgentBadge, Empty, Loading } from '../../src/components/ui';

interface ReelItem {
  attachment: Attachment;
  post: Post;
}

/** How many videos ahead get a live, pre-buffered player. */
function useLookahead(dataSaver: boolean) {
  const [ahead, setAhead] = useState(dataSaver ? 1 : 3);
  useEffect(
    () =>
      NetInfo.addEventListener((s) => {
        if (dataSaver) return setAhead(1);
        if (s.type === 'wifi' || s.type === 'ethernet') return setAhead(4);
        const gen = (s.details as any)?.cellularGeneration;
        setAhead(gen === '5g' ? 3 : gen === '4g' ? 2 : 1);
      }),
    [dataSaver],
  );
  return ahead;
}

export default function Reels() {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ start?: string }>();
  const [filters] = useFilters();
  const me = useMe().data;
  const settings = me?.user.settings;
  const [muted, setMuted] = useState(settings?.reelsMuted ?? false);
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState(0);
  const [sheet, setSheet] = useState(false);
  const list = useRef<FlatList<ReelItem>>(null);
  const ahead = useLookahead(!!settings?.dataSaver);

  const f = { ...filters, fileTypes: undefined };
  const q = useInfiniteQuery({
    queryKey: ['reels', filtersToQuery(f)],
    queryFn: ({ pageParam }) => api.get<Page<ReelItem>>(`/reels?${filtersToQuery(f, { cursor: pageParam ?? undefined, limit: '12' })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
  });
  const start = useQuery({
    queryKey: ['reel-start', params.start],
    enabled: !!params.start,
    queryFn: async () => {
      const att = await api.get<Attachment>(`/attachments/${params.start}`);
      const post = await api.get<Post>(`/posts/${att.postId}`);
      return { attachment: post.attachments.find((a) => a.id === params.start) ?? att, post } as ReelItem;
    },
  });
  const items = useMemo(() => {
    const l = q.data?.pages.flatMap((p) => p.items) ?? [];
    return start.data ? [start.data, ...l.filter((x) => x.attachment.id !== params.start)] : l;
  }, [q.data, start.data, params.start]);

  useEffect(() => {
    if (params.start) list.current?.scrollToOffset({ offset: 0, animated: false });
    setActive(0);
  }, [params.start]);

  // Warm the image cache with the next posters so even "cold" slides show a frame immediately.
  useEffect(() => {
    const next = items.slice(active + 1, active + 9).map((i) => abs(i.attachment.posterUrl)).filter(Boolean) as string[];
    if (next.length) prefetchImages(next);
  }, [active, items]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null; isViewable: boolean }[] }) => {
    const v = viewableItems.find((x) => x.isViewable);
    if (v?.index != null) setActive(v.index);
  }).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 70 }).current;

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      api.patch('/me', { settings: { reelsMuted: !m } }).catch(() => {});
      return !m;
    });
  }, []);

  const current = items[active];
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {q.isLoading || !height ? (
        <Loading />
      ) : items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Empty title="No videos yet" icon={<Clapperboard size={40} color="#888" />}>
            Videos you or your agents post show up here.
          </Empty>
        </View>
      ) : (
        <FlatList
          ref={list}
          data={items}
          keyExtractor={(i) => i.attachment.id}
          renderItem={({ item, index }) => (
            <Slide
              item={item}
              height={height}
              // Live players for the previous video and the next `ahead` videos; posters for the rest.
              mode={index === active ? 'active' : index - active >= -1 && index - active <= ahead ? 'warm' : 'cold'}
              playing={focused && index === active}
              muted={muted}
              topInset={insets.top}
              autoRead={(settings?.markRead ?? 'auto') === 'auto'}
              onRead={() => markRead(qc, [item.post.id])}
            />
          )}
          pagingEnabled
          decelerationRate="fast"
          snapToInterval={height}
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={viewability}
          windowSize={7}
          initialNumToRender={3}
          maxToRenderPerBatch={4}
          removeClippedSubviews={false}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          onEndReachedThreshold={3}
        />
      )}

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Clapperboard size={20} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>Reels</Text>
        </View>
        <Pressable hitSlop={12} onPress={() => setSheet(true)}>
          <SlidersHorizontal size={22} color="#fff" />
          {activeFilterCount(f) > 0 && <View style={styles.dot} />}
        </Pressable>
      </View>

      {current && (
        <View style={styles.side}>
          <Action icon={<MessageCircle size={25} color="#fff" />} label={String(current.post.commentCount || '')} onPress={() => router.push(`/post/${current.post.id}`)} />
          {current.post.permissions.canEdit && <Action icon={<Pencil size={23} color="#fff" />} label="Edit" onPress={() => router.push({ pathname: '/compose', params: { id: current.post.id } })} />}
          <Action icon={muted ? <VolumeX size={24} color="#fff" /> : <Volume2 size={24} color="#fff" />} label={muted ? 'Muted' : 'Sound'} onPress={toggleMute} />
          <Action icon={<ExternalLink size={22} color="#fff" />} label="Post" onPress={() => router.push(`/post/${current.post.id}`)} />
        </View>
      )}
      <FilterSheet open={sheet} onClose={() => setSheet(false)} hideFileTypes />
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 4 }} hitSlop={6}>
      <View style={styles.circle}>{icon}</View>
      {!!label && <Text style={styles.actionLabel}>{label}</Text>}
    </Pressable>
  );
}

type Mode = 'active' | 'warm' | 'cold';

const Slide = memo(function Slide({ item, height, mode, playing, muted, topInset, autoRead, onRead }: {
  item: ReelItem; height: number; mode: Mode; playing: boolean; muted: boolean; topInset: number; autoRead: boolean; onRead: () => void;
}) {
  const { attachment: a, post } = item;
  const portrait = !a.width || !a.height || a.height >= a.width;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!playing || !autoRead || post.isRead) return;
    const t = setTimeout(onRead, 2000);
    return () => clearTimeout(t);
  }, [playing, autoRead, post.isRead]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ height, backgroundColor: '#000' }}>
      {mode === 'cold' ? (
        <RemoteImage uri={abs(a.posterUrl)} fit={portrait ? 'cover' : 'contain'} />
      ) : (
        <LivePlayer att={a} mode={mode} playing={playing} muted={muted} portrait={portrait} />
      )}
      <View style={styles.caption} pointerEvents="box-none">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.author}>{post.author?.name}</Text>
          {post.author?.kind === 'agent' && <AgentBadge />}
          <Text style={{ color: '#ccc', fontSize: 12 }}>· {timeAgo(post.postedAt)}</Text>
        </View>
        {!!(post.title || post.body) && (
          <Text style={styles.body} numberOfLines={expanded ? 12 : 2} onPress={() => setExpanded(!expanded)}>
            {post.title ? <Text style={{ fontWeight: '700' }}>{post.title} </Text> : null}
            {post.body}
          </Text>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}>
          {post.category && <CategoryPill c={post.category} />}
          {post.tags.slice(0, 3).map((x) => (
            <Text key={x} style={{ color: '#ddd', fontSize: 12.5 }}>#{x}</Text>
          ))}
          {!!post.sourceName && <Text style={{ color: '#bbb', fontSize: 12 }} numberOfLines={1}>from {post.sourceName}</Text>}
        </View>
      </View>
      <View style={{ position: 'absolute', top: topInset }} />
    </View>
  );
});

function LivePlayer({ att, mode, playing, muted, portrait }: { att: Attachment; mode: Mode; playing: boolean; muted: boolean; portrait: boolean }) {
  const [firstFrame, setFirstFrame] = useState(false);
  const [paused, setPaused] = useState(false);
  const source = useMemo(
    () => ({ uri: abs(att.hlsUrl ?? att.url)!, contentType: att.hlsUrl ? ('hls' as const) : ('progressive' as const), useCaching: true }),
    [att.hlsUrl, att.url],
  );
  // Creating the player starts loading immediately: warm players buffer a few seconds in the background.
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = muted;
    p.timeUpdateEventInterval = 0.25;
    p.bufferOptions = { preferredForwardBufferDuration: 4, minBufferForPlayback: 0.5, prioritizeTimeOverSizeThreshold: true };
  });
  const time = useEvent(player, 'timeUpdate');

  useEffect(() => {
    // The on-screen video buffers further ahead; warm ones keep a small buffer.
    player.bufferOptions = { preferredForwardBufferDuration: mode === 'active' ? 30 : 4, minBufferForPlayback: 0.5, prioritizeTimeOverSizeThreshold: true };
  }, [mode, player]);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  useEffect(() => {
    if (playing && !paused) player.play();
    else player.pause();
    if (!playing) setPaused(false);
  }, [playing, paused, player]);

  const progress = time && player.duration ? time.currentTime / player.duration : 0;
  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={() => setPaused((p) => !p)}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={portrait ? 'cover' : 'contain'} nativeControls={false} useExoShutter={false} onFirstFrameRender={() => setFirstFrame(true)} />
      {!firstFrame && <RemoteImage uri={abs(att.posterUrl)} fit={portrait ? 'cover' : 'contain'} />}
      {paused && (
        <View style={styles.pause}>
          <Pause size={36} color="#fff" />
        </View>
      )}
      {playing && (
        <View style={styles.progressTrack}>
          <View style={[styles.progress, { width: `${Math.min(100, progress * 100)}%` }]} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  dot: { position: 'absolute', right: -3, top: -3, width: 9, height: 9, borderRadius: 5, backgroundColor: '#7c6cff' },
  side: { position: 'absolute', right: 10, bottom: 110, gap: 18, alignItems: 'center' },
  circle: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: '#fff', fontSize: 11.5, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  caption: { position: 'absolute', left: 14, right: 80, bottom: 22 },
  author: { color: '#fff', fontWeight: '800', fontSize: 15, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  body: { color: '#fff', fontSize: 14, lineHeight: 19, marginTop: 6, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  pause: { position: 'absolute', alignSelf: 'center', top: '45%', width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2.5, backgroundColor: 'rgba(255,255,255,0.25)' },
  progress: { height: '100%', backgroundColor: '#fff' },
});
