import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Cloud, Database, HardDrive, KeyRound, Lock, Plus, Trash2 } from 'lucide-react';
import { api, type Settings as S } from '../lib/api';
import { THEMES, applyTheme, bytes, timeAgo, useCategories, useMe } from '../lib/hooks';
import { Avatar, Modal, Section, Spinner, Toggle, toast, toastError } from '../components/ui';
import { KeyReveal } from './Agents';

function urlB64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enableWebPush(): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser does not support push notifications');
  if (!window.isSecureContext) throw new Error('Browser notifications need HTTPS (they work once the app runs on your domain)');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were blocked for this site');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { vapidPublicKey } = await api.get<{ vapidPublicKey: string }>('/push/config');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(vapidPublicKey) }));
  await api.post('/push/devices', { platform: 'webpush', token: JSON.stringify(sub), label: navigator.userAgent.slice(0, 100) });
  return 'Browser notifications enabled';
}

export default function Settings() {
  const qc = useQueryClient();
  const meQ = useMe();
  const me = meQ.data?.user;
  const loc = useLocation();
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const d = params.get('drive');
    if (d === 'connected') toast('Google Drive connected. New uploads go there.');
    if (d === 'error') toast(`Google Drive was not connected (${params.get('reason') ?? 'cancelled'})`, { kind: 'error' });
    if (d) {
      params.delete('drive');
      params.delete('reason');
      setParams(params, { replace: true });
      qc.invalidateQueries({ queryKey: ['storage'] });
    }
    const id = loc.pathname.endsWith('/storage') ? 'storage' : loc.hash.slice(1);
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 300);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) return <Spinner />;
  const saveSettings = async (patch: Partial<S>) => {
    qc.setQueryData(['me'], (old: any) => old && { ...old, user: { ...old.user, settings: { ...old.user.settings, ...patch, push: { ...old.user.settings.push, ...(patch.push ?? {}) } } } });
    await api.patch('/me', { settings: patch }).catch(toastError);
    qc.invalidateQueries({ queryKey: ['me'] });
  };

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-4 px-3 pt-4 sm:px-5">
      <h1 className="text-2xl font-extrabold">Settings</h1>
      <Profile me={me} />

      <Section title="Appearance">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`flex flex-col items-center gap-2 rounded-2xl border p-3 text-sm ${me.settings.theme === t.id ? 'border-accent bg-accent-soft' : 'border-line'}`}
              onClick={() => {
                applyTheme(t.id);
                saveSettings({ theme: t.id });
              }}
            >
              <span className="flex h-9 w-full overflow-hidden rounded-xl border border-line">
                <span className="flex-1" style={{ background: t.swatch[0] }} />
                <span className="w-1/3" style={{ background: t.swatch[1] }} />
              </span>
              {t.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Reading">
        <div className="mb-1 text-sm font-medium">Mark posts as read</div>
        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          {[
            ['auto', 'Automatically as I scroll', 'A post counts as read after it is on screen for a moment.'],
            ['manual', 'Manually', 'Use the “Mark as read” button on each post.'],
          ].map(([id, label, hint]) => (
            <button key={id} className={`rounded-2xl border p-3 text-left ${me.settings.markRead === id ? 'border-accent bg-accent-soft' : 'border-line'}`} onClick={() => saveSettings({ markRead: id as S['markRead'] })}>
              <div className="flex items-center gap-2 font-semibold">
                {me.settings.markRead === id && <Check size={16} className="text-accent-text" />}
                {label}
              </div>
              <div className="text-sm text-muted">{hint}</div>
            </button>
          ))}
        </div>
        <Toggle checked={me.settings.dataSaver} onChange={(v) => saveSettings({ dataSaver: v })} label="Data saver" hint="Reels preload only the next video instead of the next four." />
        <Toggle checked={!me.settings.reelsMuted} onChange={(v) => saveSettings({ reelsMuted: !v })} label="Reels start with sound" />
      </Section>

      <Section title="Notifications">
        <Toggle checked={me.settings.push.agent_post} onChange={(v) => saveSettings({ push: { ...me.settings.push, agent_post: v } })} label="New posts from my AI agents" />
        <Toggle checked={me.settings.push.reminder} onChange={(v) => saveSettings({ push: { ...me.settings.push, reminder: v } })} label="Reminders" />
        <Toggle checked={me.settings.push.comment} onChange={(v) => saveSettings({ push: { ...me.settings.push, comment: v } })} label="Comments on my posts" />
        <Toggle checked={me.settings.push.share} onChange={(v) => saveSettings({ push: { ...me.settings.push, share: v } })} label="Timeline shared with me" />
        <p className="mt-1 text-xs text-muted">These control phone/browser push. The bell always counts everything.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-sm" onClick={() => enableWebPush().then((m) => toast(m), toastError)}>
            Enable on this browser
          </button>
          <button
            className="btn btn-sm"
            onClick={async () => {
              const r = await api.post<{ devices: number }>('/push/test').catch(toastError);
              if (r) toast(r.devices ? `Test sent to ${r.devices} device(s)` : 'No devices registered yet. Install the Android app or enable browser push.');
              qc.invalidateQueries({ queryKey: ['unread'] });
            }}
          >
            Send test notification
          </button>
        </div>
      </Section>

      <Storage isAdmin={me.role === 'admin'} />
      <Sharing />
      <Categories />
      <PersonalKeys />
    </div>
  );
}

