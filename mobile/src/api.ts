import * as SecureStore from 'expo-secure-store';
import { createUploadTask, FileSystemUploadType } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

// Same shapes as the web app (see web/src/lib/api.ts).
export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'archive' | 'other';
export interface Attachment {
  id: string; postId: string | null; filename: string; mime: string; kind: FileKind; size: number;
  width: number | null; height: number | null; duration: number | null;
  status: 'pending' | 'stored' | 'failed'; mediaStatus: 'none' | 'processing' | 'ready' | 'failed';
  url: string; downloadUrl: string; thumbUrl: string | null; posterUrl: string | null; hlsUrl: string | null;
}
export interface Author { id: string; name: string; kind: 'human' | 'agent'; color: string; ownerName?: string | null }
export interface Category { id: string; name: string; color: string; icon: string; isPrivate: boolean; postCount: number; mine: boolean; timelineId: string }
export interface Post {
  id: string; kind: 'post' | 'reminder'; timeline: { id: string; name: string; mine: boolean };
  title: string; body: string; category: Pick<Category, 'id' | 'name' | 'color' | 'isPrivate'> | null; tags: string[];
  author: Author | null; source: string; sourceName: string; sourceUrl: string | null; sourceMeta: Record<string, any>;
  postedAt: string; editedAt: string | null; deletedAt: string | null; isRead: boolean; commentCount: number;
  attachments: Attachment[]; refPost: { id: string; title: string; snippet: string } | null;
  permissions: { canEdit: boolean; canDelete: boolean; canComment: boolean };
}
export interface Comment { id: string; postId: string; body: string; author: Author; createdAt: string; editedAt: string | null }
export interface Settings {
  theme: string; markRead: 'auto' | 'manual'; reelsMuted: boolean; dataSaver: boolean;
  push: { agent_post: boolean; reminder: boolean; comment: boolean; share: boolean };
}
export interface Me {
  user: { id: string; name: string; email: string; color: string; role: 'admin' | 'user'; settings: Settings };
  timelines: { id: string; name: string; color: string; mine: boolean }[];
  unread: number;
}
export interface Notification {
  id: string; type: 'agent_post' | 'reminder' | 'comment' | 'share'; title: string; body: string; postId: string | null;
  readAt: string | null; createdAt: string; actor: { name: string; kind: 'human' | 'agent'; color: string } | null;
}
export interface Reminder { id: string; title: string; body: string; dueAt: string; repeat: string | null; status: string; createdBy: string | null }
export interface Page<T> { items: T[]; nextCursor: string | null }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let server = '';
let token = '';
let onUnauthorized: () => void = () => {};

export const session = {
  async load() {
    server = (await SecureStore.getItemAsync('server')) ?? '';
    token = (await SecureStore.getItemAsync('token')) ?? '';
    return { server, token };
  },
  async save(s: string, t: string) {
    server = s.replace(/\/+$/, '');
    token = t;
    await SecureStore.setItemAsync('server', server);
    await SecureStore.setItemAsync('token', token);
  },
  async clear() {
    token = '';
    await SecureStore.deleteItemAsync('token');
  },
  /** Forget the token and return to the login screen. */
  async signOut() {
    await this.clear();
    onUnauthorized();
  },
  get server() {
    return server;
  },
  get token() {
    return token;
  },
  onUnauthorized(fn: () => void) {
    onUnauthorized = fn;
  },
};

/** Media URLs from the API are relative and signed; make them absolute for this server. */
export const abs = (u?: string | null) => (u ? (u.startsWith('http') ? u : server + u) : undefined);

async function request<T>(method: string, path: string, body?: unknown, base = server): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        'x-client': Platform.OS,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Can't reach the server at ${base}`);
  }
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T,>(p: string) => request<T>('GET', p),
  post: <T,>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T,>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T,>(p: string) => request<T>('DELETE', p),
  login: (base: string, email: string, password: string) => request<{ token: string }>('POST', '/auth/login', { email, password }, base.replace(/\/+$/, '')),
};

/** Streams the file from disk as the request body: fine for multi-GB videos. */
export async function uploadFile(uri: string, filename: string, mime: string, onProgress?: (f: number) => void): Promise<Attachment> {
  const q = new URLSearchParams({ filename, mime });
  const task = createUploadTask(
    `${server}/api/uploads?${q}`,
    uri,
    { httpMethod: 'PUT', uploadType: FileSystemUploadType.BINARY_CONTENT, headers: { authorization: `Bearer ${token}`, 'content-type': mime, 'x-client': Platform.OS } },
    (p) => onProgress?.(p.totalBytesExpectedToSend ? p.totalBytesSent / p.totalBytesExpectedToSend : 0),
  );
  const res = await task.uploadAsync();
  if (!res) throw new ApiError(0, 'Upload cancelled');
  const data = JSON.parse(res.body || '{}');
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, data.error ?? 'Upload failed');
  return data;
}

export interface Filters {
  timelines?: string[]; categories?: string[]; tags?: string[]; tagMode?: 'any' | 'all';
  from?: string; to?: string; q?: string; fileTypes?: string[]; authors?: string[]; unread?: boolean;
}

export function filtersToQuery(f: Filters, extra: Record<string, string | undefined> = {}) {
  const parts: string[] = [];
  const add = (k: string, v?: string) => v && parts.push(`${k}=${encodeURIComponent(v)}`);
  for (const k of ['timelines', 'categories', 'tags', 'fileTypes', 'authors'] as const) add(k, f[k]?.join(','));
  if (f.tagMode === 'all') add('tagMode', 'all');
  add('from', f.from);
  add('to', f.to);
  add('q', f.q);
  if (f.unread) add('unread', 'true');
  for (const [k, v] of Object.entries(extra)) add(k, v);
  return parts.join('&');
}
