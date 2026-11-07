import { z } from 'zod';

export const GOALS = ['weight_loss', 'muscle_gain', 'strength', 'health', 'other'] as const;
export const LEVELS = ['none', 'beginner', 'intermediate', 'advanced'] as const;

/**
 * Український номер у будь-якому записі (0671234567, 380671234567, +38 (067) 123-45-67…)
 * → «+380 67 123 45 67». null — якщо це не український мобільний/міський номер.
 */
export function normalizeUaPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let nat: string | null = null;
  if (digits.length === 12 && digits.startsWith('380')) nat = digits.slice(3);
  else if (digits.length === 11 && digits.startsWith('80')) nat = digits.slice(2);
  else if (digits.length === 10 && digits.startsWith('0')) nat = digits.slice(1);
  else if (digits.length === 9) nat = digits;
  if (!nat || nat.startsWith('0')) return null;
  return `+380 ${nat.slice(0, 2)} ${nat.slice(2, 5)} ${nat.slice(5, 7)} ${nat.slice(7, 9)}`;
}

/** Порожній рядок допускається (означає «немає телефону»); інакше — нормалізований номер. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((s, ctx) => {
    if (s === '') return '';
    const n = normalizeUaPhone(s);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid phone' });
      return z.NEVER;
    }
    return n;
  });

export const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Порожній рядок → null, щоб поле можна було очистити. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable();