function Profile({ me }: { me: any }) {
  const qc = useQueryClient();
  const [name, setName] = useState(me.name);
  const [pw, setPw] = useState({ current: '', next: '' });
  const colors = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#84cc16', '#e11d48'];
  return (
    <Section title="Profile">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={name} color={me.color} size={52} />
        <div className="flex min-w-48 flex-1 gap-2">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            className="btn"
            disabled={name === me.name || !name.trim()}
            onClick={async () => {
              await api.patch('/me', { name }).catch(toastError);
              qc.invalidateQueries({ queryKey: ['me'] });
              toast('Saved');
            }}
          >
            Save
          </button>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {colors.map((c) => (
          <button key={c} className={`h-7 w-7 rounded-full ${me.color === c ? 'ring-2 ring-text ring-offset-2 ring-offset-card' : ''}`} style={{ background: c }}
            onClick={async () => (await api.patch('/me', { color: c }), qc.invalidateQueries({ queryKey: ['me'] }))} aria-label={`Colour ${c}`} />
        ))}
      </div>
      <div className="mt-4 text-sm text-muted">{me.email}</div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">Change password</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <input className="field max-w-56" type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <input className="field max-w-56" type="password" placeholder="New password (8+)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <button
            className="btn"
            disabled={pw.next.length < 8 || !pw.current}
            onClick={async () => {
              try {
                await api.post('/me/password', pw);
                toast('Password changed');
                setPw({ current: '', next: '' });
              } catch (e) {
                toastError(e);
              }
            }}
          >
            Change
          </button>
        </div>
      </details>
    </Section>
  );
}

