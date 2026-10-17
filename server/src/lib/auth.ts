import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { sql } from '../db.ts';
import { config } from '../config.ts';
import { randomToken, tokenHash } from './crypto.ts';

export type Scope = 'read' | 'write' | 'delete' | 'purge';
export const ALL_SCOPES: Scope[] = ['read', 'write', 'delete', 'purge'];

export interface AuthUser {
  id: string;
  kind: 'human' | 'agent';
  role: 'admin' | 'user';
  ownerId: string | null;
  name: string;
  email: string | null;
  /** The timeline this principal posts to: itself for humans, its owner for agents. */
  timelineId: string;
  scopes: Scope[];
  via: 'session' | 'apikey';
  settings: Record<string, any>;
}

export type AppEnv = { Variables: { user: AuthUser } };

export const SESSION_COOKIE = 'tl_session';
const SESSION_DAYS = 90;

export async function createSession(userId: string, userAgent: string): Promise<string> {
  const token = randomToken('tls_');
  await sql`INSERT INTO sessions (token_hash, user_id, user_agent, expires_at)
            VALUES (${tokenHash(token)}, ${userId}, ${userAgent.slice(0, 300)}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  return token;
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

function bearer(c: Context): string | undefined {
  const h = c.req.header('authorization');
  if (h?.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return c.req.header('x-api-key') ?? undefined;
}

export async function resolveToken(token: string | undefined, userAgent = ''): Promise<AuthUser | null> {
  if (!token) return null;
  const hash = tokenHash(token);
  let via: AuthUser['via'];
  let rows;
  if (token.startsWith('tlk_')) {
    via = 'apikey';
    rows = await sql`
      UPDATE api_keys k SET last_used_at = now()
      FROM users u WHERE k.key_hash = ${hash} AND k.revoked_at IS NULL AND u.id = k.user_id AND NOT u.disabled
      RETURNING u.*, k.scopes AS key_scopes`;
  } else {
    via = 'session';
    rows = await sql`
      UPDATE sessions s SET last_used_at = now()
      FROM users u WHERE s.token_hash = ${hash} AND s.expires_at > now() AND u.id = s.user_id AND NOT u.disabled
      RETURNING u.*`;
  }
  const u = rows[0];
  if (!u) return null;
  void userAgent;
  return {
    id: u.id,
    kind: u.kind,
    role: u.role,
    ownerId: u.owner_id,
    name: u.name,
    email: u.email,
    timelineId: u.kind === 'agent' ? u.owner_id : u.id,
    scopes: via === 'apikey' ? (u.key_scopes as Scope[]) : ALL_SCOPES,
    via,
    settings: u.settings ?? {},
  };
}

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c) ?? getCookie(c, SESSION_COOKIE);
  const user = await resolveToken(token, c.req.header('user-agent') ?? '');
  if (!user) throw new HTTPException(401, { message: 'Not signed in' });
  c.set('user', user);
  await next();
};

/** Map HTTP methods to API-key scopes; DELETE ... /purge style routes call requireScope('purge') explicitly. */
export const enforceScopes: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  const needed: Scope = m === 'GET' || m === 'HEAD' ? 'read' : m === 'DELETE' ? 'delete' : 'write';
  requireScope(c, needed);
  await next();
};

export function requireScope(c: Context<AppEnv>, scope: Scope) {
  const user = c.get('user');
  if (!user.scopes.includes(scope)) throw new HTTPException(403, { message: `API key is missing the "${scope}" scope` });
}

export function requireHuman(c: Context<AppEnv>) {
  const user = c.get('user');
  if (user.kind !== 'human') throw new HTTPException(403, { message: 'Only people can do this, not agents' });
  return user;
}

export function requireAdmin(c: Context<AppEnv>) {
  const user = requireHuman(c);
  if (user.role !== 'admin') throw new HTTPException(403, { message: 'Admin only' });
  return user;
}

/** Timelines this principal may read: its own plus accepted shares. */
export async function readableTimelines(user: AuthUser): Promise<{ own: string; shared: { ownerId: string; canComment: boolean }[] }> {
  const rows = await sql`SELECT owner_id, can_comment FROM timeline_shares WHERE viewer_id = ${user.timelineId} AND status = 'accepted'`;
  return { own: user.timelineId, shared: rows.map((r) => ({ ownerId: r.owner_id, canComment: r.can_comment })) };
}
