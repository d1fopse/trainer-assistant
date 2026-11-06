# Trainer Assistant

Telegram Mini App — помічник тренера (офлайн-тренування): календар, клієнти, абонементи, платежі, бот-сповіщення.

**Статус:**

- Етап 1 — каркас: вхід через Telegram, ролі, анкета першого входу, мови UA/RU, тема Telegram.
- Етап 2 — клієнти й ціни: CRM-картки (зокрема без Telegram), підтвердження гостей, прив'язка Telegram до ручної картки, реферал вручну, прайс (разові заняття й абонементи), нижнє меню за ролями.

## Структура

```
server/           Node.js + Fastify + Drizzle ORM (PostgreSQL) — API, перевірка підпису Telegram, ролі
server/drizzle/   SQL-міграції; застосовуються автоматично при старті сервера
web/              React + Vite — інтерфейс Mini App
```

## Ролі та безпека

- Кожен запит до `/api/*` несе підписаний Telegram `initData`; сервер перевіряє підпис токеном бота.
- Роль обчислюється на кожному запиті й ніде не зберігається:
  - **тренер** — лише якщо Telegram ID є в `TRAINER_TELEGRAM_IDS`;
  - **клієнт** — якщо прив'язана картка має статус `ACTIVE` (тренер підтвердив);
  - **гість** — усі інші.
- Маршрути клієнтів і зміна цін доступні лише тренеру (перевірка на сервері).
- `DEV_AUTH_BYPASS` (вхід з браузера без Telegram) сервер відмовляється вмикати в production.

## Змінні оточення

Сервер (`server/.env.example`):

| Змінна | Опис |
| --- | --- |
| `DATABASE_URL` | Рядок підключення PostgreSQL |
| `BOT_TOKEN` | Токен бота від @BotFather (секрет) |
| `TRAINER_TELEGRAM_IDS` | Telegram ID тренера, кілька — через кому |
| `WEB_ORIGIN` | Адреса інтерфейсу (наприклад, `https://xxx.vercel.app`) для CORS |
| `NODE_ENV` | `production` на хостингу |

Інтерфейс (Vercel):

| Змінна | Опис |
| --- | --- |
| `VITE_API_URL` | Адреса сервера (наприклад, `https://xxx.up.railway.app`) |

## Локальний запуск

```bash
npm install
cp server/.env.example server/.env   # заповнити
npm run dev:server                    # таблиці створюються самі
npm run dev:web
```

Для перегляду в браузері без Telegram: на сервері `DEV_AUTH_BYPASS=true`, в `web/.env.local` — `VITE_DEV_TELEGRAM_ID=<ваш id>`.

## Зміна схеми бази

1. Змінити `server/src/db/schema.ts`.
2. `npm run db:generate -w server` — створить нову SQL-міграцію в `server/drizzle/`.
3. Закомітити міграцію; сервер застосує її при наступному запуску.

## Тести

```bash
npm test
```

Тести сервера працюють на справжньому PostgreSQL у пам'яті (PGlite) і проходять усі міграції.
