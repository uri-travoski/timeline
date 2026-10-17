import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { bytes, timeAgo, useMe } from '../lib/hooks';
import { Avatar, Modal, Section, Spinner, toast, toastError } from '../components/ui';

export default function Admin() {
  const qc = useQueryClient();
  const me = useMe().data;
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<any[]>('/admin/users') });
  const status = useQuery({ queryKey: ['admin-status'], queryFn: () => api.get<any>('/admin/status'), refetchInterval: 10_000 });
  const [form, setForm] = useState<null | { email: string; name: string; password: string; role: string }>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-users'] });
  if (me && me.user.role !== 'admin') return <div className="p-6 text-muted">Admins only.</div>;
  const s = status.data;

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-3 pt-4 sm:px-5">
      <h1 className="text-2xl font-extrabold">Admin</h1>
      <Section title="People" actions={<button className="btn btn-sm btn-primary" onClick={() => setForm({ email: '', name: '', password: '', role: 'user' })}><Plus size={14} /> Add person</button>}>
        {!users.data ? (
          <Spinner />
        ) : (
          users.data.map((u) => (
            <div key={u.id} className={`flex flex-wrap items-center gap-3 border-t border-line py-2.5 first:border-0 ${u.disabled ? 'opacity-50' : ''}`}>
              <Avatar name={u.name} color={u.color} src={u.avatarUrl} size={34} />
              <div className="min-w-40 flex-1">
                <div className="font-semibold">
                  {u.name} {u.role === 'admin' && <span className="ml-1 rounded-sm bg-accent-soft px-2 py-0.5 text-[11px] text-accent-text">admin</span>}
                </div>
                <div className="text-xs text-muted">
                  {u.email} · {u.postCount} posts · {u.agentCount} agents · {u.lastSeenAt ? `seen ${timeAgo(u.lastSeenAt)}` : 'never signed in'}
                </div>
              </div>
              {u.id !== me?.user.id && (
                <>
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      const pw = prompt(`New password for ${u.name} (8+ characters)`);
                      if (pw) await api.patch(`/admin/users/${u.id}`, { password: pw }).then(() => toast('Password reset'), toastError);
                    }}
                  >
                    Reset password
                  </button>
                  <button className="btn btn-sm" onClick={async () => (await api.patch(`/admin/users/${u.id}`, { disabled: !u.disabled }).catch(toastError), refresh())}>
                    {u.disabled ? 'Enable' : 'Disable'}
                  </button>
                  <button
                    className="btn btn-sm btn-ghost text-danger"
                    onClick={async () => {
                      const typed = prompt(`This deletes ${u.name} and ALL their posts and files forever. Type their email to confirm:`);
                      if (typed !== u.email) return;
                      await api.del(`/admin/users/${u.id}?confirm=${encodeURIComponent(u.email)}`).then(() => toast('Deleted'), toastError);
                      refresh();
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </Section>

      <Section title="Server" actions={s?.failed?.length ? <button className="btn btn-sm" onClick={async () => (await api.post('/admin/jobs/retry', {}), qc.invalidateQueries({ queryKey: ['admin-status'] }))}><RotateCcw size={14} /> Retry failed jobs</button> : null}>
        {!s ? (
          <Spinner />
        ) : (
          <div className="grid gap-4 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Posts', s.totals.posts.toLocaleString()],
                ['Files', s.totals.files.toLocaleString()],
                ['File storage', bytes(s.totals.bytes)],
                ['Database', bytes(s.totals.db_bytes)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-2xl bg-raised p-3">
                  <div className="text-xs text-muted">{l}</div>
                  <div className="text-lg font-bold">{v}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted">
              <span>Phone push (Firebase): <b className={s.push.fcm ? 'text-green-500' : 'text-danger'}>{s.push.fcm ? 'configured' : 'not configured'}</b></span>
              <span>Google Drive: <b className={s.google ? 'text-green-500' : 'text-danger'}>{s.google ? 'configured' : 'not configured'}</b></span>
              <span>Public URL: <code>{s.publicUrl}</code></span>
            </div>
            <div>
              <div className="mb-1 font-semibold">Background jobs</div>
              {s.jobs.length === 0 ? <div className="text-muted">Queue is empty.</div> : s.jobs.map((j: any) => <div key={j.type + j.status}>{j.type}: {j.n} {j.status}</div>)}
              {s.failed.map((f: any) => (
                <div key={f.id} className="mt-2 rounded-xl bg-danger/10 p-2 text-xs text-danger">
                  #{f.id} {f.type}: {String(f.last_error).split('\n')[0].slice(0, 200)}
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Add person"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={!form?.email || !form?.name || (form?.password.length ?? 0) < 8}
              onClick={async () => {
                try {
                  await api.post('/admin/users', form);
                  toast('Account created. Share the email and password with them.');
                  setForm(null);
                  refresh();
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              Create
            </button>
          </>
        }
      >
        {form && (
          <div className="flex flex-col gap-3">
            <input className="field" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="field" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="field" type="text" placeholder="Temporary password (8+)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="user">Regular user</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        )}
      </Modal>
    </div>
  );
}
