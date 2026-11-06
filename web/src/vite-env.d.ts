/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовий URL API у production (на Vercel). У розробці порожній — працює проксі. */
  readonly VITE_API_URL?: string;
  /** Лише розробка: Telegram ID для входу з браузера (потрібен DEV_AUTH_BYPASS=true на сервері). */
  readonly VITE_DEV_TELEGRAM_ID?: string;
}
