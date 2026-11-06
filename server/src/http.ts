import type { FastifyInstance } from 'fastify';
import type { ZodTypeAny, z } from 'zod';

/** Помилка, яку обробник повертає клієнту як { error: code, ...extra } з потрібним статусом. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function parse<S extends ZodTypeAny>(schema: S, value: unknown, code = 'invalid_body'): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, code, { details: r.error.flatten() });
  return r.data;
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, ...err.extra });
    }
    // Некоректний JSON у тілі тощо.
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode < 500) {
      return reply.code(statusCode).send({ error: 'bad_request' });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal' });
  });
}
