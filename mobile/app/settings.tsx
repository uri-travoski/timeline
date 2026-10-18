import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Cloud, Database, HardDrive } from 'lucide-react-native';
import { api, type Settings } from '../src/api';
import { registerForPush } from '../src/push';
import { bytes, useMe } from '../src/state';
import { THEMES, THEME_NAMES, useTheme } from '../src/theme';
import { Screen } from '../src/components/Screen';
import { Button, Card, Row, T } from '../src/components/ui';
import { checkForUpdate, downloadAndInstall, installedVersion, type UpdateInfo } from '../src/updates';

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

/** Bullet points of the release notes only (drops the download-link and install lines). */
function releaseNotes(md: string) {
  return md
    .split('\n')
    .filter((l) => l.trim().startsWith('- '))
    .map((l) => '• ' + l.trim().slice(2).replace(/\*\*|`/g, ''))
    .join('\n');
}

function UpdateCard({ autoInstall }: { autoInstall: boolean }) {
  const t = useTheme();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState<'check' | 'download' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const started = useRef(false);

  const check = async (refresh: boolean) => {
    setBusy('check');
    setError('');
    try {
      const u = await checkForUpdate(refresh);
      setInfo(u);
      return u;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const install = async (u: UpdateInfo) => {
    setBusy('download');
    setError('');
    setProgress(0);
    try {
      await downloadAndInstall(u, setProgress);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    check(autoInstall).then((u) => {
      if (autoInstall && u?.updateAvailable) void install(u);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mb = info?.size ? ` · ${(info.size / 1048576).toFixed(0)} MB` : '';
  return (
    <Card>
      <T bold size={16} style={{ marginBottom: 2 }}>App updates</T>
      <T muted size={12.5}>Installed version {installedVersion()}</T>
      {info && !info.configured && <T muted size={13} style={{ marginTop: 8 }}>Updates aren't set up on your server (admin: set UPDATE_REPO, see the README).</T>}
      {info?.configured && info.error && <T style={{ marginTop: 8, color: t.danger }} size={13}>Couldn't check: {info.error}</T>}
      {info?.configured && !info.error && !info.updateAvailable && <T style={{ marginTop: 8 }} size={14}>You're up to date.</T>}
      {info?.updateAvailable && (
        <View style={{ marginTop: 8 }}>
          <T bold>Version {info.latest} is available{mb}</T>
          {!!info.notes && <T muted size={12.5} numberOfLines={8} style={{ marginTop: 4 }}>{releaseNotes(info.notes)}</T>}
        </View>
      )}
      {busy === 'download' && (
        <View style={{ marginTop: 10 }}>
          <View style={{ height: 6, backgroundColor: t.raised, borderRadius: 3, overflow: 'hidden' }}>
            <View style={{ height: 6, width: `${Math.round(progress * 100)}%`, backgroundColor: t.accent }} />
          </View>
          <T muted size={12} style={{ marginTop: 4 }}>Downloading… {Math.round(progress * 100)}%</T>
        </View>
      )}
      {!!error && <T style={{ marginTop: 8, color: t.danger }} size={13}>{error}</T>}
      <Row gap={8} style={{ marginTop: 10 }}>
        <Button title="Check for updates" loading={busy === 'check'} disabled={busy === 'download'} onPress={() => check(true)} style={{ flex: 1 }} />
        {info?.updateAvailable && Platform.OS === 'android' && <Button title="Download & install" kind="primary" loading={busy === 'download'} onPress={() => install(info)} style={{ flex: 1 }} />}
      </Row>
    </Card>
  );
}

export default function SettingsScreen() {
  const { install } = useLocalSearchParams<{ install?: string }>();
  const t = useTheme();
  const qc = useQueryClient();
  const meQ = useMe();
  const me = meQ.data;
  const storage = useQuery({ queryKey: ['storage'], queryFn: () => api.get<any>('/storage') });
  const shares = useQuery({ queryKey: ['shares'], queryFn: () => api.get<any>('/shares') });
  if (!me)
    return (
      <Screen title="Settings" back>
        <View style={{ padding: 24, gap: 12 }}>
          {meQ.isError ? (
            <>
              <T muted>Couldn’t load your settings: {(meQ.error as Error)?.message}</T>
              <Button title="Try again" onPress={() => void meQ.refetch()} />
            </>
          ) : (
            <ActivityIndicator color={t.accent} />
          )}
        </View>
      </Screen>
    );
  const s = { ...me.user.settings, push: me.user.settings?.push ?? { agent_post: true, reminder: true, comment: true, share: true } };
  const timelines = me.timelines ?? [];
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
  const hasDrive = storage.data?.backends?.some((b: any) => b.type === 'gdrive' && !b.shared);

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

        {timelines.length > 1 && (
          <Card>
            <T bold size={16} style={{ marginBottom: 2 }}>Timelines</T>
            <T muted size={12.5}>Whose posts the timeline and Reels show.</T>
            {[
              { id: 'me', label: 'Only mine', hint: 'Your posts and your AI agents’ posts.' },
              ...timelines.filter((x) => !x.mine).map((x) => ({ id: x.id, label: `${x.name} only`, hint: `${x.name}’s timeline.` })),
              { id: 'all', label: timelines.length === 2 ? `Me + ${timelines.find((x) => !x.mine)!.name}` : 'Everyone combined', hint: 'Both timelines merged.' },
            ].map((o) => {
              const on = (s.timelineView ?? 'me') === o.id;
              return (
                <Pressable key={o.id} onPress={() => save({ timelineView: o.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? t.accent : t.line, alignItems: 'center', justifyContent: 'center' }}>
                    {on && <Check size={13} color={t.accent} strokeWidth={3} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <T>{o.label}</T>
                    <T muted size={12.5}>{o.hint}</T>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}

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
          {storage.data?.backends?.map((b: any) => (
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

        {!!shares.data?.incoming?.filter((x: any) => x.status === 'pending').length && (
          <Card>
            <T bold size={16} style={{ marginBottom: 6 }}>Shared with you</T>
            {shares.data.incoming?.filter((x: any) => x.status === 'pending').map((x: any) => (
              <Row key={x.ownerId} style={{ paddingVertical: 6 }}>
                <T style={{ flex: 1 }}>{x.user.name} wants to share their timeline</T>
                <Button title="Accept" kind="primary" onPress={async () => (await api.post(`/shares/${x.ownerId}/accept`), qc.invalidateQueries({ queryKey: ['shares'] }), qc.invalidateQueries({ queryKey: ['me'] }))} style={{ paddingVertical: 6 }} />
              </Row>
            ))}
          </Card>
        )}
        {Platform.OS === 'android' && <UpdateCard autoInstall={install === '1'} />}
        <T muted size={12} style={{ textAlign: 'center' }}>Agents, API keys, categories and sharing are managed in the web app.</T>
      </ScrollView>
    </Screen>
  );
}
