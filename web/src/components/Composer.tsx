import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Cloud, Film, HardDrive, ImagePlus, Paperclip, Type, X } from 'lucide-react';
import { api, uploadFile, type Attachment, type Post } from '../lib/api';
import { bytes, useCategories, useTags } from '../lib/hooks';
import { Modal, Spinner, toast, toastError } from './ui';

interface Ctx {
  open: (post?: Post) => void;
}
const ComposerCtx = createContext<Ctx>({ open: () => {} });
export const useComposer = () => useContext(ComposerCtx);

export function ComposerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; post?: Post; key: number }>({ open: false, key: 0 });
  const open = useCallback((post?: Post) => setState((s) => ({ open: true, post, key: s.key + 1 })), []);
  return (
    <ComposerCtx.Provider value={{ open }}>
      {children}
      {state.open && <Composer key={state.key} post={state.post} onClose={() => setState((s) => ({ ...s, open: false }))} />}
    </ComposerCtx.Provider>
  );
}

interface Upload {
  key: string;
  file: File;
  progress: number;
  att?: Attachment;
  error?: string;
  preview?: string;
}

interface StorageInfo {
  defaultBackendId: string | null;
  googleConfigured: boolean;
  backends: { id: string; type: string; name: string; detail: string; isDefault: boolean }[];
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function Composer({ post, onClose }: { post?: Post; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!post;
  const cats = useCategories().data?.filter((c) => c.mine) ?? [];
  const allTags = useTags().data ?? [];
  const storage = useQuery({ queryKey: ['storage'], queryFn: () => api.get<StorageInfo>('/storage') }).data;

  const [title, setTitle] = useState(post?.title ?? '');
  const [showTitle, setShowTitle] = useState(!!post?.title);
  const [body, setBody] = useState(post?.body ?? '');
  const [category, setCategory] = useState<string>(post?.category?.id ?? '');
  const [tags, setTags] = useState<string[]>(post?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [postedAt, setPostedAt] = useState(post ? toLocalInput(post.postedAt) : '');
  const [showDate, setShowDate] = useState(false);
  const [existing, setExisting] = useState<Attachment[]>(post?.attachments ?? []);
  const [removed, setRemoved] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [backendId, setBackendId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!category && cats.length && !editing) setCategory(cats.find((c) => c.name === 'Personal')?.id ?? cats[0].id);
  }, [cats.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files).map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`,
      file,
      progress: 0,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));
    setUploads((u) => [...u, ...list]);
    for (const up of list) {
      uploadFile(up.file, {
        backendId: backendId || undefined,
        onProgress: (p) => setUploads((u) => u.map((x) => (x.key === up.key ? { ...x, progress: p } : x))),
      })
        .then((att) => setUploads((u) => u.map((x) => (x.key === up.key ? { ...x, att, progress: 1 } : x))))
        .catch((e) => setUploads((u) => u.map((x) => (x.key === up.key ? { ...x, error: e.message } : x))));
    }
  };

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '');
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags([...tags, t]);
    setTagInput('');
  };

  const busy = uploads.some((u) => !u.att && !u.error);
  const ready = uploads.filter((u) => u.att).map((u) => u.att!.id);
  const canSave = !saving && !busy && (body.trim() || title.trim() || ready.length || existing.length);

  const save = async () => {
    setSaving(true);
    try {
      const pending = tagInput.trim() ? [...tags, tagInput.trim().replace(/^#/, '')] : tags;
      const common = {
        title: title.trim(),
        body,
        category: category || null,
        tags: pending,
        ...(postedAt ? { postedAt: new Date(postedAt).toISOString() } : {}),
      };
      if (editing) {
        await api.patch(`/posts/${post!.id}`, { ...common, addAttachmentIds: ready, removeAttachmentIds: removed });
        toast('Post updated');
      } else {
        await api.post('/posts', { ...common, attachmentIds: ready });
        toast('Posted');
      }
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['post'] });
      qc.invalidateQueries({ queryKey: ['reels'] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const suggestions = tagInput
    ? allTags.filter((t) => t.name.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(t.name)).slice(0, 6)
    : [];
  const effectiveBackend = storage?.backends.find((b) => b.id === (backendId || storage.defaultBackendId));

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={editing ? 'Edit post' : 'New post'}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary min-w-28" disabled={!canSave} onClick={save}>
            {saving ? <Spinner size={16} /> : busy ? 'Uploading…' : editing ? 'Save changes' : 'Post'}
          </button>
        </>
      }
    >
      <div
        className={`flex flex-col gap-3 rounded-2xl ${drag ? 'outline-2 outline-dashed outline-accent' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
      >
        {showTitle && <input className="field text-lg font-semibold" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />}
        <textarea
          className="field min-h-36 resize-y"
          placeholder="What's happening? (drop files here)"
          value={body}
          autoFocus
          onChange={(e) => setBody(e.target.value)}
          onPaste={(e) => e.clipboardData.files.length && addFiles(e.clipboardData.files)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave && save()}
        />

        {(existing.length > 0 || uploads.length > 0) && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {existing.map((a) => (
              <Tile key={a.id} name={a.filename} sub={bytes(a.size)} img={a.thumbUrl ?? a.posterUrl ?? (a.kind === 'image' ? a.url : undefined)} video={a.kind === 'video'}
                onRemove={() => (setExisting(existing.filter((x) => x.id !== a.id)), setRemoved([...removed, a.id]))} />
            ))}
            {uploads.map((u) => (
              <Tile key={u.key} name={u.file.name} sub={u.error ? u.error : u.att ? bytes(u.file.size) : `${Math.round(u.progress * 100)}%`} img={u.preview}
                video={u.file.type.startsWith('video/')} progress={u.att || u.error ? undefined : u.progress} error={!!u.error}
                onRemove={() => setUploads(uploads.filter((x) => x.key !== u.key))} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select className="field w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">No category</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.isPrivate ? '🔒 ' : ''}
                {c.name}
              </option>
            ))}
          </select>
          <div className="relative min-w-48 flex-1">
            <div className="field flex flex-wrap items-center gap-1.5 py-1.5">
              {tags.map((t) => (
                <span key={t} className="chip py-0.5" data-on="true">
                  #{t}
                  <button onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                className="min-w-20 flex-1 bg-transparent py-1 outline-none"
                placeholder={tags.length ? '' : 'Add tags…'}
                value={tagInput}
                onChange={(e) => (e.target.value.endsWith(',') || e.target.value.endsWith(' ') ? addTag(e.target.value.slice(0, -1)) : setTagInput(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.preventDefault(), addTag(tagInput));
                  if (e.key === 'Backspace' && !tagInput && tags.length) setTags(tags.slice(0, -1));
                }}
              />
            </div>
            {suggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-panel shadow-lg">
                {suggestions.map((s) => (
                  <button key={s.name} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-raised" onClick={() => addTag(s.name)}>
                    #{s.name}
                    <span className="text-muted">{s.postCount}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {showDate && (
          <label className="flex items-center gap-3 text-sm">
            <CalendarClock size={16} className="text-muted" />
            Post date
            <input type="datetime-local" className="field w-auto" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} />
          </label>
        )}

        <div className="flex flex-wrap items-center gap-1 border-t border-line pt-3">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && (addFiles(e.target.files), (e.target.value = ''))} />
          <button className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}>
            <ImagePlus size={17} /> Photo / video
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}>
            <Paperclip size={17} /> File
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowTitle((s) => !s)}>
            <Type size={17} /> Title
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowDate((s) => !s)}>
            <CalendarClock size={17} /> Date
          </button>
          <div className="flex-1" />
          {storage && storage.backends.length > 1 ? (
            <label className="flex items-center gap-2 text-xs text-muted">
              {effectiveBackend?.type === 'gdrive' ? <Cloud size={14} /> : <HardDrive size={14} />}
              <select className="bg-transparent text-xs outline-none" value={backendId} onChange={(e) => setBackendId(e.target.value)} disabled={uploads.length > 0}>
                <option value="">Default ({storage.backends.find((b) => b.id === storage.defaultBackendId)?.name ?? '—'})</option>
                {storage.backends.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            effectiveBackend && (
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <HardDrive size={14} /> {effectiveBackend.name}
              </span>
            )
          )}
        </div>
      </div>
    </Modal>
  );
}

function Tile({ name, sub, img, video, progress, error, onRemove }: { name: string; sub: string; img?: string; video?: boolean; progress?: number; error?: boolean; onRemove: () => void }) {
  return (
    <div className={`relative aspect-square overflow-hidden rounded-xl border bg-raised ${error ? 'border-danger' : 'border-line'}`}>
      {img ? <img src={img} className="h-full w-full object-cover" alt="" /> : <div className="grid h-full place-items-center text-muted">{video ? <Film /> : <Paperclip />}</div>}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 p-1.5 text-[11px] text-white">
        <div className="truncate">{name}</div>
        <div className={`truncate ${error ? 'text-red-300' : 'opacity-80'}`}>{sub}</div>
      </div>
      {progress !== undefined && (
        <div className="absolute inset-x-0 top-0 h-1 bg-black/30">
          <div className="h-full bg-accent transition-all" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      <button className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white" onClick={onRemove} aria-label="Remove">
        <X size={13} />
      </button>
    </div>
  );
}
