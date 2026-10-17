import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Cloud, Database, HardDrive } from 'lucide-react-native';
import { api, type Settings } from '../src/api';
import { registerForPush } from '../src/push';
import { bytes, useMe } from '../src/state';
import { THEMES, THEME_NAMES, useTheme } from '../src/theme';
import { Screen } from '../src/components/Screen';
import { Button, Card, Row, T } from '../src/components/ui';

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <Row style={{ paddingVertical: 8 }}>
      <View style={{ flex: 1 }}>
        <T>{label}</T>
        {hint && <T muted size={12.5}>{hint}</T>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.accent, false: t.line }} thumbColor="#fff" />
    </Row>
  );
}

export default function SettingsScreen() {
  const t = useTheme();
  const qc = useQueryClient();
  const me = useMe().data;
  const storage = useQuery({ queryKey: ['storage'], queryFn: () => api.get<any>('/storage') });
  const shares = useQuery({ queryKey: ['shares'], queryFn: () => api.get<any>('/shares') });
  if (!me) return null;
  const s = me.user.settings;
  const save = async (patch: Partial<Settings>) => {
    qc.setQueryData(['me'], (old: any) => old && { ...old, user: { ...old.user, settings: { ...old.user.settings, ...patch, push: { ...old.user.settings.push, ...(patch.push ?? {}) } } } });
    await api.patch('/me', { settings: patch }).catch((e) => Alert.alert('Error', e.message));
    qc.invalidateQueries({ queryKey: ['me'] });
  };
  const connectDrive = async () => {
    try {
      const { url } = await api.get<{ url: string }>('/storage/google/start?client=app');
      const r = await WebBrowser.openAuthSessionAsync(url, 'timeline://settings/storage');
      if (r.type === 'success' && r.url.includes('drive=connected')) Alert.alert('Google Drive connected', 'New uploads now go to your Drive.');
      qc.invalidateQueries({ queryKey: ['storage'] });
    } catch (e) {
      Alert.alert('Google Drive', (e as Error).message);
    }
  };
  const hasDrive = storage.data?.backends.some((b: any) => b.type === 'gdrive' && !b.shared);

  return (
    <Screen title="Settings" back>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 40 }}>
        <Card>
          <T bold size={16} style={{ marginBottom: 10 }}>Theme</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {THEME_NAMES.map((n) => {
              const p = THEMES[n] ?? (t.dark ? THEMES.dark : THEMES.light);
              const on = s.theme === n;
              return (
                <Pressable key={n} onPress={() => save({ theme: n })} style={{ width: '31%', alignItems: 'center', gap: 6, padding: 8, borderRadius: 7, borderWidth: 1.5, borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accentSoft : 'transparent' }}>
                  <View style={{ flexDirection: 'row', height: 26, width: '100%', borderRadius: 5, overflow: 'hidden' }}>
                    <View style={{ flex: 2, backgroundColor: n === 'system' ? '#f5f6fa' : p.card }} />
                    <View style={{ flex: 1, backgroundColor: n === 'system' ? '#0b0d12' : p.accent }} />
                  </View>
                  <T size={12.5}>{n[0].toUpperCase() + n.slice(1)}</T>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Card>
          <T bold size={16} style={{ marginBottom: 6 }}>Reading</T>
          {(['auto', 'manual'] as const).map((m) => (
            <Pressable key={m} onPress={() => save({ markRead: m })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: s.markRead === m ? t.accent : t.line, alignItems: 'center', justifyContent: 'center' }}>
                {s.markRead === m && <Check size={13} color={t.accent} strokeWidth={3} />}
              </View>
              <View style={{ flex: 1 }}>
                <T>{m === 'auto' ? 'Mark read automatically as I scroll' : 'Mark read manually'}</T>
                <T muted size={12.5}>{m === 'auto' ? 'A post counts as read after a moment on screen.' : 'Use the “Mark read” button on each post.'}</T>
              </View>
            </Pressable>
          ))}
          <Toggle label="Data saver" hint="Reels preload one video ahead instead of up to four." value={s.dataSaver} onChange={(v) => save({ dataSaver: v })} />
          <Toggle label="Reels start with sound" value={!s.reelsMuted} onChange={(v) => save({ reelsMuted: !v })} />
        </Card>

        <Card>
          <T bold size={16} style={{ marginBottom: 6 }}>Notifications</T>
          <Toggle label="New posts from my AI agents" value={s.push.agent_post} onChange={(v) => save({ push: { ...s.push, agent_post: v } })} />
          <Toggle label="Reminders" value={s.push.reminder} onChange={(v) => save({ push: { ...s.push, reminder: v } })} />
          <Toggle label="Comments on my posts" value={s.push.comment} onChange={(v) => save({ push: { ...s.push, comment: v } })} />
          <Toggle label="Timeline shared with me" value={s.push.share} onChange={(v) => save({ push: { ...s.push, share: v } })} />
          <Row style={{ marginTop: 8 }}>
            <Button title="Re-register phone" onPress={async () => Alert.alert('Push', await registerForPush())} style={{ flex: 1 }} />
            <Button title="Test" onPress={async () => { const r = await api.post<{ devices: number }>('/push/test'); Alert.alert('Test sent', `${r.devices} device(s) registered`); }} style={{ flex: 1 }} />
          </Row>
        </Card>

        <Card>
          <T bold size={16} style={{ marginBottom: 6 }}>Storage</T>
          {storage.data?.backends.map((b: any) => (
            <Row key={b.id} style={{ paddingVertical: 8 }} gap={10}>
              {b.type === 'gdrive' ? <Cloud size={20} color={t.muted} /> : b.type === 's3' ? <Database size={20} color={t.muted} /> : <HardDrive size={20} color={t.muted} />}
              <View style={{ flex: 1 }}>
                <T bold={b.isDefault}>{b.name}{b.isDefault ? '  · default' : ''}</T>
                <T muted size={12}>{b.detail} · {b.files} files · {bytes(b.bytes)}</T>
              </View>
              {!b.isDefault && <Button title="Use" onPress={async () => (await api.patch('/me', { settings: { defaultBackendId: b.id } }), qc.invalidateQueries({ queryKey: ['storage'] }))} style={{ paddingVertical: 6 }} />}
            </Row>
          ))}
          {storage.data && (
            <Button title={hasDrive ? 'Reconnect Google Drive' : 'Connect Google Drive'} kind={hasDrive ? 'default' : 'primary'} icon={<Cloud size={18} color={hasDrive ? t.text : '#fff'} />} onPress={connectDrive} disabled={!storage.data.googleConfigured} style={{ marginTop: 8 }} />
          )}
          {storage.data && !storage.data.googleConfigured && <T muted size={12} style={{ marginTop: 6 }}>Google Drive isn't enabled on the server yet (admin: see README).</T>}
        </Card>

        {!!shares.data?.incoming.filter((x: any) => x.status === 'pending').length && (
          <Card>
            <T bold size={16} style={{ marginBottom: 6 }}>Shared with you</T>
            {shares.data.incoming.filter((x: any) => x.status === 'pending').map((x: any) => (
              <Row key={x.ownerId} style={{ paddingVertical: 6 }}>
                <T style={{ flex: 1 }}>{x.user.name} wants to share their timeline</T>
                <Button title="Accept" kind="primary" onPress={async () => (await api.post(`/shares/${x.ownerId}/accept`), qc.invalidateQueries({ queryKey: ['shares'] }), qc.invalidateQueries({ queryKey: ['me'] }))} style={{ paddingVertical: 6 }} />
              </Row>
            ))}
          </Card>
        )}
        <T muted size={12} style={{ textAlign: 'center' }}>Agents, API keys, categories and sharing are managed in the web app.</T>
      </ScrollView>
    </Screen>
  );
}
