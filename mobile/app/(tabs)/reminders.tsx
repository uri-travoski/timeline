import { useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Plus, Repeat, Trash2 } from 'lucide-react-native';
import { api, type Reminder } from '../../src/api';
import { timeAgo } from '../../src/state';
import { useTheme } from '../../src/theme';
import { Screen } from '../../src/components/Screen';
import { BellButton } from '../../src/components/Header';
import { Button, Chip, Empty, Loading, Row, Sheet, T } from '../../src/components/ui';

const PRESETS: [string, () => Date][] = [
  ['In 1 hour', () => new Date(Date.now() + 3600_000)],
  ['Tonight 8pm', () => { const d = new Date(); d.setHours(20, 0, 0, 0); return d; }],
  ['Tomorrow 9am', () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }],
  ['Next week', () => new Date(Date.now() + 7 * 86400_000)],
];
const REPEATS = [[null, 'Once'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']] as const;

export default function Reminders() {
  const t = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reminders'], queryFn: () => api.get<Reminder[]>('/reminders') });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState<Date>(PRESETS[0][1]());
  const [whenText, setWhenText] = useState('');
  const [repeat, setRepeat] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['reminders'] });

  const save = async () => {
    let due = when;
    if (whenText.trim()) {
      const d = new Date(whenText.trim().replace(' ', 'T'));
      if (Number.isNaN(d.getTime())) return Alert.alert('Use a date like 2026-10-24 09:00');
      due = d;
    }
    try {
      await api.post('/reminders', { title, dueAt: due.toISOString(), repeat });
      setOpen(false);
      setTitle('');
      setWhenText('');
      refresh();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    }
  };

  return (
    <Screen title="Reminders" right={<BellButton />}>
      {q.isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.accent} colors={[t.accent]} />}
          ListHeaderComponent={<T muted size={13} style={{ paddingHorizontal: 4, paddingBottom: 6 }}>You get a notification with sound when one is due. Your AI agents can set reminders too.</T>}
          ListEmptyComponent={<Empty icon={<AlarmClock size={40} color={t.muted} />} title="No reminders">Tap + to add one.</Empty>}
          renderItem={({ item: r }) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 7, backgroundColor: t.card, borderWidth: 1, borderColor: t.line }}>
              <View style={{ width: 40, height: 40, borderRadius: 5, backgroundColor: '#f59e0b26', alignItems: 'center', justifyContent: 'center' }}>
                <AlarmClock size={19} color="#f59e0b" />
              </View>
              <View style={{ flex: 1 }}>
                <T bold>{r.title}</T>
                <Row gap={6}>
                  <T muted size={12.5}>{new Date(r.dueAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ({timeAgo(r.dueAt)})</T>
                  {r.repeat && <Repeat size={12} color={t.muted} />}
                </Row>
                {r.createdBy && <T muted size={12}>set by {r.createdBy}</T>}
              </View>
              <Pressable hitSlop={10} onPress={() => Alert.alert('Delete reminder?', r.title, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => (await api.del(`/reminders/${r.id}`), refresh()) }])}>
                <Trash2 size={18} color={t.muted} />
              </Pressable>
            </View>
          )}
        />
      )}
      <Pressable onPress={() => setOpen(true)} style={{ position: 'absolute', right: 18, bottom: 18, width: 58, height: 58, borderRadius: 9, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', elevation: 6 }}>
        <Plus color="#fff" size={26} />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title="New reminder" footer={<Button title="Save reminder" kind="primary" onPress={save} disabled={!title.trim()} />}>
        <TextInput value={title} onChangeText={setTitle} placeholder="Remind me to…" placeholderTextColor={t.muted} autoFocus
          style={{ color: t.text, fontSize: 17, backgroundColor: t.card, borderRadius: 7, borderWidth: 1, borderColor: t.line, padding: 12 }} />
        <T muted bold size={12} style={{ marginTop: 16, marginBottom: 8 }}>WHEN</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {PRESETS.map(([l, f]) => (
            <Chip key={l} label={l} on={!whenText && Math.abs(when.getTime() - f().getTime()) < 60_000} onPress={() => (setWhen(f()), setWhenText(''))} />
          ))}
        </View>
        <TextInput value={whenText} onChangeText={setWhenText} placeholder="or exact: 2026-10-24 09:00" placeholderTextColor={t.muted}
          style={{ color: t.text, marginTop: 10, backgroundColor: t.card, borderRadius: 7, borderWidth: 1, borderColor: t.line, padding: 12 }} />
        <T muted bold size={12} style={{ marginTop: 16, marginBottom: 8 }}>REPEAT</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {REPEATS.map(([v, l]) => (
            <Chip key={l} label={l} on={repeat === v} onPress={() => setRepeat(v)} />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