function Storage({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['storage'], queryFn: () => api.get<any>('/storage') });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: 'Backblaze B2', endpoint: '', region: '', bucket: '', accessKeyId: '', secretAccessKey: '', shared: false });
  const [saving, setSaving] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['storage'] });
  const d = q.data;
  const connectDrive = async () => {
    try {
      const { url } = await api.get<{ url: string }>('/storage/google/start?client=web');
      location.href = url;
    } catch (e) {
      toastError(e);
    }
  };
  const hasDrive = d?.backends.some((b: any) => b.type === 'gdrive' && !b.shared);
  const icon = (t: string) => (t === 'gdrive' ? <Cloud size={20} /> : t === 's3' ? <Database size={20} /> : <HardDrive size={20} />);

  return (
    <div id="storage">
      <Section title="Storage" actions={<button className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> S3 / B2 / R2</button>}>
        {!d ? (
          <Spinner />
        ) : (
          <>
            {!hasDrive && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/40 bg-accent-soft p-4">
                <Cloud size={28} className="text-accent-text" />
                <div className="min-w-48 flex-1">
                  <div className="font-semibold">Store attachments in your Google Drive</div>
                  <div className="text-sm text-muted">One click: sign in with Google and Timeline creates a “Timeline” folder. It can only see the files it creates.</div>
                </div>
                <button className="btn btn-primary" onClick={connectDrive} disabled={!d.googleConfigured}>
                  Connect Google Drive
                </button>
                {!d.googleConfigured && (
                  <div className="w-full text-xs text-muted">
                    {isAdmin ? (
                      <>
                        Not set up on this server yet: add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to docker-compose.yml (see README → Google Drive). Redirect URI: <code className="break-all">{d.googleRedirectUri}</code>
                      </>
                    ) : (
                      'Ask your admin to enable Google Drive on the server.'
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col gap-2">
              {d.backends.map((b: any) => (
                <div key={b.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${b.isDefault ? 'border-accent' : 'border-line'}`}>
                  <span className="text-muted">{icon(b.type)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {b.name} {b.isDefault && <span className="ml-1 rounded-sm bg-accent px-2 py-0.5 text-[11px] text-white">Default</span>}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {b.detail} · {b.files} files · {bytes(b.bytes)}
                      {b.shared && ' · shared server storage'}
                    </div>
                  </div>
                  {!b.isDefault && (
                    <button className="btn btn-sm" onClick={async () => (await api.patch('/me', { settings: { defaultBackendId: b.id } }).catch(toastError), refresh())}>
                      Make default
                    </button>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={async () => { const r = await api.post<any>(`/storage/${b.id}/test`); toast(r.ok ? 'Connection OK' : `Problem: ${r.error}`, { kind: r.ok ? 'info' : 'error' }); }}>
                    Test
                  </button>
                  {b.canRemove && b.files === 0 && (
                    <button className="btn btn-sm btn-ghost text-danger" onClick={async () => (await api.del(`/storage/${b.id}`).catch(toastError), refresh())}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {hasDrive && (
              <button className="btn btn-sm btn-ghost mt-2" onClick={connectDrive}>
                Reconnect Google Drive
              </button>
            )}
            <p className="mt-3 text-xs text-muted">Thumbnails and the fast-start reels versions of videos are kept on the server so reels stay instant even when the original is on Google Drive.</p>
          </>
        )}
      </Section>
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add S3-compatible storage"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={saving || !form.bucket || !form.accessKeyId || !form.secretAccessKey}
              onClick={async () => {
                setSaving(true);
                try {
                  await api.post('/storage/s3', form);
                  toast('Storage added');
                  setAdding(false);
                  refresh();
                } catch (e) {
                  toastError(e);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Spinner size={16} /> : 'Test & add'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">
            Backblaze B2: create a bucket and an application key, then use the bucket's S3 endpoint, e.g. <code>https://s3.us-west-004.backblazeb2.com</code>. Cloudflare R2: <code>https://&lt;account-id&gt;.r2.cloudflarestorage.com</code>.
          </p>
          {(
            [
              ['name', 'Name'],
              ['endpoint', 'Endpoint URL'],
              ['region', 'Region (optional)'],
              ['bucket', 'Bucket'],
              ['accessKeyId', 'Key ID'],
              ['secretAccessKey', 'Secret key'],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              <span className="mb-1 block font-medium">{label}</span>
              <input className="field" type={k === 'secretAccessKey' ? 'password' : 'text'} value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          {isAdmin && <Toggle checked={form.shared} onChange={(v) => setForm({ ...form, shared: v })} label="Share with all users" />}
        </div>
      </Modal>
    </div>
  );
}

function Sharing() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['shares'], queryFn: () => api.get<any>('/shares') });
  const me = useMe().data;
  const [email, setEmail] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['shares'] });
    qc.invalidateQueries({ queryKey: ['me'] });
  };
  return (
    <div id="sharing">
      <Section title="Sharing &amp; combined timelines">
        <p className="mb-3 text-sm text-muted">
          Share your timeline with someone and they can switch to a combined view of both timelines. <Lock size={12} className="inline" /> Private categories are never shared.
        </p>
        <form
          className="mb-4 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post('/shares', { email });
              toast('Invitation sent');
              setEmail('');
              refresh();
            } catch (err) {
              toastError(err);
            }
          }}
        >
          <input className="field" type="email" placeholder="Their email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-primary" disabled={!email}>Share</button>
        </form>
        {q.data?.incoming.map((s: any) => (
          <div key={s.ownerId} className="flex items-center gap-3 border-t border-line py-2.5">
            <Avatar name={s.user.name} color={s.user.color} size={32} />
            <div className="flex-1 text-sm">
              <b>{s.user.name}</b> shares their timeline with you {s.status === 'pending' && <span className="text-muted">(pending)</span>}
            </div>
            {s.status === 'pending' && (
              <button className="btn btn-sm btn-primary" onClick={async () => (await api.post(`/shares/${s.ownerId}/accept`), refresh(), toast('Accepted: use the timeline switcher at the top'))}>
                Accept
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={async () => (await api.del(`/shares/${s.ownerId}/${me!.user.id}`), refresh())}>
              {s.status === 'pending' ? 'Decline' : 'Leave'}
            </button>
          </div>
        ))}
        {q.data?.outgoing.map((s: any) => (
          <div key={s.viewerId} className="flex items-center gap-3 border-t border-line py-2.5">
            <Avatar name={s.user.name} color={s.user.color} size={32} />
            <div className="flex-1 text-sm">
              You share with <b>{s.user.name}</b> {s.status === 'pending' && <span className="text-muted">(waiting for them)</span>}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={s.canComment} onChange={async (e) => (await api.patch(`/shares/${s.viewerId}`, { canComment: e.target.checked }), refresh())} />
              can comment
            </label>
            <button className="btn btn-sm btn-ghost text-danger" onClick={async () => (await api.del(`/shares/${me!.user.id}/${s.viewerId}`), refresh())}>
              Stop
            </button>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Categories() {
  const qc = useQueryClient();
  const cats = (useCategories().data ?? []).filter((c) => c.mine);
  const [name, setName] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['categories'] });
    qc.invalidateQueries({ queryKey: ['posts'] });
  };
  return (
    <Section title="Categories">
      <div className="flex flex-col">
        {cats.map((c) => (
          <div key={c.id} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
            <input type="color" value={c.color} className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent" onChange={async (e) => (await api.patch(`/categories/${c.id}`, { color: e.target.value }), refresh())} />
            <span className="flex-1 font-medium">{c.name}</span>
            <span className="text-xs text-muted">{c.postCount} posts</span>
            <label className="flex items-center gap-1.5 text-xs text-muted" title="Private categories are hidden from people you share with">
              <input type="checkbox" checked={c.isPrivate} onChange={async (e) => (await api.patch(`/categories/${c.id}`, { isPrivate: e.target.checked }), refresh())} />
              private
            </label>
            <button
              className="btn btn-sm btn-ghost text-danger"
              onClick={async () => {
                if (!confirm(`Delete “${c.name}”? Its ${c.postCount} posts become uncategorised.`)) return;
                await api.del(`/categories/${c.id}`);
                refresh();
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await api.post('/categories', { name }).then(refresh, toastError);
          setName('');
        }}
      >
        <input className="field" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!name.trim()}>Add</button>
      </form>
    </Section>
  );
}

function PersonalKeys() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['keys'], queryFn: () => api.get<any[]>('/keys') });
  const [revealed, setRevealed] = useState<string | null>(null);
  return (
    <Section
      title="Personal API keys"
      actions={
        <button
          className="btn btn-sm"
          onClick={async () => {
            const name = prompt('Name for this key (e.g. "laptop script")');
            if (!name) return;
            const k = await api.post<{ key: string }>('/keys', { name }).catch(toastError);
            if (k) setRevealed(k.key);
            qc.invalidateQueries({ queryKey: ['keys'] });
          }}
        >
          <KeyRound size={14} /> New key
        </button>
      }
    >
      <p className="mb-2 text-sm text-muted">These act as you. For AI agents, create an agent instead so their posts are labelled.</p>
      {q.data?.map((k) => (
        <div key={k.id} className="flex items-center gap-3 border-t border-line py-2 text-sm">
          <b>{k.name}</b>
          <code className="font-mono text-xs">{k.prefix}…</code>
          <span className="ml-auto text-xs text-muted">{k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : 'never used'}</span>
          <button className="btn btn-sm btn-ghost text-danger" onClick={async () => (await api.del(`/keys/${k.id}`), qc.invalidateQueries({ queryKey: ['keys'] }))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {revealed && <KeyReveal apiKey={revealed} onClose={() => setRevealed(null)} />}
    </Section>
  );
}
