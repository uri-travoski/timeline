import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, type Category, type Filters, type Me } from './api';

export const useMe = (enabled = true) => useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me'), enabled, staleTime: 60_000 });
export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), staleTime: 60_000 });
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api.get<{ name: string; postCount: number }[]>('/tags'), staleTime: 60_000 });
export const useUnread = () =>
  useQuery({ queryKey: ['unread'], queryFn: () => api.get<{ unread: number }>('/notifications/count'), refetchInterval: 30_000, select: (d) => d.unread });

// Filters are shared by the timeline and reels tabs.
const FiltersCtx = createContext<[Filters, (f: Filters) => void]>([{}, () => {}]);
export function FiltersProvider({ children }: { children: ReactNode }) {
  const state = useState<Filters>({});
  return <FiltersCtx.Provider value={state}>{children}</FiltersCtx.Provider>;
}
export const useFilters = () => useContext(FiltersCtx);

export function activeFilterCount(f: Filters) {
  return [f.categories?.length, f.tags?.length, f.fileTypes?.length, f.from || f.to, f.authors?.length, f.unread].filter(Boolean).length;
}

// ------------------------------- read tracking -------------------------------
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function markRead(qc: QueryClient, ids: string[]) {
  ids.forEach((i) => pending.add(i));
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const batch = [...pending];
    pending = new Set();
    if (!batch.length) return;
    await api.post('/reads', { postIds: batch }).catch(() => {});
    setRead(qc, batch, true);
    qc.invalidateQueries({ queryKey: ['unread'] });
  }, 1200);
}

export function setRead(qc: QueryClient, ids: string[], isRead: boolean) {
  const set = new Set(ids);
  const patch = (old: any) =>
    old?.pages
      ? {
          ...old,
          pages: old.pages.map((p: any) => ({
            ...p,
            items: p.items
              .filter((x: any) => !(isRead && x.kind === 'reminder' && set.has(x.id)))
              .map((x: any) => (x.post ? (set.has(x.post.id) ? { ...x, post: { ...x.post, isRead } } : x) : set.has(x.id) ? { ...x, isRead } : x)),
          })),
        }
      : old;
  qc.setQueriesData({ queryKey: ['posts'] }, patch);
  qc.setQueriesData({ queryKey: ['reels'] }, patch);
}

// ------------------------------- formatting -------------------------------
export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.max(1, Math.round(f / 60))}m`;
    if (f < 86400) return `in ${Math.round(f / 3600)}h`;
    return `in ${Math.round(f / 86400)}d`;
  }
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 6) return `${Math.round(s / 86400)}d`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < 3);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

export const SOURCE_LABEL: Record<string, string> = { web: 'Web', android: 'Android', ios: 'iPhone', api: 'API', agent: 'AI agent', email: 'Email', reminder: 'Reminder' };
