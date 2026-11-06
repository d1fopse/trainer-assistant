import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { insideTelegram } from './telegram';
import { useNav } from './nav';

/** Завантаження даних для екрана з повтором при помилці. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    setFailed(false);
    try {
      setData(await loadRef.current());
    } catch {
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, failed, reload };
}

export function Screen({
  title,
  back,
  action,
  children,
}: {
  title: string;
  back?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const nav = useNav();
  const { t } = useTranslation();
  return (
    <div className="screen">
      <header className="header">
        {/* У Telegram «Назад» — системна кнопка вгорі, тут показуємо лише в браузері. */}
        {back && !insideTelegram && (
          <button className="link-button" onClick={() => nav.pop()}>
            ‹ {t('common.back')}
          </button>
        )}
        <h1>{title}</h1>
        {action}
      </header>
      {children}
    </div>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return <p className="muted center-text">{t('common.loading')}</p>;
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="center-text stack">
      <p>{t('errors.load')}</p>
      <button className="secondary" onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  );
}

export function Section({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="section">
      {title && (
        <h2>
          {title}
          {hint && <span className="muted small"> · {hint}</span>}
        </h2>
      )}
      <div className="card">{children}</div>
    </section>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="info-row">
      <span className="muted small">{label}</span>
      <span className="value">{children}</span>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; badge?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.badge ? <span className="count">{o.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function formatUah(value: number, lang: string) {
  return new Intl.NumberFormat(lang === 'ru' ? 'ru-UA' : 'uk-UA').format(value);
}

export function formatDate(iso: string, lang: string) {
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-UA' : 'uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

export const PHONE_RE = /^(\+?[0-9 ()-]{7,20})?$/;
