import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from './auth.ts';

export { z };

export function newApi() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const issues = (result.error as any).issues ?? [];
        const msg = issues.map((i: any) => `${i.path?.join('.') || 'input'}: ${i.message}`).join('; ');
        return c.json({ error: msg || 'Invalid request' }, 400);
      }
    },
  });
}

type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;

interface Def<Q, B, P> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string; // OpenAPI style: /posts/{id}
  tag: string;
  summary: string;
  description?: string;
  query?: Q;
  body?: B;
  params?: P;
}

const anyJson = { 'application/json': { schema: z.any() } };

/** Register a documented, validated JSON route. Handlers return a plain object (sent as JSON) or a Response. */
export function route<Q extends z.ZodType | undefined = undefined, B extends z.ZodType | undefined = undefined, P extends z.ZodType | undefined = undefined>(
  app: OpenAPIHono<AppEnv>,
  def: Def<Q, B, P>,
  handler: (c: Context<AppEnv>, input: { query: Infer<Q>; body: Infer<B>; params: Infer<P> }) => Promise<unknown> | unknown,
) {
  const r = createRoute({
    method: def.method,
    path: def.path,
    tags: [def.tag],
    summary: def.summary,
    description: def.description,
    security: [{ bearer: [] }],
    request: {
      ...(def.query ? { query: def.query as any } : {}),
      ...(def.params ? { params: def.params as any } : {}),
      ...(def.body ? { body: { content: { 'application/json': { schema: def.body as any } }, required: true } } : {}),
    },
    responses: { 200: { description: 'OK', content: anyJson } },
  });
  app.openapi(r, (async (c: any) => {
    const input = {
      query: def.query ? c.req.valid('query') : undefined,
      body: def.body ? c.req.valid('json') : undefined,
      params: def.params ? c.req.valid('param') : undefined,
    } as any;
    const out = await handler(c, input);
    return out instanceof Response ? out : c.json(out ?? { ok: true });
  }) as any);
}

/** Query-string helpers: accept `a,b` or repeated `?x=a&x=b`. */
export const csv = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)));

export const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === true || v === 'true' || v === '1'));

export const idParam = z.object({ id: z.string().uuid() });
