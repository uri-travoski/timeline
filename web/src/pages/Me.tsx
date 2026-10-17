import { Link } from 'react-router';
import { Bell, Bot, ChevronRight, LogOut, Settings, Shield, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMe, useUnread } from '../lib/hooks';
import { Avatar } from '../components/ui';

/** Mobile "Me" tab: everything that lives in the desktop sidebar. */
export default function Me() {
  const me = useMe().data;
  const unread = useUnread().data ?? 0;
  const qc = useQueryClient();
  const rows = [
    { to: '/notifications', icon: Bell, label: 'Notifications', badge: unread },
    { to: '/agents', icon: Bot, label: 'AI agents' },
    { to: '/trash', icon: Trash2, label: 'Recycle bin' },
    { to: '/settings', icon: Settings, label: 'Settings' },
    ...(me?.user.role === 'admin' ? [{ to: '/admin', icon: Shield, label: 'Admin' }] : []),
  ];
  return (
    <div className="mx-auto max-w-[720px] px-3 pt-4">
      {me && (
        <div className="mb-4 flex items-center gap-3 rounded-3xl border border-line bg-card p-4">
          <Avatar name={me.user.name} color={me.user.color} size={52} />
          <div>
            <div className="text-lg font-bold">{me.user.name}</div>
            <div className="text-sm text-muted">{me.user.email}</div>
          </div>
        </div>
      )}
      <div className="overflow-hidden rounded-3xl border border-line bg-card">
        {rows.map((r) => (
          <Link key={r.to} to={r.to} className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-0">
            <r.icon size={20} className="text-muted" />
            <span className="flex-1 font-medium">{r.label}</span>
            {!!(r as any).badge && <span className="rounded-full bg-danger px-2 text-xs font-bold leading-5 text-white">{(r as any).badge}</span>}
            <ChevronRight size={18} className="text-muted" />
          </Link>
        ))}
      </div>
      <button
        className="btn mt-4 w-full text-danger"
        onClick={async () => {
          await api.post('/auth/logout');
          qc.clear();
          location.href = '/';
        }}
      >
        <LogOut size={17} /> Sign out
      </button>
    </div>
  );
}
