import { memo } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Check, Clapperboard, Download, FileText, Link2, Lock, MessageCircle, MoreHorizontal, Music, Play } from 'lucide-react-native';
import { abs, api, type Attachment, type Post } from '../api';
import { SOURCE_LABEL, bytes, markRead, setRead, timeAgo } from '../state';
import { useTheme } from '../theme';
import { AgentBadge, Avatar, Row, T } from './ui';
import { RemoteImage } from './RemoteImage';

function duration(s: number | null) {
  if (!s) return '';
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

export function CategoryPill({ c }: { c: NonNullable<Post['category']> }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {c.isPrivate ? <Lock size={10} color={c.color} /> : <View style={{ width: 7, height: 7, borderRadius: 3, backgroundColor: c.color }} />}
      <Text style={{ color: c.color, fontSize: 12, fontWeight: '600' }}>{c.name}</Text>
    </View>
  );
}

function sourceLine(p: Post) {
  const bits: string[] = [];
  if (p.sourceName || p.sourceUrl) bits.push(`from ${p.sourceName || p.sourceUrl}`);
  else if (p.author?.kind !== 'agent') bits.push(SOURCE_LABEL[p.source] ?? p.source);
  if (!p.timeline.mine) bits.push(`${p.timeline.name}'s timeline`);
  bits.push(timeAgo(p.postedAt));
  if (p.editedAt) bits.push('edited');
  return bits.join(' · ');
}

export function ReminderCard({ post }: { post: Post }) {
  const qc = useQueryClient();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f59e0b14', borderColor: '#f59e0b55', borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, borderLeftColor: '#f59e0b', borderRadius: 5, padding: 12 }}>
      <View style={{ width: 38, height: 38, borderRadius: 5, backgroundColor: '#f59e0b33', alignItems: 'center', justifyContent: 'center' }}>
        <AlarmClock size={19} color="#f59e0b" />
      </View>
      <Pressable style={{ flex: 1 }} onPress={() => post.refPost && router.push(`/post/${post.refPost.id}`)}>
        <T bold>{post.title}</T>
        {!!post.body && <T muted size={13}>{post.body}</T>}
        <Text style={{ color: '#f59e0b', fontSize: 11.5 }}>
          Reminder{post.author?.kind === 'agent' ? ` · ${post.author.name}` : ''} · {timeAgo(post.postedAt)}
          {post.refPost ? ` · about “${(post.refPost.title || post.refPost.snippet).slice(0, 30)}”` : ''}
        </Text>
      </Pressable>
      <Pressable
        hitSlop={8}
        onPress={async () => {
          await api.post('/reads', { postIds: [post.id] });
          setRead(qc, [post.id], true);
          qc.invalidateQueries({ queryKey: ['unread'] });
        }}
        style={{ flexDirection: 'row', gap: 4, alignItems: 'center', borderWidth: 1, borderColor: '#f59e0b66', borderRadius: 5, paddingHorizontal: 9, paddingVertical: 6 }}
      >
        <Check size={14} color="#f59e0b" />
        <Text style={{ color: '#f59e0b', fontWeight: '700', fontSize: 12.5 }}>Read</Text>
      </Pressable>
    </View>
  );
}

// Posts are full-bleed; text is inset by PAD, media runs edge to edge.
const PAD = 14;

