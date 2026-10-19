import { memo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock, Archive, Check, Clapperboard, Copy, Download, Eye, EyeOff, File, FileText, Film, History, Link2, Lock,
  MessageCircle, MoreHorizontal, Music, Pencil, Play, Trash2, X,
} from 'lucide-react';
import { api, type Attachment, type Comment, type Post } from '../lib/api';
import { SOURCE_LABEL, bytes, duration, fullDate, queueMarkRead, setReadInCache, timeAgo, useAutoRead, useMe } from '../lib/hooks';
import { AgentBadge, Avatar, Menu, MenuItem, Modal, Spinner, toast, toastError } from './ui';
import { Video } from './Video';
import { useComposer } from './Composer';
import { MarkdownBody } from './MarkdownBody';
import { stripMarkdown } from '../lib/markdown';

function linkify(text: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g);
  return parts.map((p, i) =>
    i % 2 ? (
      <a key={i} href={p} target="_blank" rel="noreferrer noopener">
        {p.replace(/^https?:\/\//, '').slice(0, 60)}
      </a>
    ) : (
      p
    ),
  );
}

export function SourceLine({ post }: { post: Post }) {
  const bits: ReactNode[] = [];
  if (post.sourceName || post.sourceUrl) {
    bits.push(
      <span key="src" className="inline-flex min-w-0 items-center gap-1">
        <Link2 size={12} className="shrink-0" />
        {post.sourceUrl ? (
          <a href={post.sourceUrl} target="_blank" rel="noreferrer" className="truncate hover:underline">
            from {post.sourceName || new URL(post.sourceUrl).host}
          </a>
        ) : (
          <span className="truncate">from {post.sourceName}</span>
        )}
      </span>,
    );
  } else if (post.author?.kind !== 'agent') {
    bits.push(<span key="via">{SOURCE_LABEL[post.source] ?? post.source}</span>);
  }
  if (post.author?.kind === 'agent' && post.author.ownerName) bits.push(<span key="for">for {post.author.ownerName}</span>);
  if (!post.timeline.mine) bits.push(<span key="tl">on {post.timeline.name}'s timeline</span>);
  bits.push(
    <span key="t" title={fullDate(post.postedAt)}>
      {timeAgo(post.postedAt)}
    </span>,
  );
  if (post.editedAt) bits.push(<span key="e">edited</span>);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted">
      {bits.map((b, i) => (
        <span key={i} className="inline-flex min-w-0 items-center gap-1.5">
          {i > 0 && <span className="opacity-50">·</span>}
          {b}
        </span>
      ))}
    </div>
  );
}

export function CategoryPill({ c }: { c: NonNullable<Post['category']> }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold" style={{ color: c.color }}>
      {c.isPrivate ? <Lock size={11} /> : <span className="h-2 w-2 rounded-[3px]" style={{ background: c.color }} />}
      {c.name}
    </span>
  );
}

const KIND_ICON: Record<string, ReactNode> = {
  pdf: <FileText size={20} />, document: <FileText size={20} />, audio: <Music size={20} />, archive: <Archive size={20} />, other: <File size={20} />,
  image: <File size={20} />, video: <Film size={20} />,
};

