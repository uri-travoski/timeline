import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Copy, KeyRound, Plus, Power, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { timeAgo } from '../lib/hooks';
import { AgentBadge, Avatar, Empty, Modal, Section, Spinner, toast, toastError } from '../components/ui';

const SCOPES = [
  { id: 'read', label: 'Read', hint: 'search and read posts' },
  { id: 'write', label: 'Write', hint: 'post, edit, comment, reminders' },
  { id: 'delete', label: 'Delete', hint: 'move to recycle bin' },
  { id: 'purge', label: 'Delete forever', hint: 'empty the recycle bin' },
];

function copy(text: string) {
  navigator.clipboard?.writeText(text);
  toast('Copied');
}

export function KeyReveal({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const origin = location.origin;
  const mcp = JSON.stringify({ mcpServers: { timeline: { type: 'http', url: `${origin}/mcp`, headers: { Authorization: `Bearer ${apiKey}` } } } }, null, 2);
  const curl = `curl -X POST ${origin}/api/posts \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"body":"Hello from my agent","category":"Personal","tags":["test"]}'`;
  return (
    <Modal open onClose={onClose} title="API key created" wide footer={<button className="btn btn-primary" onClick={onClose}>I've saved it</button>}>
      <p className="mb-2 text-sm text-muted">Copy this key now. It won't be shown again.</p>
      <div className="mb-5 flex gap-2">
        <code className="field break-all font-mono text-sm">{apiKey}</code>
        <button className="btn" onClick={() => copy(apiKey)}>
          <Copy size={16} />
        </button>
      </div>
      <h3 className="mb-1 font-semibold">Connect an AI agent (MCP)</h3>
      <p className="mb-2 text-sm text-muted">For Claude and other MCP clients, add this server to the agent's MCP config:</p>
      <pre className="mb-2 overflow-x-auto rounded-2xl bg-raised p-3 text-xs">{mcp}</pre>
      <button className="btn btn-sm mb-5" onClick={() => copy(mcp)}>
        <Copy size={14} /> Copy MCP config
      </button>
      <h3 className="mb-1 font-semibold">Or use the REST API</h3>
      <pre className="mb-2 overflow-x-auto rounded-2xl bg-raised p-3 text-xs">{curl}</pre>
      <p className="text-sm text-muted">
        Full API reference:{' '}
        <a className="text-accent-text underline" href="/api/docs" target="_blank">
          {origin}/api/docs
        </a>
      </p>
    </Modal>
  );
}

export default function Agents() {
  const qc = useQueryClient();
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<any[]>('/agents') });
  const tasks = useQuery({ queryKey: ['agent-tasks'], queryFn: () => api.get<any[]>('/agent-tasks'), refetchInterval: 30_000 });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [scopes, setScopes] = useState(['read', 'write', 'delete']);
  const [revealed, setRevealed] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['agents'] });

  const create = async () => {
    try {
      const r = await api.post<{ apiKey: string }>('/agents', { name, description: desc, scopes });
      setCreating(false);
      setName('');
      setDesc('');
      setRevealed(r.apiKey);
      refresh();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-4 px-3 pt-4 sm:px-5">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">AI agents</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          <Plus size={16} /> New agent
        </button>
      </div>
      <p className="text-sm text-muted">
        Agents post to <b>your</b> timeline under their own name with an <AgentBadge small /> badge, and you get a notification. Give each agent its own key so you can see who did what and revoke one without breaking the others.
      </p>

      {agents.isLoading ? (
        <Spinner />
      ) : !agents.data?.length ? (
        <Empty icon={<Bot size={40} />} title="No agents yet">
          Create one for each job, e.g. “Insta-watcher: monitor @natgeo and post new videos”.
        </Empty>
      ) : (
        agents.data.map((a) => (
          <Section
            key={a.id}
            title={
              <span className="flex items-center gap-3">
                <Avatar name={a.name} color={a.color} kind="agent" size={34} />
                <span>
                  {a.name} {a.disabled && <span className="text-xs font-normal text-muted">(retired)</span>}
                  <span className="block text-xs font-normal text-muted">{a.postCount} posts · created {timeAgo(a.createdAt)}</span>
                </span>
              </span>
            }
            actions={
              !a.disabled && (
                <div className="flex gap-1">
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      const k = await api.post<{ key: string }>(`/agents/${a.id}/keys`, { name: `key ${a.keys.length + 1}`, scopes: a.keys[0]?.scopes ?? ['read', 'write', 'delete'] }).catch(toastError);
                      if (k) setRevealed(k.key);
                      refresh();
                    }}
                  >
                    <KeyRound size={14} /> New key
                  </button>
                  <button
                    className="btn btn-sm btn-ghost text-danger"
                    title="Retire agent"
                    onClick={async () => {
                      if (!confirm(`Retire ${a.name}? Its keys stop working; its posts stay.`)) return;
                      await api.del(`/agents/${a.id}`);
                      refresh();
                    }}
                  >
                    <Power size={15} />
                  </button>
                </div>
              )
            }
          >
            {a.description && <p className="mb-3 text-sm">{a.description}</p>}
            {a.keys.map((k: any) => (
              <div key={k.id} className="flex items-center gap-3 border-t border-line py-2 text-sm">
                <KeyRound size={15} className="text-muted" />
                <code className="font-mono text-xs">{k.prefix}…</code>
                <span className="text-xs text-muted">{k.scopes.join(', ')}</span>
                <span className="ml-auto text-xs text-muted">{k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : 'never used'}</span>
                <button
                  className="btn btn-sm btn-ghost text-danger"
                  title="Revoke key"
                  onClick={async () => {
                    if (!confirm('Revoke this key?')) return;
                    await api.del(`/keys/${k.id}`);
                    refresh();
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {(tasks.data ?? []).filter((t) => t.agentId === a.id).length > 0 && (
              <div className="mt-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Tasks</div>
                {(tasks.data ?? [])
                  .filter((t) => t.agentId === a.id)
                  .map((t) => (
                    <div key={t.id} className="mb-2 rounded-2xl bg-raised p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${t.status === 'active' ? 'bg-green-500' : t.status === 'error' ? 'bg-danger' : 'bg-muted'}`} />
                        <b className="flex-1">{t.name}</b>
                        {t.schedule && <span className="text-xs text-muted">{t.schedule}</span>}
                      </div>
                      {t.description && <div className="mt-1 text-muted">{t.description}</div>}
                      <div className="mt-1 text-xs text-muted">
                        Last run {t.lastRunAt ? timeAgo(t.lastRunAt) : 'never'}
                        {t.lastResult && ` · ${t.lastResult}`}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Section>
        ))
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New AI agent"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!name.trim()} onClick={create}>Create &amp; get key</button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <input className="field" placeholder="Name, e.g. Insta-watcher" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <textarea className="field" placeholder="What is it for? e.g. Monitor instagram.com/@natgeo and post new videos" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <div className="text-sm font-semibold">Permissions</div>
          {SCOPES.map((s) => (
            <label key={s.id} className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={scopes.includes(s.id)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s.id] : scopes.filter((x) => x !== s.id))} />
              <b>{s.label}</b>
              <span className="text-muted">{s.hint}</span>
            </label>
          ))}
        </div>
      </Modal>
      {revealed && <KeyReveal apiKey={revealed} onClose={() => setRevealed(null)} />}
    </div>
  );
}
