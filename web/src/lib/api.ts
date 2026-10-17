// Thin typed client for the Timeline API. The web app authenticates with the session cookie.

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'archive' | 'other';

export interface Attachment {
  id: string;
  postId: string | null;
  filename: string;
  mime: string;
  kind: FileKind;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: 'pending' | 'stored' | 'failed';
  mediaStatus: 'none' | 'processing' | 'ready' | 'failed';
  error: string | null;
  url: string;
  downloadUrl: string;
  thumbUrl: string | null;
  posterUrl: string | null;
  hlsUrl: string | null;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  isPrivate: boolean;
  sort: number;
  postCount: number;
  timelineId: string;
  timelineName: string;
  mine: boolean;
}

export interface Author {
  id: string;
  name: string;
  kind: 'human' | 'agent';
  color: string;
  ownerName?: string | null;
}

export interface Post {
  id: string;
  kind: 'post' | 'reminder';
  timeline: { id: string; name: string; mine: boolean };
  title: string;
  body: string;
  category: Pick<Category, 'id' | 'name' | 'color' | 'icon' | 'isPrivate'> | null;
  tags: string[];
  author: Author | null;
  source: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceMeta: Record<string, any>;
  postedAt: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  isRead: boolean;
  commentCount: number;
  attachments: Attachment[];
  refPost: { id: string; title: string; snippet: string } | null;
  permissions: { canEdit: boolean; canDelete: boolean; canComment: boolean };
}

export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  source: string;
  author: Author;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface Settings {
  theme: string;
  markRead: 'auto' | 'manual';
  push: { agent_post: boolean; reminder: boolean; comment: boolean; share: boolean };
  reelsMuted: boolean;
  dataSaver: boolean;
  defaultBackendId?: string | null;
}

export interface User {
  id: string;
  kind: 'human' | 'agent';
  role: 'admin' | 'user';
  name: string;
  email: string | null;
  color: string;
  description: string;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  settings: Settings;
}

export interface Me {
  user: User;
  timelines: { id: string; name: string; color: string; mine: boolean; canComment: boolean }[];
  unread: number;
}

export interface Notification {
  id: string;
  type: 'agent_post' | 'reminder' | 'comment' | 'share';
  title: string;
  body: string;
  postId: string | null;
  readAt: string | null;
  createdAt: string;
  actor: { id: string; name: string; kind: 'human' | 'agent'; color: string } | null;
}

export interface Reminder {
  id: string;
  title: string;
  body: string;
  dueAt: string;
  repeat: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  postId: string | null;
  status: 'scheduled' | 'done' | 'cancelled';
  lastFiredAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), 'x-client': 'web' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new Event('tl:unauthorized'));
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? res.statusText);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Upload one file as a raw body (streams on the server; works for multi-GB videos), with progress. */
export function uploadFile(file: File, opts: { backendId?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const q = new URLSearchParams({ filename: file.name, mime: file.type || 'application/octet-stream' });
    if (opts.backendId) q.set('backendId', opts.backendId);
    xhr.open('PUT', `/api/uploads?${q}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error while uploading'));
    opts.signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

export interface Filters {
  timelines?: string[];
  categories?: string[];
  tags?: string[];
  tagMode?: 'any' | 'all';
  from?: string;
  to?: string;
  q?: string;
  fileTypes?: string[];
  authors?: string[];
  unread?: boolean;
}

export function filtersToQuery(f: Filters, extra: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams();
  const list = (k: string, v?: string[]) => v?.length && q.set(k, v.join(','));
  list('timelines', f.timelines);
  list('categories', f.categories);
  list('tags', f.tags);
  list('fileTypes', f.fileTypes);
  list('authors', f.authors);
  if (f.tagMode === 'all') q.set('tagMode', 'all');
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  if (f.q) q.set('q', f.q);
  if (f.unread) q.set('unread', 'true');
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return q.toString();
}
