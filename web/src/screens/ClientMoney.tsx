import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { moneyApi, type AuditEntry, type ClientHistory } from '../api';
import { useNav } from '../nav';
import { haptic } from '../telegram';
import { fmt, fromIso, isoDate, now, timeRange } from '../time';
import { Chip, Ev, Loading, LoadError, PassLine, Section, Stat, StreamNow, formatUah, useLoad, type Tone } from '../ui';
import { bookingStatusText } from './BookingRow';

const EVENTS_SHOWN = 12;

type Event = {
  key: string;
  at: string;
  future: boolean;
  node: (future: boolean) => JSX.Element;
};

export function ClientMoney({ clientId }: { clientId: number }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nav = useNav();
  const { data, setData, failed, reload } = useLoad<ClientHistory>(() => moneyApi.history(clientId), [clientId]);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);

  if (failed) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;

  const { summary, payments, audit } = data;
  const nowMs = Date.now();
  const isFuture = (iso: string) => new Date(iso).getTime() >= nowMs;
  const low = summary.activePasses.length > 0 && summary.remaining <= 1;
  // Абонемент, що закінчиться першим, — на шкалі.
  const pass = [...summary.activePasses].sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'))[0];
  const paid = payments.reduce((n, p) => n + p.amountUah, 0);
  const passByPayment = new Map(summary.passes.filter((p) => p.paymentId).map((p) => [p.paymentId!, p]));
  const uah = (v: number) => t('common.uah', { value: formatUah(v, lang) });
  const day = (iso: string) => fmt(fromIso(iso), lang, 'ccc d MMM');

  const events: Event[] = [];
  for (const v of data.visits) {
    const future = v.status === 'BOOKED' && v.slotStatus === 'OPEN' && isFuture(v.startsAt);
    const st = bookingStatusText(t, v);
    const tone: Tone = future
      ? v.type === 'GROUP'
        ? 'violet'
        : 'blue'
      : v.status === 'ATTENDED'
        ? 'green'
        : v.status === 'NO_SHOW'
          ? 'red'
          : v.status === 'BOOKED'
            ? 'yellow'
            : 'muted';
    const chip = future
      ? t('mark.booked').toLowerCase()
      : v.status === 'BOOKED'
        ? t('money.notMarked')
        : t(STATUS_KEYS[v.status]!).toLowerCase();
    const sub = [
      timeRange(v.startsAt, v.durationMin),
      !future && v.status !== 'BOOKED' && v.status !== 'CANCELLED' ? st.text.split(' · ').slice(1).join(' · ') : null,
      v.isTrial ? t('calendar.trial') : null,
    ]
      .filter(Boolean)
      .join(' · ');
    events.push({
      key: `v${v.bookingId}`,
      at: v.startsAt,
      future,
      node: (f) => (
        <Ev
          key={`v${v.bookingId}`}
          tone={tone}
          future={f}
          faded={v.status === 'CANCELLED'}
          title={`${day(v.startsAt)} · ${t(`calendar.type.${v.type}`)}`}
          sub={sub}
          chip={<Chip tone={tone}>{chip}</Chip>}
          onClick={v.slotStatus === 'OPEN' ? () => nav.push({ name: 'slot', id: v.slotId }) : undefined}
        />
      ),
    });
  }
  for (const p of payments) {
    const linked = passByPayment.get(p.id);
    events.push({
      key: `p${p.id}`,
      at: `${p.paidAt}T12:00:00`,
      future: false,
      node: () => (
        <Ev
          key={`p${p.id}`}
          tone="yellow"
          title={t('money.paymentEvent', { amount: uah(p.amountUah) })}
          sub={[fmt(fromIso(`${p.paidAt}T12:00`), lang, 'd MMM'), t(`money.purpose.${p.purpose}`), t(`money.method.${p.method}`), p.note]
            .filter(Boolean)
            .join(' · ')}
          chip={linked ? <Chip tone="yellow">{t('money.plusSessions', { count: linked.totalSessions })}</Chip> : undefined}
          onClick={() => nav.push({ name: 'paymentForm', clientId, id: p.id })}
        />
      ),
    });
  }
  for (const p of summary.passes.filter((x) => !x.paymentId)) {
    events.push({
      key: `g${p.id}`,
      at: `${p.purchasedAt}T12:00:00`,
      future: false,
      node: () => (
        <Ev
          key={`g${p.id}`}
          tone="yellow"
          title={t('money.giftPassEvent')}
          sub={[fmt(fromIso(`${p.purchasedAt}T12:00`), lang, 'd MMM'), p.note].filter(Boolean).join(' · ')}
          chip={<Chip tone="yellow">{t('money.plusSessions', { count: p.totalSessions })}</Chip>}
          onClick={() => nav.push({ name: 'passForm', clientId, id: p.id })}
        />
      ),
    });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  const upcoming = events.filter((e) => e.future);
  const past = events.filter((e) => !e.future);
  const pastShown = showAll ? past : past.slice(0, EVENTS_SHOWN);

  async function applyUnpaid() {
    setBusy(true);
    try {
      const r = await moneyApi.applyUnpaid(clientId);
      haptic('success');
      setData({ ...data!, summary: r.summary });
      void reload();
    } finally {
      setBusy(false);
    }
  }

  const passMarks = pass
    ? data.visits
        .filter((v) => (v.passId === pass.id && v.deducted) || (v.status === 'BOOKED' && v.slotStatus === 'OPEN' && isFuture(v.startsAt)))
        .map((v) => ({ at: v.startsAt, kind: (v.status === 'BOOKED' ? 'b' : v.status === 'NO_SHOW' ? 'n' : 'v') as 'v' | 'n' | 'b' }))
    : [];

  return (
    <>
      <div className="card stack">
        <div className="price-top">
          <span className="muted small">
            {pass ? t('money.passOf', { count: pass.totalSessions }) : t('money.pass')}
            {pass?.expiresAt && ` · ${t('money.until', { date: fmt(fromIso(`${pass.expiresAt}T12:00`), lang, 'd MMM') })}`}
          </span>
          <span className={`big-number${low ? ' warn-text' : ''}`} style={{ fontSize: 24 }}>
            {summary.remaining} <span className="muted small">{t('money.leftShort')}</span>
          </span>
        </div>
        {pass ? (
          <button className="price-body" onClick={() => nav.push({ name: 'passForm', clientId, id: pass.id })} aria-label={t('money.editPass')}>
            <PassLine
              start={pass.purchasedAt}
              end={pass.expiresAt}
              total={pass.totalSessions}
              remaining={pass.remaining}
              marks={passMarks}
              lang={lang}
            />
          </button>
        ) : (
          <p className="muted small">{t('money.noActivePass')}</p>
        )}
        {low && <p className="warn-text small">{t('money.lowPass')}</p>}
        {summary.unpaid > 0 && (
          <div className="price-top">
            <span className="warn-text small">{t('money.unpaid', { count: summary.unpaid })}</span>
            {summary.activePasses.length > 0 && (
              <button className="small-button secondary" disabled={busy} onClick={() => void applyUnpaid()}>
                {t('money.applyUnpaid')}
              </button>
            )}
          </div>
        )}
        <div className="row">
          <button className="small-button" onClick={() => nav.push({ name: 'paymentForm', clientId })}>
            + {t('money.addPayment')}
          </button>
          <button className="small-button secondary" onClick={() => nav.push({ name: 'passForm', clientId })}>
            {t('money.addGiftPassShort')}
          </button>
        </div>
      </div>

      <div className="tiles">
        <Stat label={t('mark.attended')} value={summary.attended} tone="green" />
        <Stat label={t('money.noShows')} value={summary.noShows} tone={summary.noShows ? 'red' : undefined} />
        <Stat label={t('money.paid')} value={formatUah(paid, lang)} mid sub={t('common.uahShort')} />
      </div>

      <Section title={t('money.history')} hint={t('money.historyHint')}>
        {events.length === 0 && <p className="muted note">{t('money.noVisits')}</p>}
        <div className="stream">
          {upcoming.map((e) => e.node(true))}
          {events.length > 0 && <StreamNow label={t('money.nowMark', { date: fmt(now(), lang, 'ccc d MMM') })} />}
          {pastShown.map((e) => e.node(false))}
        </div>
        {past.length > EVENTS_SHOWN && !showAll && (
          <button className="link-button small" onClick={() => setShowAll(true)} style={{ alignSelf: 'center', padding: '0 0 12px' }}>
            {t('money.showEarlier', { count: past.length - EVENTS_SHOWN })}
          </button>
        )}
        <div className="mark-buttons" style={{ marginBottom: 2 }}>
          <button className="small-button secondary" onClick={() => nav.push({ name: 'visitForm', clientId })}>
            + {t('money.addVisit')}
          </button>
        </div>
      </Section>

      {summary.passes.length > 0 && (
        <details className="details section">
          <summary>{t('money.allPasses', { count: summary.passes.length })}</summary>
          <div className="card list">
            {summary.passes.map((p) => {
              const expired = p.expiresAt !== null && p.expiresAt < isoDate(now());
              return (
                <button
                  key={p.id}
                  className={`list-row compact${p.remaining === 0 || expired ? ' faded' : ''}`}
                  onClick={() => nav.push({ name: 'passForm', clientId, id: p.id })}
                >
                  <span className="list-main">
                    <span className="list-title">
                      {p.remaining} / {p.totalSessions}
                    </span>
                    <span className="muted small">
                      {t('money.purchased', { date: fmt(fromIso(`${p.purchasedAt}T12:00`), lang, 'd MMM yyyy') })}
                      {p.expiresAt && ` · ${t('money.until', { date: fmt(fromIso(`${p.expiresAt}T12:00`), lang, 'd MMM yyyy') })}`}
                      {expired && ` · ${t('money.expired')}`}
                    </span>
                  </span>
                  <span className="chevron">›</span>
                </button>
              );
            })}
          </div>
        </details>
      )}

      {audit.length > 0 && (
        <details className="details section">
          <summary>{t('money.audit', { count: audit.length })}</summary>
          <div className="card">
            {audit.map((a) => (
              <div key={a.id} className="info-row">
                <span className="muted small">{fmt(fromIso(a.createdAt), lang, 'd MMM yyyy, HH:mm')}</span>
                <span className="value small">{auditText(a, t)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

export const STATUS_KEYS: Record<string, string> = {
  BOOKED: 'mark.booked',
  ATTENDED: 'mark.attended',
  NO_SHOW: 'mark.noShow',
  CANCELLED: 'mark.cancelled',
};

/** Опис запису журналу людською мовою. */
export function auditText(a: AuditEntry, t: TFunction): string {
  const d = a.details ?? {};
  const kv = (o: unknown) =>
    Object.entries((o ?? {}) as Record<string, unknown>)
      .map(([k, v]) => `${t(`money.field.${k}`, { defaultValue: k })}: ${v ?? '—'}`)
      .join(', ');
  switch (`${a.entity}.${a.action}`) {
    case 'booking.mark':
      return t('money.log.mark', {
        from: t(STATUS_KEYS[String(d.from)] ?? String(d.from)),
        to: t(STATUS_KEYS[String(d.to)] ?? String(d.to)),
        date: d.slotStartsAt ? fromIso(String(d.slotStartsAt)).toFormat('dd.MM HH:mm') : '',
      }) + (d.deducted ? ` · ${t('mark.deducted')}` : '');
    case 'booking.apply_unpaid':
      return t('money.log.applyUnpaid', { count: Number(d.applied ?? 0) });
    case 'payment.create':
      return t('money.log.paymentCreate', { amount: d.amountUah });
    case 'payment.update':
      return t('money.log.paymentUpdate', { before: kv(d.before), after: kv(d.after) });
    case 'payment.delete':
      return t('money.log.paymentDelete', { amount: d.amountUah });
    case 'pass.create':
      return t('money.log.passCreate', { count: Number(d.totalSessions ?? 0) });
    case 'pass.update':
      return t('money.log.passUpdate', { before: kv(d.before), after: kv(d.after) });
    case 'pass.delete':
      return t('money.log.passDelete', { count: Number(d.totalSessions ?? 0) });
    default:
      return `${a.entity} ${a.action}`;
  }
}
