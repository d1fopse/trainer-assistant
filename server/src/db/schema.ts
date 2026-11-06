import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const languageEnum = pgEnum('language', ['uk', 'ru']);
export const clientStatusEnum = pgEnum('client_status', ['GUEST', 'ACTIVE', 'INACTIVE']);
export const priceKindEnum = pgEnum('price_kind', ['SINGLE', 'PASS']);

/**
 * Telegram-акаунт. Роль тут НЕ зберігається: тренер — за TRAINER_TELEGRAM_IDS,
 * клієнт — якщо прив'язана картка має статус ACTIVE, інакше гість.
 */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'bigint' }).notNull().unique(),
  language: languageEnum('language').notNull().default('uk'),
  firstName: text('first_name'),
  username: text('username'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Картка клієнта. Може існувати без Telegram (userId = null) і прив'язатися пізніше. */
export const clients = pgTable('clients', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .unique()
    .references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  phone: text('phone'),
  status: clientStatusEnum('status').notNull().default('GUEST'),
  goal: text('goal'),
  experience: text('experience'),
  health: text('health'),
  injuries: text('injuries'),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  trainerNotes: text('trainer_notes'),
  referredByClientId: integer('referred_by_client_id').references(
    (): AnyPgColumn => clients.id,
    { onDelete: 'set null' },
  ),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Позиція прайсу: разове заняття або абонемент на N занять. */
export const prices = pgTable('prices', {
  id: serial('id').primaryKey(),
  kind: priceKindEnum('kind').notNull(),
  titleUk: text('title_uk').notNull(),
  titleRu: text('title_ru'),
  descriptionUk: text('description_uk'),
  descriptionRu: text('description_ru'),
  priceUah: integer('price_uah').notNull(),
  sessionsCount: integer('sessions_count'),
  sortOrder: integer('sort_order').notNull().default(0),
  isVisible: boolean('is_visible').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const slotTypeEnum = pgEnum('slot_type', ['INDIVIDUAL', 'GROUP']);
export const slotStatusEnum = pgEnum('slot_status', ['OPEN', 'CANCELLED']);
export const bookingStatusEnum = pgEnum('booking_status', ['BOOKED', 'ATTENDED', 'NO_SHOW', 'CANCELLED']);

/** Постійна серія занять клієнта: дні тижня + час, на визначений строк. */
export const series = pgTable('series', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  /** ISO-дні тижня: 1 = понеділок … 7 = неділя. */
  weekdays: integer('weekdays').array().notNull(),
  /** Місцевий час Europe/Kyiv, «HH:MM». */
  startTime: text('start_time').notNull(),
  durationMin: integer('duration_min').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Слот календаря: індивідуальний (1 місце) або груповий (N місць). */
export const slots = pgTable(
  'slots',
  {
    id: serial('id').primaryKey(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMin: integer('duration_min').notNull(),
    type: slotTypeEnum('type').notNull(),
    capacity: integer('capacity').notNull(),
    status: slotStatusEnum('status').notNull().default('OPEN'),
    seriesId: integer('series_id').references(() => series.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('slots_starts_at_idx').on(t.startsAt)],
);

/** Запис клієнта на слот. */
export const bookings = pgTable(
  'bookings',
  {
    id: serial('id').primaryKey(),
    slotId: integer('slot_id')
      .notNull()
      .references(() => slots.id, { onDelete: 'cascade' }),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    status: bookingStatusEnum('status').notNull().default('BOOKED'),
    isTrial: boolean('is_trial').notNull().default(false),
    /** Чи списано заняття з абонемента (passId — з якого). */
    deducted: boolean('deducted').notNull().default(false),
    passId: integer('pass_id').references((): AnyPgColumn => passes.id, { onDelete: 'set null' }),
    markedAt: timestamp('marked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Один активний запис клієнта на слот.
    uniqueIndex('bookings_active_unique')
      .on(t.slotId, t.clientId)
      .where(sql`${t.status} <> 'CANCELLED'`),
    // Одне пробне заняття на клієнта.
    uniqueIndex('bookings_one_trial')
      .on(t.clientId)
      .where(sql`${t.isTrial} and ${t.status} <> 'CANCELLED'`),
    index('bookings_client_idx').on(t.clientId),
  ],
);

export const paymentMethodEnum = pgEnum('payment_method', ['CASH', 'CARD', 'TRANSFER']);
export const paymentPurposeEnum = pgEnum('payment_purpose', ['PASS', 'SINGLE', 'TRIAL', 'OTHER']);

/** Платіж, внесений тренером вручну. */
export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    amountUah: integer('amount_uah').notNull(),
    /** Місцева дата оплати (Київ). */
    paidAt: date('paid_at').notNull(),
    method: paymentMethodEnum('method').notNull(),
    purpose: paymentPurposeEnum('purpose').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payments_client_idx').on(t.clientId), index('payments_paid_at_idx').on(t.paidAt)],
);

/** Абонемент: N занять, залишок зменшується при відмітці «прийшов». */
export const passes = pgTable(
  'passes',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    totalSessions: integer('total_sessions').notNull(),
    remaining: integer('remaining').notNull(),
    purchasedAt: date('purchased_at').notNull(),
    expiresAt: date('expires_at'),
    paymentId: integer('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('passes_client_idx').on(t.clientId)],
);

/** Журнал змін (відмітки, абонементи, платежі) — щоб було видно, що й коли виправляли. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    entityId: integer('entity_id'),
    action: text('action').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_client_idx').on(t.clientId)],
);

export type User = typeof users.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Price = typeof prices.$inferSelect;
export type Slot = typeof slots.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Series = typeof series.$inferSelect;
export type Pass = typeof passes.$inferSelect;
export type Payment = typeof payments.$inferSelect;
