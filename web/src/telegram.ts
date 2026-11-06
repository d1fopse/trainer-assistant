type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { user?: { first_name?: string } };
  ready(): void;
  expand(): void;
  openTelegramLink?(url: string): void;
  showConfirm?(message: string, callback: (ok: boolean) => void): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback?: { notificationOccurred(type: 'success' | 'error' | 'warning'): void };
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
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
  // Інтерфейс завжди темний — підфарбовуємо шапку й фон Telegram під нього.
  try {
    webApp?.setHeaderColor?.('#0D141D');
    webApp?.setBackgroundColor?.('#0D141D');
    webApp?.setBottomBarColor?.('#0D141D');
  } catch {
    /* старі версії Telegram */
  }
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

/** Відкриває особисті повідомлення з користувачем Telegram. */
export function openChat(username: string) {
  const url = `https://t.me/${encodeURIComponent(username)}`;
  if (webApp?.openTelegramLink) webApp.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}

/** Нативне підтвердження Telegram (у браузері — стандартне). */
export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (webApp?.showConfirm) webApp.showConfirm(message, resolve);
    else resolve(window.confirm(message));
  });
}

export function haptic(type: 'success' | 'error' | 'warning') {
  webApp?.HapticFeedback?.notificationOccurred(type);
}

/** Системна кнопка «Назад» Telegram. Повертає функцію для зняття обробника. */
export function bindBackButton(onBack: (() => void) | null): () => void {
  const bb = webApp?.BackButton;
  if (!bb) return () => {};
  if (!onBack) {
    bb.hide();
    return () => {};
  }
  bb.show();
  bb.onClick(onBack);
  return () => bb.offClick(onBack);
}

export const insideTelegram = Boolean(webApp?.initData);