function Media({ post, onOpen }: { post: Post; onOpen: (index: number) => void }) {
  const visual = post.attachments.filter((a) => a.kind === 'image' || a.kind === 'video');
  const files = post.attachments.filter((a) => a.kind !== 'image' && a.kind !== 'video');
  const nav = useNavigate();
  return (
    <>
      {visual.length > 0 && (
        <div className={`-mx-4 mt-3 grid gap-0.5 overflow-hidden sm:-mx-5 ${visual.length === 1 ? '' : 'grid-cols-2'}`}>
          {visual.slice(0, 4).map((a, i) => {
            const more = i === 3 && visual.length > 4 ? visual.length - 4 : 0;
            const single = visual.length === 1;
            const ratio = single && a.width && a.height ? Math.max(0.56, Math.min(1.9, a.width / a.height)) : 1;
            return (
              <button
                key={a.id}
                className={`relative overflow-hidden bg-raised ${visual.length === 3 && i === 0 ? 'row-span-2' : ''}`}
                style={single ? { aspectRatio: String(ratio), maxHeight: 560 } : { aspectRatio: visual.length === 3 && i === 0 ? undefined : '1' }}
                onClick={() => onOpen(i)}
              >
                {a.thumbUrl || a.posterUrl ? (
                  <img src={a.kind === 'video' ? (a.posterUrl ?? a.thumbUrl)! : single ? a.url : a.thumbUrl!} alt={a.filename} loading="lazy" className="h-full w-full object-cover" />
                ) : a.kind === 'image' ? (
                  <img src={a.url} alt={a.filename} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full min-h-48 w-full place-items-center text-muted">
                    {a.mediaStatus === 'processing' ? <Spinner /> : <Film />}
                  </div>
                )}
                {a.kind === 'video' && (
                  <>
                    <span className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur">
                      <Play size={24} fill="white" className="ml-1" />
                    </span>
                    {a.duration ? <span className="absolute bottom-2 right-2 rounded-sm bg-black/60 px-1.5 text-xs text-white">{duration(a.duration)}</span> : null}
                    <span
                      className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-sm bg-black/60 px-2 py-0.5 text-xs text-white hover:bg-black/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        nav(`/reels?start=${a.id}`);
                      }}
                    >
                      <Clapperboard size={12} /> Open in Reels
                    </span>
                  </>
                )}
                {more > 0 && <span className="absolute inset-0 grid place-items-center bg-black/55 text-2xl font-bold text-white">+{more}</span>}
              </button>
            );
          })}
        </div>
      )}
      {files.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {files.map((a) =>
            a.kind === 'audio' ? (
              <div key={a.id} className="rounded-md border border-line p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Music size={16} /> {a.filename}
                </div>
                <audio controls preload="none" src={a.url} className="w-full" />
              </div>
            ) : (
              <div key={a.id} className="flex items-center gap-3 rounded-md border border-line p-3 hover:border-accent">
                <span className="text-muted">{KIND_ICON[a.kind]}</span>
                <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium hover:underline">{a.filename}</span>
                  <span className="text-xs text-muted">
                    {a.kind.toUpperCase()} · {bytes(a.size)}
                    {a.status === 'pending' && ' · uploading…'}
                    {a.status === 'failed' && ' · upload failed'}
                  </span>
                </a>
                <a href={a.downloadUrl} className="btn btn-sm btn-ghost" aria-label="Download">
                  <Download size={16} />
                </a>
              </div>
            ),
          )}
        </div>
      )}
    </>
  );
}

