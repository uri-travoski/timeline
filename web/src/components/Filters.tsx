import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, Check, FileText, Film, Image, Lock, Music, Paperclip, Type } from 'lucide-react';
import { api, type Filters } from '../lib/api';
import { useCategories, useMe, useTags } from '../lib/hooks';
import { AgentBadge } from './ui';

export const FILE_TYPES = [
  { id: 'image', label: 'Images', icon: Image },
  { id: 'video', label: 'Videos', icon: Film },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'pdf', label: 'PDF', icon: FileText },
  { id: 'document', label: 'Docs', icon: FileText },
  { id: 'archive', label: 'Archives', icon: Archive },
  { id: 'other', label: 'Other files', icon: Paperclip },
  { id: 'text', label: 'Text only', icon: Type },
];

const toggle = (list: string[] | undefined, v: string) => {
  const l = list ?? [];
  return l.some((x) => x.toLowerCase() === v.toLowerCase()) ? l.filter((x) => x.toLowerCase() !== v.toLowerCase()) : [...l, v];
};
const has = (list: string[] | undefined, v: string) => !!list?.some((x) => x.toLowerCase() === v.toLowerCase());

function Box({ on }: { on: boolean }) {
  return (
    <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] border-[1.5px] ${on ? 'border-accent bg-accent text-white' : 'border-line'}`}>
      {on && <Check size={12} strokeWidth={3} />}
    </span>
  );
}

function H({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted">
      {children}
      {action}
    </div>
  );
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function FilterPanel({ filters, set, clear, hideFileTypes }: { filters: Filters; set: (p: Partial<Filters>) => void; clear: () => void; hideFileTypes?: boolean }) {
  const cats = useCategories().data ?? [];
  const tags = useTags().data ?? [];
  const me = useMe().data;
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<any[]>('/agents'), enabled: !!me }).data ?? [];
  const [allTags, setAllTags] = useState(false);
  // Category names are merged across combined timelines (Personal from both people = one filter).
  const catNames = [...new Map(cats.map((c) => [c.name.toLowerCase(), c])).values()];
  const shownTags = allTags ? tags : tags.slice(0, 14);

  const preset = (days: number | null) => {
    if (days === null) set({ from: undefined, to: undefined });
    else set({ from: iso(new Date(Date.now() - days * 86400_000)), to: undefined });
  };
  const presetOn = (days: number) => filters.from === iso(new Date(Date.now() - days * 86400_000)) && !filters.to;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <H action={<button className="normal-case tracking-normal text-accent-text" onClick={clear}>Clear all</button>}>Categories</H>
        <div className="flex flex-col gap-2">
          {catNames.map((c) => (
            <button key={c.id} className="flex items-center gap-2.5 text-left text-sm" onClick={() => set({ categories: toggle(filters.categories, c.name) })}>
              <Box on={has(filters.categories, c.name)} />
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              <span className="flex-1">{c.name}</span>
              {c.isPrivate && <Lock size={12} className="text-muted" />}
              <span className="text-xs text-muted">{cats.filter((x) => x.name.toLowerCase() === c.name.toLowerCase()).reduce((n, x) => n + x.postCount, 0).toLocaleString()}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <H
          action={
            <div className="flex rounded-lg border border-line p-0.5 normal-case tracking-normal">
              {(['any', 'all'] as const).map((m) => (
                <button key={m} className={`rounded-md px-2 py-0.5 ${(filters.tagMode ?? 'any') === m ? 'bg-raised text-text' : ''}`} onClick={() => set({ tagMode: m === 'all' ? 'all' : undefined })}>
                  {m === 'any' ? 'Any' : 'All'}
                </button>
              ))}
            </div>
          }
        >
          Tags
        </H>
        <div className="flex flex-wrap gap-1.5">
          {shownTags.map((t) => (
            <button key={t.name} className="chip py-1 text-xs" data-on={has(filters.tags, t.name)} onClick={() => set({ tags: toggle(filters.tags, t.name) })}>
              #{t.name}
            </button>
          ))}
          {tags.length > 14 && (
            <button className="chip py-1 text-xs" onClick={() => setAllTags((s) => !s)}>
              {allTags ? 'Less' : `+ ${tags.length - 14}`}
            </button>
          )}
          {tags.length === 0 && <span className="text-sm text-muted">No tags yet</span>}
        </div>
      </div>

      <div>
        <H>Date range</H>
        <div className="grid grid-cols-2 gap-2">
          <label className="rounded-xl border border-line bg-card px-2.5 py-1.5 text-xs text-muted">
            From
            <input type="date" className="block w-full bg-transparent text-sm text-text outline-none" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
          </label>
          <label className="rounded-xl border border-line bg-card px-2.5 py-1.5 text-xs text-muted">
            To
            <input type="date" className="block w-full bg-transparent text-sm text-text outline-none" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
          </label>
        </div>
        <div className="mt-2 flex rounded-xl border border-line bg-card p-0.5 text-xs">
          {[
            ['7d', 7],
            ['30d', 30],
            ['1y', 365],
            ['5y', 365 * 5],
          ].map(([l, d]) => (
            <button key={l} className={`flex-1 rounded-lg py-1.5 ${presetOn(d as number) ? 'bg-raised text-text' : 'text-muted'}`} onClick={() => preset(d as number)}>
              {l}
            </button>
          ))}
          <button className={`flex-1 rounded-lg py-1.5 ${!filters.from && !filters.to ? 'bg-raised text-text' : 'text-muted'}`} onClick={() => preset(null)}>
            All
          </button>
        </div>
      </div>

      {!hideFileTypes && (
        <div>
          <H>File type</H>
          <div className="flex flex-wrap gap-1.5">
            {FILE_TYPES.map((f) => (
              <button key={f.id} className="chip py-1 text-xs" data-on={has(filters.fileTypes, f.id)} onClick={() => set({ fileTypes: toggle(filters.fileTypes, f.id) })}>
                <f.icon size={13} />
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {me && (
        <div>
          <H>Posted by</H>
          <div className="flex flex-col gap-2">
            {[{ id: me.user.id, name: 'Me', kind: 'human' }, ...agents.filter((a) => !a.disabled)].map((a: any) => (
              <button key={a.id} className="flex items-center gap-2.5 text-left text-sm" onClick={() => set({ authors: toggle(filters.authors, a.id) })}>
                <Box on={has(filters.authors, a.id)} />
                <span className="flex-1">{a.name}</span>
                {a.kind === 'agent' && <AgentBadge small />}
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="flex items-center gap-2.5 text-left text-sm" onClick={() => set({ unread: !filters.unread })}>
        <Box on={!!filters.unread} />
        Unread only
      </button>
    </div>
  );
}
