import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Loader2, X } from 'lucide-react';

export function Avatar({ name, color, kind, size = 38 }: { name: string; color: string; kind?: 'human' | 'agent'; size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
      aria-hidden
    >
      {kind === 'agent' ? <Bot size={size * 0.5} /> : name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
}

export function AgentBadge({ small }: { small?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm bg-accent-soft font-semibold text-accent-text ${small ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-[11px]'}`}>
      <Bot size={small ? 10 : 12} />
      {small ? 'AI' : 'AI agent'}
    </span>
  );
}

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-muted">
      {icon && <div className="mb-1 opacity-70">{icon}</div>}
      <div className="text-base font-semibold text-text">{title}</div>
      {children && <div className="max-w-sm text-sm">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`fade-up flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-panel shadow-2xl sm:rounded-3xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        {title !== undefined && (
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
            <div className="flex-1 text-lg font-bold">{title}</div>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3 safe-bottom">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Menu({ trigger, children, align = 'right' }: { trigger: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={`fade-up absolute z-30 mt-1 min-w-48 overflow-hidden rounded-2xl border border-line bg-panel py-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-raised ${danger ? 'text-danger' : ''}`} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

// ------------------------------- toasts -------------------------------

type Toast = { id: number; text: string; kind: 'info' | 'error'; action?: { label: string; run: () => void } };
let listeners: ((t: Toast[]) => void)[] = [];
let toasts: Toast[] = [];
let seq = 0;

export function toast(text: string, opts: { kind?: 'info' | 'error'; action?: Toast['action'] } = {}) {
  const t = { id: ++seq, text, kind: opts.kind ?? 'info', action: opts.action };
  toasts = [...toasts, t];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    listeners.forEach((l) => l(toasts));
  }, opts.action ? 6000 : 3500);
}

export const toastError = (e: unknown) => toast((e as Error)?.message ?? String(e), { kind: 'error' });

export function Toaster() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    listeners.push(setList);
    return () => {
      listeners = listeners.filter((l) => l !== setList);
    };
  }, []);
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
      {list.map((t) => (
        <div key={t.id} className={`fade-up pointer-events-auto flex items-center gap-4 rounded-2xl px-4 py-3 text-sm font-medium shadow-xl ${t.kind === 'error' ? 'bg-danger text-white' : 'bg-text text-bg'}`}>
          {t.text}
          {t.action && (
            <button className="font-bold underline" onClick={t.action.run}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-4 py-2">
      <div className="flex-1">
        <div className="font-medium">{label}</div>
        {hint && <div className="text-sm text-muted">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export function Section({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-card p-5">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="flex-1 text-base font-bold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
