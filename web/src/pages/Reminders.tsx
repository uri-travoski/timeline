import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Plus, Repeat, Trash2, X } from 'lucide-react';
import { api, type Reminder } from '../lib/api';
import { fullDate, timeAgo } from '../lib/hooks';
import { Empty, Modal, Spinner, toast, toastError } from '../components/ui';

function localInput(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function Reminders() {
  const qc = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  const q = useQuery({ queryKey: ['reminders', showDone], queryFn: () => api.get<Reminder[]>(`/reminders${showDone ? '?includeDone=true' : ''}`) });
  const [form, setForm] = useState<null | { id?: string; title: string; body: string; due: string; repeat: string }>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['reminders'] });

  const save = async () => {
    if (!form) return;
    const body = { title: form.title, body: form.body, dueAt: new Date(form.due).toISOString(), repeat: form.repeat || null };
    try {
      if (form.id) await api.patch(`/reminders/${form.id}`, { ...body, status: 'scheduled' });
      else await api.post('/reminders', body);
      toast('Reminder saved');
      setForm(null);
      refresh();
    } catch (e) {
      toastError(e);
    }
  };

  const snooze = async (r: Reminder, minutes: number) => {
    await api.patch(`/reminders/${r.id}`, { dueAt: new Date(Date.now() + minutes * 60000).toISOString(), status: 'scheduled' }).catch(toastError);
    refresh();
  };

  return (
    <div className="mx-auto max-w-[720px] px-3 pt-4 sm:px-5">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">Reminders</h1>
        <button className="chip" data-on={showDone} onClick={() => setShowDone((s) => !s)}>
          Show past
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => setForm({ title: '', body: '', due: localInput(new Date(Date.now() + 3600_000)), repeat: '' })}>
          <Plus size={16} /> New
        </button>
      </div>
      <p className="mb-4 text-sm text-muted">
        You get a notification with sound when a reminder is due, plus a small card on your timeline until you mark it read. Your AI agents can set reminders for you too.
      </p>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Empty icon={<AlarmClock size={40} />} title="No reminders">Create one, or ask an agent: “remind me Friday 9am to renew the domain”.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {q.data.map((r) => (
            <div key={r.id} className={`flex items-center gap-3 rounded-2xl border border-line bg-card p-3.5 ${r.status !== 'scheduled' ? 'opacity-60' : ''}`}>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-500">
                <AlarmClock size={19} />
              </div>
              <button className="min-w-0 flex-1 text-left" onClick={() => setForm({ id: r.id, title: r.title, body: r.body, due: localInput(new Date(r.dueAt)), repeat: r.repeat ?? '' })}>
                <div className="font-semibold">{r.title}</div>
                <div className="flex flex-wrap gap-x-2 text-xs text-muted">
                  <span title={fullDate(r.dueAt)}>{r.status === 'scheduled' ? `${fullDate(r.dueAt)} (${timeAgo(r.dueAt)})` : r.status === 'done' ? `Done · ${fullDate(r.lastFiredAt ?? r.dueAt)}` : 'Cancelled'}</span>
                  {r.repeat && (
                    <span className="inline-flex items-center gap-1">
                      <Repeat size={11} /> {r.repeat}
                    </span>
                  )}
                  {r.createdBy && <span>set by {r.createdBy}</span>}
                </div>
              </button>
              {r.status === 'scheduled' && (
                <>
                  <button className="btn btn-sm hidden sm:inline-flex" onClick={() => snooze(r, 60)}>+1h</button>
                  <button className="btn btn-sm btn-ghost" title="Cancel" onClick={async () => (await api.patch(`/reminders/${r.id}`, { status: 'cancelled' }), refresh())}>
                    <X size={16} />
                  </button>
                </>
              )}
              <button className="btn btn-sm btn-ghost text-danger" title="Delete" onClick={async () => (await api.del(`/reminders/${r.id}`), refresh())}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit reminder' : 'New reminder'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={!form?.title.trim()} onClick={save}>Save</button>
          </>
        }
      >
        {form && (
          <div className="flex flex-col gap-3">
            <input className="field" placeholder="Remind me to…" value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <textarea className="field" placeholder="Details (optional)" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            <div className="flex flex-wrap gap-3">
              <input type="datetime-local" className="field w-auto" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
              <select className="field w-auto" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })}>
                <option value="">Doesn't repeat</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
                <option value="yearly">Every year</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ['In 1 hour', 60],
                ['Tonight 8pm', -20],
                ['Tomorrow 9am', -9],
                ['In a week', 7 * 24 * 60],
              ].map(([label, m]) => (
                <button
                  key={label}
                  className="chip"
                  onClick={() => {
                    const d = new Date();
                    if (m === -20) d.setHours(20, 0, 0, 0);
                    else if (m === -9) (d.setDate(d.getDate() + 1), d.setHours(9, 0, 0, 0));
                    else d.setTime(Date.now() + (m as number) * 60000);
                    setForm({ ...form, due: localInput(d) });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
