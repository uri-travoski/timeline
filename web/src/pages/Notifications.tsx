import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Bell, CheckCheck, MessageCircle, Users } from 'lucide-react';
import { useState } from 'react';
import { api, type Notification } from '../lib/api';
import { timeAgo } from '../lib/hooks';
import { Avatar, Empty, Spinner } from '../components/ui';

const ICON = { reminder: AlarmClock, comment: MessageCircle, share: Users, agent_post: Bell };

export default function Notifications() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ['notifications', unreadOnly],
    queryFn: () => api.get<{ unread: number; items: Notification[] }>(`/notifications?limit=100${unreadOnly ? '&unread=true' : ''}`),
    refetchInterval: 20_000,
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read', { all: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
    },
  });
  const open = async (n: Notification) => {
    if (!n.readAt) {
      await api.post('/notifications/read', { ids: [n.id] });
      qc.invalidateQueries({ queryKey: ['unread'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (n.type === 'share') nav('/settings#sharing');
    else if (n.postId) nav(`/post/${n.postId}`);
  };

  return (
    <div className="mx-auto max-w-[720px] px-3 pt-4 sm:px-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">Notifications</h1>
        <button className="chip" data-on={unreadOnly} onClick={() => setUnreadOnly(true)}>
          Unread{q.data ? ` · ${q.data.unread}` : ''}
        </button>
        <button className="chip" data-on={!unreadOnly} onClick={() => setUnreadOnly(false)}>
          All
        </button>
        <button className="chip" onClick={() => markAll.mutate()} disabled={!q.data?.unread}>
          <CheckCheck size={14} /> Mark all read
        </button>
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.items.length ? (
        <Empty icon={<Bell size={40} />} title={unreadOnly ? "You're all caught up" : 'No notifications yet'}>
          New posts from your AI agents, reminders and comments show up here.
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {q.data.items.map((n) => {
            const Icon = ICON[n.type] ?? Bell;
            return (
              <button key={n.id} onClick={() => open(n)} className={`flex items-start gap-3 rounded-2xl border border-line p-3.5 text-left transition hover:border-accent ${n.readAt ? 'bg-card' : 'border-gold/30 bg-[color-mix(in_srgb,var(--gold)_9%,var(--card))] shadow-[inset_3px_0_0_var(--gold)]'}`}>
                {n.type === 'reminder' ? (
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold text-black/80">
                    <AlarmClock size={19} />
                  </div>
                ) : n.actor ? (
                  <Avatar name={n.actor.name} color={n.actor.color} src={n.actor.avatarUrl} kind={n.actor.kind} size={40} />
                ) : (
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-raised">
                    <Icon size={19} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{n.title}</div>
                  {n.body && <div className="line-clamp-2 text-sm text-muted">{n.body}</div>}
                  <div className="mt-1 text-xs text-muted">{timeAgo(n.createdAt)}</div>
                </div>
                {!n.readAt && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-gold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
