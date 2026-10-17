import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react-native';
import { api, type Filters } from '../api';
import { useCategories, useFilters, useMe, useTags } from '../state';
import { useTheme } from '../theme';
import { AgentBadge, Button, Chip, Row, Sheet, T } from './ui';

const FILE_TYPES = [
  ['image', 'Images'], ['video', 'Videos'], ['audio', 'Audio'], ['pdf', 'PDF'], ['document', 'Docs'], ['archive', 'Archives'], ['other', 'Other'], ['text', 'Text only'],
];

const toggle = (l: string[] | undefined, v: string) => (l?.includes(v) ? l.filter((x) => x !== v) : [...(l ?? []), v]);
const iso = (d: Date) => d.toISOString().slice(0, 10);

function Box({ on }: { on: boolean }) {
  const t = useTheme();
  return (
    <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {on && <Check size={13} color="#fff" strokeWidth={3} />}
    </View>
  );
}

function H({ children }: { children: string }) {
  return <T muted bold size={12} style={{ letterSpacing: 1, marginTop: 18, marginBottom: 10 }}>{children.toUpperCase()}</T>;
}

export function FilterSheet({ open, onClose, hideFileTypes }: { open: boolean; onClose: () => void; hideFileTypes?: boolean }) {
  const t = useTheme();
  const [filters, setFilters] = useFilters();
  const set = (p: Partial<Filters>) => setFilters({ ...filters, ...p });
  const cats = useCategories().data ?? [];
  const tags = useTags().data ?? [];
  const me = useMe().data;
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<any[]>('/agents') }).data ?? [];
  const names = [...new Map(cats.map((c) => [c.name.toLowerCase(), c])).values()];
  const [allTags, setAllTags] = useState(false);
  const preset = (days: number | null) => set({ from: days === null ? undefined : iso(new Date(Date.now() - days * 86400_000)), to: undefined });

  return (
    <Sheet open={open} onClose={onClose} title="Filters" footer={<Row><Button title="Clear" onPress={() => setFilters({ q: filters.q, timelines: filters.timelines })} style={{ flex: 1 }} /><Button title="Show results" kind="primary" onPress={onClose} style={{ flex: 2 }} /></Row>}>
      <H>Categories</H>
      {names.map((c) => (
        <Pressable key={c.id} onPress={() => set({ categories: toggle(filters.categories, c.name) })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
          <Box on={!!filters.categories?.includes(c.name)} />
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.color }} />
          <T style={{ flex: 1 }}>{c.name}{c.isPrivate ? ' 🔒' : ''}</T>
          <T muted size={12}>{c.postCount}</T>
        </Pressable>
      ))}

      <Row style={{ marginTop: 18, marginBottom: 10 }}>
        <T muted bold size={12} style={{ letterSpacing: 1, flex: 1 }}>TAGS</T>
        <Chip label="Any" on={filters.tagMode !== 'all'} onPress={() => set({ tagMode: undefined })} />
        <Chip label="All" on={filters.tagMode === 'all'} onPress={() => set({ tagMode: 'all' })} />
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(allTags ? tags : tags.slice(0, 16)).map((x) => (
          <Chip key={x.name} label={`#${x.name}`} on={!!filters.tags?.includes(x.name)} onPress={() => set({ tags: toggle(filters.tags, x.name) })} />
        ))}
        {tags.length > 16 && <Chip label={allTags ? 'Less' : `+${tags.length - 16}`} onPress={() => setAllTags(!allTags)} />}
      </View>

      <H>Date range</H>
      <Row>
        <TextInput placeholder="From YYYY-MM-DD" placeholderTextColor={t.muted} value={filters.from ?? ''} onChangeText={(v) => set({ from: /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : v || undefined })}
          style={{ flex: 1, color: t.text, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 5, padding: 10 }} />
        <TextInput placeholder="To YYYY-MM-DD" placeholderTextColor={t.muted} value={filters.to ?? ''} onChangeText={(v) => set({ to: v || undefined })}
          style={{ flex: 1, color: t.text, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 5, padding: 10 }} />
      </Row>
      <Row style={{ marginTop: 8, flexWrap: 'wrap' }} gap={6}>
        {([['7 days', 7], ['30 days', 30], ['1 year', 365], ['5 years', 1825]] as const).map(([l, d]) => (
          <Chip key={l} label={l} on={filters.from === iso(new Date(Date.now() - d * 86400_000))} onPress={() => preset(d)} />
        ))}
        <Chip label="All time" on={!filters.from && !filters.to} onPress={() => preset(null)} />
      </Row>

      {!hideFileTypes && (
        <>
          <H>File type</H>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {FILE_TYPES.map(([id, label]) => (
              <Chip key={id} label={label} on={!!filters.fileTypes?.includes(id)} onPress={() => set({ fileTypes: toggle(filters.fileTypes, id) })} />
            ))}
          </View>
        </>
      )}

      <H>Posted by</H>
      {[{ id: me?.user.id ?? '', name: 'Me', kind: 'human' }, ...agents.filter((a) => !a.disabled)].map((a: any) => (
        <Pressable key={a.id} onPress={() => set({ authors: toggle(filters.authors, a.id) })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
          <Box on={!!filters.authors?.includes(a.id)} />
          <T style={{ flex: 1 }}>{a.name}</T>
          {a.kind === 'agent' && <AgentBadge small />}
        </Pressable>
      ))}
      <Pressable onPress={() => set({ unread: !filters.unread })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
        <Box on={!!filters.unread} />
        <T>Unread only</T>
      </Pressable>
    </Sheet>
  );
}
