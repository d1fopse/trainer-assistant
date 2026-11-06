# Trainer Assistant

Telegram Mini App — помічник тренера (офлайн-тренування): календар, клієнти, абонементи, платежі, бот-сповіщення.

**Статус:** етап 1 — каркас (вхід через Telegram, ролі, анкета першого входу, мови UA/RU, тема Telegram).

## Структура

```
server/   Node.js + Fastify + Prisma (PostgreSQL) — API, перевірка підпису Telegram, ролі
web/      React + Vite — інтерфейс Mini App
```

## Безпека ролей

- Кожен запит до `/api/*` несе підписаний Telegram `initData`; сервер перевіряє підпис токеном бота.
- Роль **тренера** визначається лише змінною `TRAINER_TELEGRAM_IDS` на сервері.
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
npm run db:migrate -w server
npm run dev:server
npm run dev:web
```

Для перегляду в браузері без Telegram: на сервері `DEV_AUTH_BYPASS=true`, в `web/.env.local` — `VITE_DEV_TELEGRAM_ID=<ваш id>`.

## Тести

```bash
npm test
```
