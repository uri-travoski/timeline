import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { File, MessageCircle, RotateCcw, Trash2 } from 'lucide-react';
import { api, type Attachment, type Comment, type Post } from '../lib/api';
import { bytes, timeAgo } from '../lib/hooks';
import { Empty, Spinner, toast, toastError } from '../components/ui';

interface TrashData {
  posts: Post[];
  comments: Comment[];
  attachments: (Attachment & { deletedAt: string })[];
}

export default function Trash() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['trash'], queryFn: () => api.get<TrashData>('/trash') });
  const [tab, setTab] = useState<'post' | 'comment' | 'attachment'>('post');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['trash'] });
    qc.invalidateQueries({ queryKey: ['posts'] });
    qc.invalidateQueries({ queryKey: ['reels'] });
  };
  const restore = async (type: string, id: string) => {
    await api.post(`/trash/${type}/${id}/restore`).catch(toastError);
    toast('Restored');
    refresh();
  };
  const purge = async (type: string, id: string) => {
    if (!confirm('Delete forever? This also deletes the files from storage and cannot be undone.')) return;
    await api.del(`/trash/${type}/${id}`).catch(toastError);
    refresh();
  };
  const empty = async () => {
    if (!confirm('Empty the recycle bin? Everything in it will be deleted forever.')) return;
    await api.del('/trash').catch(toastError);
    toast('Recycle bin emptied');
    refresh();
  };
  const d = q.data;
  const counts = { post: d?.posts.length ?? 0, comment: d?.comments.length ?? 0, attachment: d?.attachments.length ?? 0 };
  const Row = ({ type, id, title, sub, icon }: { type: string; id: string; title: string; sub: string; icon?: React.ReactNode }) => (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3.5">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 font-medium">{title || '(no text)'}</div>
        <div className="text-xs text-muted">{sub}</div>
      </div>
      <button className="btn btn-sm" onClick={() => restore(type, id)}>
        <RotateCcw size={15} /> Restore
      </button>
      <button className="btn btn-sm btn-ghost text-danger" onClick={() => purge(type, id)} title="Delete forever">
        <Trash2 size={16} />
      </button>
    </div>
  );

  return (
    <div className="mx-auto max-w-[720px] px-3 pt-4 sm:px-5">
      <div className="mb-2 flex items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">Recycle bin</h1>
        <button className="btn btn-sm btn-danger" onClick={empty} disabled={!counts.post && !counts.comment && !counts.attachment}>
          Empty bin
        </button>
      </div>
      <p className="mb-4 text-sm text-muted">Deleted items stay here for 30 days (set by your server), then they're removed for good, files included.</p>
      <div className="mb-4 flex gap-2">
        {(['post', 'comment', 'attachment'] as const).map((t) => (
          <button key={t} className="chip" data-on={tab === t} onClick={() => setTab(t)}>
            {t === 'post' ? 'Posts' : t === 'comment' ? 'Comments' : 'Files'} · {counts[t]}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : counts[tab] === 0 ? (
        <Empty icon={<Trash2 size={40} />} title="Nothing here" />
      ) : (
        <div className="flex flex-col gap-2">
          {tab === 'post' &&
            d!.posts.map((p) => (
              <Row key={p.id} type="post" id={p.id} title={p.title || p.body}
                sub={`by ${p.author?.name ?? '?'} · deleted ${timeAgo(p.deletedAt!)} · ${p.attachments.length} file(s)`}
                icon={p.attachments[0]?.thumbUrl ? <img src={p.attachments[0].thumbUrl} className="h-12 w-12 rounded-lg object-cover" alt="" /> : undefined} />
            ))}
          {tab === 'comment' && d!.comments.map((c) => <Row key={c.id} type="comment" id={c.id} title={c.body} sub={`by ${c.author.name} · deleted ${timeAgo(c.deletedAt!)}`} icon={<MessageCircle size={20} className="text-muted" />} />)}
          {tab === 'attachment' &&
            d!.attachments.map((a) => (
              <Row key={a.id} type="attachment" id={a.id} title={a.filename} sub={`${a.kind} · ${bytes(a.size)} · deleted ${timeAgo(a.deletedAt)}`}
                icon={a.thumbUrl ? <img src={a.thumbUrl} className="h-12 w-12 rounded-lg object-cover" alt="" /> : <File size={20} className="text-muted" />} />
            ))}
        </div>
      )}
    </div>
  );
}
