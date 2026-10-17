import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Logo } from '../components/Layout';
import { Spinner } from '../components/ui';

export default function Login() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4">
      <form
        className="w-full max-w-sm rounded-3xl border border-line bg-panel p-7 shadow-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api.post('/auth/login', { email, password });
            await qc.invalidateQueries();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="mb-6 flex items-center gap-3 text-2xl font-extrabold">
          <Logo size={38} /> Timeline
        </div>
        <label className="mb-1 block text-sm font-medium">Email</label>
        <input className="field mb-4" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        <label className="mb-1 block text-sm font-medium">Password</label>
        <input className="field mb-4" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? <Spinner size={16} /> : 'Sign in'}
        </button>
        <p className="mt-4 text-center text-xs text-muted">Accounts are created by your Timeline admin.</p>
      </form>
    </div>
  );
}
