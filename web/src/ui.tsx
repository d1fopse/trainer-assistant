import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { insideTelegram } from './telegram';
import { useNav } from './nav';
import { Icon } from './icons';

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
          <button className="icon-button" aria-label={t('common.back')} onClick={() => nav.pop()}>
            <Icon name="chevronLeft" size={18} />
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

/**
 * Світне кільце-індикатор (головний візуальний акцент інтерфейсу).
 * value — частка 0…1; tone — палітра дуги.
 */
export function Ring({
  value,
  size = 168,
  stroke = 12,
  tone = 'flow',
  children,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: 'flow' | 'coral' | 'amber' | 'violet';
  children?: ReactNode;
  label?: string;
}) {
  const id = useId().replace(/:/g, '');
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2 - 6;
  const c = 2 * Math.PI * r;
  const stops: Record<string, [string, string]> = {
    flow: ['#6EA8FF', '#5CE5C2'],
    coral: ['#FF9A8A', '#FF6F91'],
    amber: ['#F4C46A', '#FF9A6A'],
    violet: ['#A98BFF', '#6EA8FF'],
  };
  const [a, b] = stops[tone]!;
  // Точка на кінці дуги — «світло» індикатора.
  const angle = v * 2 * Math.PI - Math.PI / 2;
  const cx = size / 2 + r * Math.cos(angle);
  const cy = size / 2 + r * Math.sin(angle);
  return (
    <div className="ring" style={{ width: size, height: size, ['--ring-size' as string]: `${size}px` }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
          <radialGradient id={`d${id}`} cx="0.5" cy="0.35" r="0.7">
            <stop offset="0" stopColor="rgba(255,255,255,0.10)" />
            <stop offset="1" stopColor="rgba(255,255,255,0.01)" />
          </radialGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r - stroke - 4} fill={`url(#d${id})`} className="ring-disc" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="ring-track" />
        {v > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#g${id})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className="ring-arc"
            style={{ ['--ring-c' as string]: c, ['--ring-off' as string]: c * (1 - v) }}
          />
        )}
        {v > 0 && v < 1 && <circle cx={cx} cy={cy} r={stroke / 2.6} fill="#fff" className="ring-tip" />}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}