function Media({ atts }: { atts: Attachment[] }) {
  const t = useTheme();
  // Explicit pixel sizes: percentage width + aspectRatio inside a wrapping row collapses to height 0 on the new architecture.
  const full = Math.min(useWindowDimensions().width, 720);
  const half = (full - 2) / 2;
  const visual = atts.filter((a) => a.kind === 'image' || a.kind === 'video');
  const files = atts.filter((a) => a.kind !== 'image' && a.kind !== 'video');
  return (
    <>
      {visual.length > 0 && (
        <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
          {visual.slice(0, 4).map((a, i) => {
            const single = visual.length === 1;
            const ratio = single && a.width && a.height ? Math.max(0.6, Math.min(1.8, a.width / a.height)) : 1;
            const src = a.kind === 'video' ? abs(a.posterUrl ?? a.thumbUrl) : abs(single ? a.url : a.thumbUrl ?? a.url);
            const more = i === 3 && visual.length > 4 ? visual.length - 4 : 0;
            return (
              <Pressable
                key={a.id}
                style={{ width: single ? full : half, height: single ? full / ratio : half, backgroundColor: t.raised }}
                onPress={() => (a.kind === 'video' ? router.push(`/reels?start=${a.id}`) : router.push({ pathname: '/viewer', params: { url: abs(a.url)!, name: a.filename } }))}
              >
                <RemoteImage uri={src} showError />
                {a.kind === 'video' && (
                  <>
                    <View style={styles.play}>
                      <Play size={24} color="#fff" fill="#fff" />
                    </View>
                    {!!a.duration && <Text style={styles.dur}>{duration(a.duration)}</Text>}
                    <View style={styles.reelHint}>
                      <Clapperboard size={11} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 11 }}>Reels</Text>
                    </View>
                  </>
                )}
                {more > 0 && (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>+{more}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
      {files.map((a) => (
        <Pressable key={a.id} onPress={() => Linking.openURL(abs(a.downloadUrl)!)} style={{ marginTop: 8, marginHorizontal: PAD, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
          {a.kind === 'audio' ? <Music size={20} color={t.muted} /> : <FileText size={20} color={t.muted} />}
          <View style={{ flex: 1 }}>
            <T numberOfLines={1} size={14} bold>{a.filename}</T>
            <T muted size={12}>
              {a.kind.toUpperCase()} · {bytes(a.size)}
            </T>
          </View>
          <Download size={18} color={t.muted} />
        </Pressable>
      ))}
    </>
  );
}

export const PostCard = memo(function PostCard({ post, expanded, manualRead }: { post: Post; expanded?: boolean; manualRead?: boolean }) {
  const t = useTheme();
  const qc = useQueryClient();
  if (post.kind === 'reminder') return <ReminderCard post={post} />;
  const a = post.author ?? { id: '', name: 'Unknown', kind: 'human' as const, color: '#64748b' };

  const menu = () => {
    const opts: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    if (post.permissions.canEdit) opts.push({ text: 'Edit', onPress: () => router.push({ pathname: '/compose', params: { id: post.id } }) });
    opts.push({
      text: post.isRead ? 'Mark as unread' : 'Mark as read',
      onPress: async () => {
        if (post.isRead) {
          await api.post('/reads/unread', { postIds: [post.id] });
          setRead(qc, [post.id], false);
        } else markRead(qc, [post.id]);
      },
    });
    if (post.sourceUrl) opts.push({ text: 'Open source', onPress: () => Linking.openURL(post.sourceUrl!) });
    if (post.permissions.canDelete)
      opts.push({
        text: 'Move to recycle bin',
        style: 'destructive',
        onPress: async () => {
          await api.del(`/posts/${post.id}`);
          qc.invalidateQueries({ queryKey: ['posts'] });
          qc.invalidateQueries({ queryKey: ['reels'] });
          if (expanded) router.back();
        },
      });
    opts.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Post', undefined, opts);
  };

  return (
    <View style={{ backgroundColor: t.card, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
      {!post.isRead && <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: t.accent }} />}
      <Row gap={10} style={{ alignItems: 'center', paddingHorizontal: PAD }}>
        <Avatar name={a.name} color={a.color} src={a.avatarUrl} kind={a.kind} size={36} />
        <View style={{ flex: 1 }}>
          <Row gap={6}>
            <T bold size={14.5} numberOfLines={1} style={{ flexShrink: 1 }}>{a.name}</T>
            {a.kind === 'agent' && <AgentBadge small />}
          </Row>
          <Row gap={4}>
            {(post.sourceName || post.sourceUrl) && <Link2 size={11} color={t.muted} />}
            <T muted size={12} numberOfLines={1} style={{ flexShrink: 1 }}>{sourceLine(post)}</T>
          </Row>
        </View>
        {post.category && <CategoryPill c={post.category} />}
        <Pressable hitSlop={12} onPress={menu}>
          <MoreHorizontal size={20} color={t.muted} />
        </Pressable>
      </Row>
      <Pressable onPress={() => !expanded && router.push(`/post/${post.id}`)} style={{ paddingHorizontal: PAD }}>
        {!!post.title && <T bold size={17} style={{ marginTop: 10, lineHeight: 23 }}>{post.title}</T>}
        {!!post.body && (
          <T size={16} style={{ marginTop: post.title ? 4 : 10, lineHeight: 23 }} numberOfLines={expanded ? undefined : 10}>
            {post.body}
          </T>
        )}
        {post.tags.length > 0 && <T size={13.5} style={{ marginTop: 6, color: t.accentText }}>{post.tags.map((x) => `#${x}`).join('  ')}</T>}
      </Pressable>
      <Media atts={post.attachments} />
      <Row style={{ marginTop: 8, paddingHorizontal: PAD }} gap={16}>
        <Pressable onPress={() => router.push(`/post/${post.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }} hitSlop={8}>
          <MessageCircle size={17} color={t.muted} />
          <T muted size={13.5}>{post.commentCount || 'Comment'}</T>
        </Pressable>
        <View style={{ flex: 1 }} />
        {!post.isRead && manualRead && (
          <Pressable onPress={() => markRead(qc, [post.id])} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 }}>
            <Check size={15} color={t.accentText} />
            <T size={13.5} bold style={{ color: t.accentText }}>Mark read</T>
          </Pressable>
        )}
      </Row>
    </View>
  );
});

const styles = StyleSheet.create({
  play: { position: 'absolute', left: '50%', top: '50%', marginLeft: -27, marginTop: -27, width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  dur: { position: 'absolute', right: 8, bottom: 8, color: '#fff', fontSize: 11, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, borderRadius: 7, overflow: 'hidden' },
  reelHint: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 },
});
