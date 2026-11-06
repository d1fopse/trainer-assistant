type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { user?: { first_name?: string } };
  ready(): void;
  expand(): void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const webApp = window.Telegram?.WebApp;

/** Викликається один раз при старті: повідомляє Telegram, що додаток готовий, і розгортає його. */
export function initTelegram() {
  webApp?.ready();
  webApp?.expand();
}

/**
 * Значення для заголовка Authorization.
 * У Telegram — підписаний initData; у браузері під час розробки — `dev <id>`
 * (працює лише якщо сервер запущено з DEV_AUTH_BYPASS=true).
 */
export function getAuthHeader(): string | null {
  if (webApp?.initData) return `tma ${webApp.initData}`;
  const devId = import.meta.env.DEV ? import.meta.env.VITE_DEV_TELEGRAM_ID : undefined;
  if (devId) return `dev ${devId}`;
  return null;
}

export function getTelegramFirstName(): string {
  return webApp?.initDataUnsafe?.user?.first_name ?? '';
}