export function Lightbox({ items, index, onClose }: { items: Attachment[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  const a = items[i];
  if (!a) return null;
  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-black/95" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="flex items-center gap-3 p-3 text-white">
        <span className="flex-1 truncate text-sm opacity-80">
          {a.filename} · {i + 1}/{items.length}
        </span>
        <a className="btn btn-sm btn-ghost text-white" href={a.downloadUrl}>
          <Download size={18} />
        </a>
        <button className="btn btn-sm btn-ghost text-white" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {a.kind === 'video' ? (
          <Video key={a.id} att={a} preload="full" controls className="max-h-full max-w-full" />
        ) : (
          <img src={a.url} alt={a.filename} className="max-h-full max-w-full object-contain" />
        )}
        {i > 0 && (
          <button className="absolute left-2 top-1/2 -translate-y-1/2 rounded-md bg-white/10 px-3 py-4 text-2xl text-white" onClick={() => setI(i - 1)}>
            ‹
          </button>
        )}
        {i < items.length - 1 && (
          <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-white/10 px-3 py-4 text-2xl text-white" onClick={() => setI(i + 1)}>
            ›
          </button>
        )}
      </div>
    </div>
  );
}

export function Comments({ post, autoFocus }: { post: Post; autoFocus?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['comments', post.id], queryFn: () => api.get<Comment[]>(`/posts/${post.id}/comments`) });
  const me = useMe().data?.user;
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['comments', post.id] });
    qc.invalidateQueries({ queryKey: ['posts'] });
  };
  const add = useMutation({
    mutationFn: () => api.post(`/posts/${post.id}/comments`, { body: text }),
    onSuccess: () => {
      setText('');
      refresh();
    },
    onError: toastError,
  });
  return (
    <div className="mt-3 border-t border-line pt-3">
      {isLoading && <Spinner />}
      <div className="flex flex-col gap-3">
        {data?.map((c) => (
          <div key={c.id} className="group flex gap-2.5">
            <Avatar name={c.author.name} color={c.author.color} src={c.author.avatarUrl} kind={c.author.kind} size={30} />
            <div className="min-w-0 flex-1">
              {editing === c.id ? (
                <div className="flex gap-2">
                  <input className="field" value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      await api.patch(`/comments/${c.id}`, { body: editText }).catch(toastError);
                      setEditing(null);
                      refresh();
                    }}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="inline-block max-w-full rounded-md bg-raised px-3 py-2 text-sm">
                  <span className="mr-2 font-semibold">{c.author.name}</span>
                  {c.author.kind === 'agent' && <AgentBadge small />}
                  <div className="prose-post mt-0.5">{linkify(c.body)}</div>
                </div>
              )}
              <div className="mt-1 flex gap-3 px-1 text-xs text-muted">
                <span title={fullDate(c.createdAt)}>{timeAgo(c.createdAt)}</span>
                {c.editedAt && <span>edited</span>}
                {me && c.author.id === me.id && editing !== c.id && (
                  <button className="hover:text-text" onClick={() => (setEditing(c.id), setEditText(c.body))}>
                    Edit
                  </button>
                )}
                {me && (c.author.id === me.id || post.permissions.canEdit) && (
                  <button
                    className="hover:text-danger"
                    onClick={async () => {
                      await api.del(`/comments/${c.id}`).catch(toastError);
                      refresh();
                      toast('Comment moved to the recycle bin');
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {post.permissions.canComment && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate();
          }}
        >
          <input className="field" placeholder="Write a comment…" value={text} onChange={(e) => setText(e.target.value)} autoFocus={autoFocus} />
          <button className="btn btn-primary" disabled={!text.trim() || add.isPending}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}

function Revisions({ postId, onClose }: { postId: string; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['revisions', postId], queryFn: () => api.get<any[]>(`/posts/${postId}/revisions`) });
  return (
    <Modal open onClose={onClose} title="Edit history">
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <div className="text-muted">This post was never edited.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((r) => (
            <div key={r.id} className="rounded-md border border-line p-3">
              <div className="mb-1 text-xs text-muted">
                Before edit by {r.editedBy ?? 'someone'} · {fullDate(r.editedAt)}
              </div>
              {r.title && <div className="font-semibold">{r.title}</div>}
              <MarkdownBody source={r.body} className="text-sm" />
              {r.tags.length > 0 && <div className="mt-1 text-xs text-accent-text">{r.tags.map((t: string) => `#${t}`).join(' ')}</div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function ReminderCard({ post }: { post: Post }) {
  const qc = useQueryClient();
  const dismiss = async () => {
    await api.post('/reads', { postIds: [post.id] }).catch(toastError);
    setReadInCache(qc, [post.id], true);
    qc.invalidateQueries({ queryKey: ['unread'] });
  };
  return (
    <div className="fade-up flex flex-wrap items-center gap-3 rounded-md border border-l-[3px] border-gold/40 border-l-gold bg-gold/[.07] px-4 py-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-gold/15 text-gold">
        <AlarmClock size={20} />
      </div>
      <div className="min-w-0 flex-1 basis-48">
        <div className="font-semibold">{post.title}</div>
        {post.body && <div className="text-sm text-muted">{stripMarkdown(post.body)}</div>}
        <div className="text-xs text-gold">
          Reminder{post.author?.kind === 'agent' ? ` · set by ${post.author.name}` : ''} · {timeAgo(post.postedAt)}
          {post.refPost && (
            <>
              {' · '}
              <Link to={`/post/${post.refPost.id}`} className="underline">
                about “{(post.refPost.title || post.refPost.snippet).slice(0, 40)}”
              </Link>
            </>
          )}
        </div>
      </div>
      <button className="btn btn-sm ml-auto shrink-0 border-gold/40 bg-transparent text-gold" onClick={dismiss}>
        <Check size={15} /> Mark as read
      </button>
    </div>
  );
}

export const PostCard = memo(function PostCard({ post, expanded }: { post: Post; expanded?: boolean }) {
  const qc = useQueryClient();
  const me = useMe().data?.user;
  const autoMode = (me?.settings.markRead ?? 'auto') === 'auto';
  const readRef = useAutoRead(post.id, post.isRead, autoMode);
  const [showComments, setShowComments] = useState(!!expanded);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [history, setHistory] = useState(false);
  const composer = useComposer();
  const nav = useNavigate();

  if (post.kind === 'reminder') return <ReminderCard post={post} />;

  const toggleRead = async () => {
    const next = !post.isRead;
    if (next) queueMarkRead(qc, post.id);
    else {
      await api.post('/reads/unread', { postIds: [post.id] }).catch(toastError);
      setReadInCache(qc, [post.id], false);
    }
    if (next) setReadInCache(qc, [post.id], true);
  };

  const remove = async () => {
    try {
      await api.del(`/posts/${post.id}`);
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['reels'] });
      toast('Moved to the recycle bin', {
        action: {
          label: 'Undo',
          run: async () => {
            await api.post(`/posts/${post.id}/restore`);
            qc.invalidateQueries({ queryKey: ['posts'] });
          },
        },
      });
      if (expanded) nav('/');
    } catch (e) {
      toastError(e);
    }
  };

  const visual = post.attachments.filter((a) => a.kind === 'image' || a.kind === 'video');
  const author = post.author ?? { id: '', name: 'Unknown', kind: 'human' as const, color: '#64748b' };

  return (
    <article
      ref={readRef as any}
      className={`relative rounded-lg border p-4 max-sm:-mx-3 max-sm:rounded-none max-sm:border-x-0 sm:p-5 ${post.isRead ? 'border-line bg-card' : 'border-gold/30 bg-[color-mix(in_srgb,var(--gold)_8%,var(--card))] shadow-[inset_3px_0_0_var(--gold)]'}`}
    >
      <header className="flex items-start gap-3">
        <Avatar name={author.name} color={author.color} src={author.avatarUrl} kind={author.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            <span className="truncate">{author.name}</span>
            {author.kind === 'agent' && <AgentBadge small />}
          </div>
          <SourceLine post={post} />
        </div>
        {post.category && <CategoryPill c={post.category} />}
        <Menu
          trigger={
            <button className="btn btn-ghost btn-sm -mr-2 -mt-1" aria-label="More">
              <MoreHorizontal size={18} />
            </button>
          }
        >
          {post.permissions.canEdit && <MenuItem icon={<Pencil size={16} />} onClick={() => composer.open(post)}>Edit post</MenuItem>}
          <MenuItem icon={post.isRead ? <EyeOff size={16} /> : <Eye size={16} />} onClick={toggleRead}>
            Mark as {post.isRead ? 'unread' : 'read'}
          </MenuItem>
          <MenuItem
            icon={<Copy size={16} />}
            onClick={() => {
              navigator.clipboard?.writeText(`${location.origin}/post/${post.id}`);
              toast('Link copied');
            }}
          >
            Copy link
          </MenuItem>
          {post.editedAt && post.permissions.canEdit && <MenuItem icon={<History size={16} />} onClick={() => setHistory(true)}>Edit history</MenuItem>}
          {post.permissions.canDelete && <MenuItem icon={<Trash2 size={16} />} danger onClick={remove}>Move to recycle bin</MenuItem>}
        </Menu>
      </header>

      {post.title && (
        <Link to={`/post/${post.id}`} className="mt-3 block text-lg font-bold leading-snug hover:underline">
          {post.title}
        </Link>
      )}
      {post.body && <MarkdownBody source={post.body} className="mt-2 text-[15.5px]" clamp={!expanded} />}
      {post.sourceMeta?.importError && (
        <div className="mt-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">Could not download the media: {String(post.sourceMeta.importError).slice(0, 160)}</div>
      )}
      {post.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-2 text-sm">
          {post.tags.map((t) => (
            <Link key={t} to={`/?tags=${encodeURIComponent(t)}`} className="text-accent-text hover:underline">
              #{t}
            </Link>
          ))}
        </div>
      )}
      <Media post={post} onOpen={setLightbox} />

      <footer className="-mx-2 mt-2 flex items-center gap-1 text-sm text-muted">
        <button className="btn btn-ghost btn-sm font-medium text-muted hover:text-text" onClick={() => setShowComments((s) => !s)}>
          <MessageCircle size={16} />
          {post.commentCount > 0 ? `${post.commentCount} comment${post.commentCount > 1 ? 's' : ''}` : 'Comment'}
        </button>
        {post.permissions.canEdit && (
          <button className="btn btn-ghost btn-sm hidden font-medium text-muted hover:text-text sm:inline-flex" onClick={() => composer.open(post)}>
            <Pencil size={15} /> Edit
          </button>
        )}
        <div className="flex-1" />
        {!post.isRead && (
          <button className="btn btn-ghost btn-sm text-accent-text" onClick={toggleRead}>
            <Check size={15} /> Mark as read
          </button>
        )}
      </footer>
      {showComments && <Comments post={post} autoFocus={!expanded} />}
      {lightbox !== null && <Lightbox items={visual} index={lightbox} onClose={() => setLightbox(null)} />}
      {history && <Revisions postId={post.id} onClose={() => setHistory(false)} />}
    </article>
  );
});
