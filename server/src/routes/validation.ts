import { z } from 'zod';

export const GOALS = ['weight_loss', 'muscle_gain', 'strength', 'health', 'other'] as const;
export const LEVELS = ['none', 'beginner', 'intermediate', 'advanced'] as const;

/** Порожній рядок допускається (означає «немає телефону»). */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?[0-9 ()-]{7,20})?$/, 'invalid phone');

export const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Порожній рядок → null, щоб поле можна було очистити. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable();
