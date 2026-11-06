import {
  bigint,
  boolean,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
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

export type User = typeof users.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Price = typeof prices.$inferSelect;
