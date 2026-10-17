import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Bell, Bot, Clapperboard, Cloud, Home, Plus, Search, Settings, Shield, Trash2, User } from 'lucide-react';
import { api } from '../lib/api';
import { useFilters, useMe, useUnread } from '../lib/hooks';
import { useComposer } from './Composer';
import { Avatar } from './ui';

function NavItem({ to, icon, children, badge, count }: { to: string; icon: ReactNode; children: ReactNode; badge?: number; count?: number }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium ${isActive ? 'bg-raised text-text' : 'text-muted hover:text-text'}`}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {!!badge && <span className="rounded-full bg-danger px-1.5 text-[11px] font-bold leading-[18px] text-white">{badge > 99 ? '99+' : badge}</span>}
      {!badge && !!count && <span className="text-xs text-muted">{count}</span>}
    </NavLink>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return <img src="/icon.svg" width={size} height={size} alt="" className="rounded-md" />;
}

// Logo + name: back to the unfiltered timeline, scrolled to the top.
function HomeLink({ className, children }: { className: string; children: ReactNode }) {
  return (
    <Link to="/" className={className} aria-label="Timeline home" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      {children}
    </Link>
  );
}

function SearchBox({ className = '' }: { className?: string }) {
  const [filters, set] = useFilters();
  const loc = useLocation();
  const nav = useNavigate();
  const [q, setQ] = useState(filters.q ?? '');
  useEffect(() => setQ(filters.q ?? ''), [filters.q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select')) {
        e.preventDefault();
        document.getElementById('tl-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <form
      className={`flex items-center gap-2.5 rounded-xl border border-line bg-card px-3.5 text-muted focus-within:border-accent ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (loc.pathname !== '/' && loc.pathname !== '/reels') nav(`/?q=${encodeURIComponent(q)}`);
        else set({ q: q.trim() || undefined });
      }}
    >
      <Search size={17} />
      <input id="tl-search" className="min-w-0 flex-1 bg-transparent py-2.5 text-text outline-none" placeholder="Search posts, tags, files…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
      <kbd className="hidden rounded-md border border-line px-1.5 text-[11px] lg:block">/</kbd>
    </form>
  );
}

function BellButton() {
  const unread = useUnread().data ?? 0;
  return (
    <NavLink to="/notifications" className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-card" aria-label={`Notifications (${unread} unread)`}>
      <Bell size={19} />
      {unread > 0 && (
        <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-bg bg-danger px-1 text-[11px] font-bold text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </NavLink>
  );
}

export function Layout() {
  const me = useMe().data;
  const unread = useUnread().data ?? 0;
  const composer = useComposer();
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const storage = useQuery({ queryKey: ['storage'], queryFn: () => api.get<any>('/storage'), staleTime: 300_000 }).data;
  const reminders = useQuery({ queryKey: ['reminders'], queryFn: () => api.get<any[]>('/reminders'), staleTime: 60_000 }).data;
  const trash = useQuery({ queryKey: ['trash'], queryFn: () => api.get<any>('/trash'), staleTime: 60_000 }).data;
  const isReels = loc.pathname.startsWith('/reels');

  // Badge in the tab title and on the installed app icon.
  useEffect(() => {
    document.title = unread ? `(${unread}) Timeline` : 'Timeline';
    (navigator as any).setAppBadge?.(unread).catch?.(() => {});
  }, [unread]);

  // Notification clicks from the service worker, and ?n=<id> deep links.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => e.data?.type === 'navigate' && nav(e.data.url);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, [nav]);
  useEffect(() => {
    const n = params.get('n');
    if (!n) return;
    api.post('/notifications/read', { ids: [n] }).then(() => qc.invalidateQueries({ queryKey: ['unread'] }));
    params.delete('n');
    setParams(params, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isReels) return <Outlet />;

  const drive = storage?.backends.find((b: any) => b.isDefault);
  const trashCount = trash ? trash.posts.length + trash.comments.length + trash.attachments.length : 0;

  return (
    <div className="mx-auto flex min-h-full max-w-[1600px]">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-line bg-panel px-3.5 py-5 lg:flex">
        <HomeLink className="mb-5 flex items-center gap-2.5 rounded-md px-2.5 py-1 text-xl font-bold hover:bg-raised">
          <Logo /> Timeline
        </HomeLink>
        <NavItem to="/" icon={<Home size={19} />}>Timeline</NavItem>
        <NavItem to="/reels" icon={<Clapperboard size={19} />}>Reels</NavItem>
        <NavItem to="/notifications" icon={<Bell size={19} />} badge={unread}>Notifications</NavItem>
        <NavItem to="/reminders" icon={<AlarmClock size={19} />} count={reminders?.length}>Reminders</NavItem>
        <NavItem to="/agents" icon={<Bot size={19} />}>AI agents</NavItem>
        <NavItem to="/trash" icon={<Trash2 size={19} />} count={trashCount}>Recycle bin</NavItem>
        <div className="mx-1.5 my-3 h-px bg-line" />
        <NavItem to="/settings" icon={<Settings size={19} />}>Settings</NavItem>
        {me?.user.role === 'admin' && <NavItem to="/admin" icon={<Shield size={19} />}>Admin</NavItem>}
        {me && (
          <NavLink to="/settings" className="mt-auto flex items-center gap-2.5 rounded-2xl bg-raised p-2.5">
            <Avatar name={me.user.name} color={me.user.color} src={me.user.avatarUrl} size={36} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{me.user.name}</div>
              <div className="flex items-center gap-1 truncate text-xs text-muted">
                {drive?.type === 'gdrive' ? <Cloud size={12} /> : null}
                {drive ? drive.name : ''}
              </div>
            </div>
          </NavLink>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-lg lg:px-7">
          <HomeLink className="flex shrink-0 items-center lg:hidden">
            <Logo size={28} />
          </HomeLink>
          <SearchBox className="min-w-0 flex-1" />
          <BellButton />
          <button className="btn btn-primary hidden sm:inline-flex" onClick={() => composer.open()}>
            <Plus size={18} /> New post
          </button>
        </header>
        <main className="min-w-0 flex-1 pb-28 lg:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-start justify-around border-t border-line bg-panel/95 pt-2 backdrop-blur-lg safe-bottom lg:hidden" style={{ minHeight: 64 }}>
        <Tab to="/" icon={<Home size={22} />} label="Timeline" />
        <Tab to="/reels" icon={<Clapperboard size={22} />} label="Reels" />
        <button className="-mt-1 grid h-12 w-12 place-items-center rounded-md bg-accent text-white" onClick={() => composer.open()} aria-label="New post">
          <Plus size={24} />
        </button>
        <Tab to="/reminders" icon={<AlarmClock size={22} />} label="Reminders" />
        <Tab to="/me" icon={<User size={22} />} label="Me" />
      </nav>
    </div>
  );
}

function Tab({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `flex w-16 flex-col items-center gap-0.5 pb-1 text-[10.5px] font-semibold ${isActive ? 'text-text' : 'text-muted'}`}>
      {icon}
      {label}
    </NavLink>
  );
}

