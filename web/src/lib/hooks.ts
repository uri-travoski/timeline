import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, type Category, type Filters, type Me } from './api';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me'), staleTime: 60_000, retry: false });
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), staleTime: 60_000 });
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: () => api.get<{ name: string; postCount: number }[]>('/tags'), staleTime: 60_000 });
}

/** Bell badge: polls every 20 s and on focus. */
export function useUnread() {
  return useQuery({
    queryKey: ['unread'],
    queryFn: () => api.get<{ unread: number }>('/notifications/count'),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    select: (d) => d.unread,
  });
}

const LIST_KEYS = ['timelines', 'categories', 'tags', 'fileTypes', 'authors'] as const;

/** Feed filters live in the URL so a filtered view can be bookmarked or shared. */
export function useFilters(): [Filters, (patch: Partial<Filters>) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const me = useMe().data;
  const view = me?.user.settings.timelineView;
  const viewOk = !!view && view !== 'me' && (view === 'all' || me!.timelines.some((t) => t.id === view));
  const filters = useMemo<Filters>(() => {
    const f: Filters = {};
    for (const k of LIST_KEYS) {
      const v = params.get(k);
      if (v) (f as any)[k] = v.split(',').filter(Boolean);
    }
    if (params.get('tagMode') === 'all') f.tagMode = 'all';
    for (const k of ['from', 'to', 'q'] as const) {
      const v = params.get(k);
      if (v) f[k] = v;
    }
    if (params.get('unread') === 'true') f.unread = true;
    // Which timelines to show is an account setting (Settings → Timelines); a ?timelines= link still wins.
    if (!f.timelines && viewOk) f.timelines = view === 'all' ? ['all'] : [view!];
    return f;
  }, [params, view, viewOk]);

  const update = useCallback(
    (patch: Partial<Filters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)) next.delete(k);
            else next.set(k, Array.isArray(v) ? v.join(',') : String(v));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
  return [filters, update, clear];
}

export function countActiveFilters(f: Filters) {
  return (
    (f.categories?.length ? 1 : 0) +
    (f.tags?.length ? 1 : 0) +
    (f.fileTypes?.length ? 1 : 0) +
    (f.from || f.to ? 1 : 0) +
    (f.authors?.length ? 1 : 0) +
    (f.unread ? 1 : 0)
  );
}

// ------------------------------- read tracking -------------------------------

let pending = new Set<string>();
let timer: number | undefined;

export function queueMarkRead(qc: QueryClient, id: string) {
  pending.add(id);
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const ids = [...pending];
    pending = new Set();
    if (!ids.length) return;
    await api.post('/reads', { postIds: ids }).catch(() => {});
    setReadInCache(qc, ids, true);
    qc.invalidateQueries({ queryKey: ['unread'] });
  }, 1500);
}

export function setReadInCache(qc: QueryClient, ids: string[], isRead: boolean) {
  const set = new Set(ids);
  qc.setQueriesData({ queryKey: ['posts'] }, (old: any) => {
    if (!old?.pages) return old;
    return {
      ...old,
      pages: old.pages.map((p: any) => ({
        ...p,
        // Reminder cards disappear once read.
        items: p.items
          .filter((x: any) => !(isRead && x.kind === 'reminder' && set.has(x.id)))
          .map((x: any) => (set.has(x.id) ? { ...x, isRead } : x)),
      })),
    };
  });
}

/** Marks a post read after it has been at least half visible for ~1.2 s (when auto mode is on). */
export function useAutoRead(id: string, isRead: boolean, enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  const qc = useQueryClient();
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || isRead) return;
    let t: number | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) t = window.setTimeout(() => queueMarkRead(qc, id), 1200);
        else window.clearTimeout(t);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(t);
    };
  }, [id, isRead, enabled, qc]);
  return ref;
}

// ------------------------------- theme -------------------------------

export const THEMES = [
  { id: 'system', name: 'System', swatch: ['#f5f6fa', '#0b0d12'] },
  { id: 'light', name: 'Light', swatch: ['#ffffff', '#6d5dfc'] },
  { id: 'dark', name: 'Dark', swatch: ['#161a23', '#7c6cff'] },
  { id: 'amoled', name: 'AMOLED', swatch: ['#000000', '#8b7bff'] },
  { id: 'nord', name: 'Nord', swatch: ['#3b4252', '#88c0d0'] },
  { id: 'ocean', name: 'Ocean', swatch: ['#0f2436', '#38bdf8'] },
  { id: 'forest', name: 'Forest', swatch: ['#17231c', '#34d399'] },
  { id: 'sepia', name: 'Sepia', swatch: ['#fdf8ec', '#b4532a'] },
  { id: 'rose', name: 'Rose', swatch: ['#ffffff', '#e11d48'] },
];

export function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('tl-theme', theme);
  } catch {}
}

// ------------------------------- formatting -------------------------------

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function timeAgo(iso: string) {
  const d = new Date(iso);
  const s = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 45) return s > 0 ? 'in a moment' : 'just now';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 6) return rtf.format(Math.round(s / 86400), 'day');
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function fullDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

export function duration(sec: number | null) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const SOURCE_LABEL: Record<string, string> = {
  web: 'Web',
  android: 'Android',
  ios: 'iPhone',
  api: 'API',
  agent: 'AI agent',
  email: 'Email',
  import: 'Import',
  reminder: 'Reminder',
};
