/** Чи є помилка порушенням унікального індексу (за потреби — конкретного). */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const err = cur as { code?: string; constraint?: string; message?: string; cause?: unknown };
    if (err.code === '23505') {
      if (!constraint) return true;
      return err.constraint === constraint || Boolean(err.message?.includes(constraint));
    }
    cur = err.cause;
  }
  return false;
}
