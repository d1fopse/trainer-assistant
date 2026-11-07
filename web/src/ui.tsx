import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { insideTelegram } from './telegram';
import { useNav } from './nav';
import { Icon } from './icons';

/** Завантаження даних для екрана з повтором при помилці. */
/**
 * Кеш відповідей: при поверненні на екран одразу показуємо останні дані,
 * а свіжі підтягуємо у фоні (без «Завантаження…» і стрибків сторінки).
 * Ключ — код функції завантаження + її залежності (той самий запит → той самий ключ).
 */
const loadCache = new Map<string, unknown>();
const CACHE_LIMIT = 200;

function cacheSet(key: string, value: unknown) {
  loadCache.delete(key);
  loadCache.set(key, value);
  if (loadCache.size > CACHE_LIMIT) loadCache.delete(loadCache.keys().next().value!);
}

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const key = `${load.toString()}|${JSON.stringify(deps)}`;
  const [data, setDataState] = useState<T | null>(() => (loadCache.get(key) as T | undefined) ?? null);
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(key);

  // Нові залежності (інший тиждень, інший клієнт) — показуємо кеш для них або «завантаження».
  if (keyRef.current !== key) {
    keyRef.current = key;
    setDataState((loadCache.get(key) as T | undefined) ?? null);
  }

  const setData = useCallback((v: T | null) => {
    if (v !== null) cacheSet(keyRef.current, v);
    setDataState(v);
  }, []);

  const reload = useCallback(async () => {
    const k = keyRef.current;
    setFailed(false);
    try {
      const v = await loadRef.current();
      cacheSet(k, v);
      if (keyRef.current === k) setDataState(v);
    } catch {
      // Якщо є попередні дані — лишаємо їх, помилку показуємо лише коли показати нічого.
      if (keyRef.current === k && !loadCache.has(k)) setFailed(true);
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
  subtitle,
  subTone,
  back,
  action,
  children,
}: {
  title: string;
  /** Рядок над заголовком (дата, тип слота). */
  subtitle?: ReactNode;
  subTone?: 'violet' | 'blue' | 'green';
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
        <div className="header-text">
          {subtitle && <span className={`header-sub${subTone ? ` ${subTone}` : ''}`}>{subtitle}</span>}
          <h1>{title}</h1>
        </div>
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

export function Section({
  title,
  hint,
  className,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className={`card${title ? '' : ' untitled'}${className ? ` ${className}` : ''}`}>
        {title && (
          <h2 className="section-title">
            <span>{title}</span>
            {hint && <span className="hint">{hint}</span>}
          </h2>
        )}
        {children}
      </div>
    </section>
  );
}

/** Плитка з підписом і великим значенням. */
export function Stat({
  label,
  value,
  sub,
  tone,
  subTone,
  mid,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'green' | 'red' | 'yellow' | 'blue';
  subTone?: 'green' | 'red';
  mid?: boolean;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value${mid ? ' mid' : ''}${tone ? ` ${tone}` : ''}`}>{value}</span>
      {sub !== undefined && <span className={`stat-sub${subTone ? ` ${subTone}` : ''}`}>{sub}</span>}
    </div>
  );
}

export type Tone = 'green' | 'red' | 'blue' | 'violet' | 'yellow' | 'muted';

const TONE_COLOR: Record<Tone, string> = {
  green: 'var(--green)',
  red: 'var(--red)',
  blue: 'var(--blue)',
  violet: 'var(--violet)',
  yellow: 'var(--yellow)',
  muted: 'var(--line-strong)',
};

export function Chip({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`chip${tone && tone !== 'muted' ? ` ${tone}` : ''}`}>{children}</span>;
}

/** Подія стрічки: крапка на лінії часу, заголовок, підпис, мітка праворуч. */
export function Ev({
  tone,
  title,
  sub,
  chip,
  future,
  faded,
  onClick,
}: {
  tone: Tone;
  title: ReactNode;
  sub?: ReactNode;
  chip?: ReactNode;
  future?: boolean;
  faded?: boolean;
  onClick?: () => void;
}) {
  const cls = `ev${future ? ' future' : ''}${faded ? ' faded' : ''}`;
  const style = { ['--c' as string]: TONE_COLOR[tone] };
  const body = (
    <>
      <span className="ev-dot" />
      <span className="ev-body">
        <span className="ev-top">
          <span className="ev-title">{title}</span>
          {chip}
        </span>
        {sub && <span className="ev-sub">{sub}</span>}
      </span>
    </>
  );
  return onClick ? (
    <button className={cls} style={style} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

export function StreamNow({ label }: { label: string }) {
  return (
    <div className="stream-now" aria-label={label}>
      <i />
      <span>{label}</span>
    </div>
  );
}

export function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

/**
 * Шкала абонемента: від дати покупки до кінця строку.
 * Крапки — відвідування (зелені) і неявки зі списанням (червоні), коло — майбутній запис.
 * Без строку дії — клітинки використаних занять.
 */
export function PassLine({
  start,
  end,
  total,
  remaining,
  marks,
  lang,
}: {
  start: string;
  end: string | null;
  total: number;
  remaining: number;
  marks: { at: string; kind: 'v' | 'n' | 'b' }[];
  lang: string;
}) {
  const used = Math.max(0, total - remaining);
  if (!end) {
    return (
      <div className="cells" role="img" aria-label={`${used} / ${total}`}>
        {Array.from({ length: Math.min(total, 40) }, (_, i) => (
          <span key={i} className={i < used ? 'on' : ''} />
        ))}
      </div>
    );
  }
  const a = new Date(`${start}T00:00:00`).getTime();
  const b = new Date(`${end}T23:59:59`).getTime();
  const span = Math.max(b - a, 1);
  const pos = (ms: number) => Math.max(0, Math.min(100, ((ms - a) / span) * 100));
  const nowPct = pos(Date.now());
  const label = (iso: string) =>
    new Intl.DateTimeFormat(lang === 'ru' ? 'ru-UA' : 'uk-UA', { day: 'numeric', month: 'short' }).format(new Date(`${iso}T12:00:00`));
  return (
    <div className="pass-line" role="img" aria-label={`${label(start)} – ${label(end)}: ${used} / ${total}`}>
      <span className="track" />
      <span className="fill" style={{ width: `${nowPct}%` }} />
      {marks.map((m, i) => (
        <span key={i} className={`pt ${m.kind}`} style={{ left: `${pos(new Date(m.at).getTime())}%` }} />
      ))}
      {nowPct > 0 && nowPct < 100 && <span className="now" style={{ left: `${nowPct}%` }} />}
      <span className="lbl" style={{ left: 0 }}>
        {label(start)}
      </span>
      <span className="lbl" style={{ right: 0 }}>
        {label(end)}
      </span>
    </div>
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
  inset,
}: {
  value: T;
  options: { value: T; label: string; badge?: number }[];
  onChange: (v: T) => void;
  inset?: boolean;
}) {
  return (
    <div className={`segmented${inset ? ' inset' : ''}`} role="tablist">
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

/**
 * Форматує номер під час введення до вигляду «+380 XX XXX XX XX».
 * Розуміє вставлені 0671234567, 380…, +38 (067)…; зайві цифри відкидає.
 */
export function formatPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('380')) d = d.slice(3);
  else if (d.length === 11 && d.startsWith('80')) d = d.slice(2);
  d = d.replace(/^0+/, '').slice(0, 9);
  if (!d) return raw.trim() === '' ? '' : '+380 ';
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return `+380 ${parts.join(' ')}`;
}

/** Порожньо (без телефону) або повний номер +380 XX XXX XX XX. */
export function phoneValid(v: string) {
  const t = v.trim();
  return t === '' || t === '+380' || /^\+380 \d{2} \d{3} \d{2} \d{2}$/.test(t);
}

/** Що відправляти на сервер: «+380» без цифр — це порожнє поле. */
export function phoneValue(v: string) {
  const t = v.trim();
  return t === '+380' ? '' : t;
}

/** Поле телефону з автоформатом +380 XX XXX XX XX. */
export function PhoneInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={value}
      autoFocus={autoFocus}
      placeholder="+380 67 123 45 67"
      onFocus={() => value === '' && onChange('+380 ')}
      onBlur={() => phoneValue(value) === '' && onChange('')}
      onChange={(e) => onChange(formatPhone(e.target.value))}
    />
  );
}

// Повідомлення, які вже показали в цьому запуску застосунку (після перезавантаження — знову).
const shownNotices = new Set<string>();

/**
 * Повідомлення, що зникає саме через `ms` мілісекунд, зі смужкою-таймером.
 * У межах одного запуску показується один раз (перехід між вкладками його не повертає),
 * після перезавантаження сторінки — знову.
 */
export function TimedNotice({ id, ms = 10000, children }: { id: string; ms?: number; children: ReactNode }) {
  const [visible, setVisible] = useState(() => !shownNotices.has(id));
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!visible) return;
    shownNotices.add(id);
    const fade = setTimeout(() => setLeaving(true), ms);
    const hide = setTimeout(() => setVisible(false), ms + 300);
    return () => {
      clearTimeout(fade);
      clearTimeout(hide);
    };
  }, [id, ms, visible]);
  if (!visible) return null;
  return (
    <div className={`card notice timed-notice${leaving ? ' leaving' : ''}`} role="status">
      <p className="note">{children}</p>
      <span className="timer" aria-hidden style={{ animationDuration: `${ms}ms` }} />
    </div>
  );
}
