import { HTTPException } from 'hono/http-exception';

export const notFound = (what = 'Not found') => new HTTPException(404, { message: what });
export const badRequest = (msg: string) => new HTTPException(400, { message: msg });
export const forbidden = (msg = 'Forbidden') => new HTTPException(403, { message: msg });
export const conflict = (msg: string) => new HTTPException(409, { message: msg });
