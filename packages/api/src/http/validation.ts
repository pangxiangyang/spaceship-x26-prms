import { z, type ZodType, type ZodTypeDef } from 'zod';

/** A request whose shape is wrong (as opposed to a business-rule violation). */
export class RequestValidationError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '));
    this.name = 'RequestValidationError';
  }
}

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RequestValidationError(
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

export const isoDateTime = z
  .string()
  .datetime({ offset: true, message: 'Must be an ISO-8601 date-time, e.g. 2026-03-01T09:00:00Z' })
  .transform((value) => new Date(value));

export const idParam = z.object({ id: z.string().min(1).max(64) });
