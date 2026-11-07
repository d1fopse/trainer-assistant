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
  HapticFeedback?: {
    notificationOccurred(type: 'success' | 'error' | 'warning'): void;
    impactOccurred?(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  };
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  // Bot API 7.7+ / 8.0+ (Mini Apps 2.0) / 9.0+
  platform?: string;
  version?: string;
  isVersionAtLeast?(version: string): boolean;
  isFullscreen?: boolean;
  requestFullscreen?(): void;
  disableVerticalSwipes?(): void;
  addToHomeScreen?(): void;
  checkHomeScreenStatus?(cb: (status: HomeScreenStatus) => void): void;
  onEvent?(event: string, cb: (...args: unknown[]) => void): void;
  offEvent?(event: string, cb: (...args: unknown[]) => void): void;
  DeviceStorage?: {
    getItem(key: string, cb: (err: string | null, value?: string | null) => void): void;
    setItem(key: string, value: string, cb?: (err: string | null, ok?: boolean) => void): void;
  };
};

export type HomeScreenStatus = 'unsupported' | 'unknown' | 'added' | 'missed';

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
    webApp?.setHeaderColor?.('#0B0D10');
    webApp?.setBackgroundColor?.('#0B0D10');
    webApp?.setBottomBarColor?.('#0B0D10');
  } catch {
    /* старі версії Telegram */
  }
  // Свайп вниз не закриває застосунок (щоб не втратити заповнену форму).
  if (atLeast('7.7')) {
    try {
      webApp?.disableVerticalSwipes?.();
    } catch {
      /* ignore */
    }
  }
  // Mini Apps 2.0: на телефонах відкриваємось на весь екран.
  // На комп'ютері лишаємо звичайне вікно — повноекранний режим там займає весь монітор.
  if (atLeast('8.0') && MOBILE.has(webApp?.platform ?? '')) {
    try {
      if (!webApp?.isFullscreen) webApp?.requestFullscreen?.();
    } catch {
      /* ignore */
    }
  }
  syncFullscreenClass();
  webApp?.onEvent?.('fullscreenChanged', syncFullscreenClass);
}

const MOBILE = new Set(['ios', 'android', 'android_x']);

function atLeast(v: string) {
  try {
    return Boolean(webApp?.isVersionAtLeast?.(v));
  } catch {
    return false;
  }
}

/** Клас на <html>, щоб стилі знали про повноекранний режим. */
function syncFullscreenClass() {
  document.documentElement.classList.toggle('tg-fullscreen', Boolean(webApp?.isFullscreen));
}

// ---------- Іконка на головному екрані (Bot API 8.0) ----------

export const canAddToHomeScreen = atLeast('8.0') && typeof webApp?.addToHomeScreen === 'function';

export function checkHomeScreen(): Promise<HomeScreenStatus> {
  return new Promise((resolve) => {
    if (!canAddToHomeScreen || !webApp?.checkHomeScreenStatus) return resolve('unsupported');
    try {
      webApp.checkHomeScreenStatus(resolve);
    } catch {
      resolve('unsupported');
    }
  });
}

/** Просить Telegram додати іконку; resolve(true), коли користувач додав. */
export function addToHomeScreen(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!canAddToHomeScreen) return resolve(false);
    const done = () => {
      webApp?.offEvent?.('homeScreenAdded', done);
      resolve(true);
    };
    webApp?.onEvent?.('homeScreenAdded', done);
    webApp?.addToHomeScreen?.();
    // Якщо користувач скасував — подія не прийде; перевіримо статус пізніше.
    setTimeout(() => {
      webApp?.offEvent?.('homeScreenAdded', done);
      void checkHomeScreen().then((s) => resolve(s === 'added'));
    }, 15000);
  });
}

// ---------- Налаштування на пристрої (DeviceStorage, Bot API 9.0; інакше localStorage) ----------

const prefs = new Map<string, string>();
const PREF_KEYS = ['analyticsPeriod'] as const;
export type PrefKey = (typeof PREF_KEYS)[number];

/** Завантажує збережені налаштування до першого рендеру (не довше ~400 мс). */
export async function loadPrefs() {
  for (const k of PREF_KEYS) {
    try {
      const v = localStorage.getItem(`ta.${k}`);
      if (v !== null) prefs.set(k, v);
    } catch {
      /* приватний режим тощо */
    }
  }
  const ds = atLeast('9.0') ? webApp?.DeviceStorage : undefined;
  if (!ds) return;
  const read = (k: string) =>
    new Promise<void>((resolve) => {
      try {
        ds.getItem(k, (err, value) => {
          if (!err && value) prefs.set(k, value);
          resolve();
        });
      } catch {
        resolve();
      }
    });
  await Promise.race([Promise.all(PREF_KEYS.map(read)), new Promise((r) => setTimeout(r, 400))]);
}

export function getPref(k: PrefKey): string | null {
  return prefs.get(k) ?? null;
}

export function setPref(k: PrefKey, value: string) {
  prefs.set(k, value);
  try {
    localStorage.setItem(`ta.${k}`, value);
  } catch {
    /* ignore */
  }
  if (atLeast('9.0')) {
    try {
      webApp?.DeviceStorage?.setItem(k, value);
    } catch {
      /* ignore */
    }
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

/** Короткий «стук» — відгук на утримання пальця. */
export function hapticImpact() {
  try {
    webApp?.HapticFeedback?.impactOccurred?.('medium');
  } catch {
    /* ignore */
  }
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
