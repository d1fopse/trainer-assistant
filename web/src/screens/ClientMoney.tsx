import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { moneyApi, type AuditEntry, type ClientHistory } from '../api';
import { useNav } from '../nav';
import { haptic } from '../telegram';
import { fmt, fromIso, isoDate, now, timeRange } from '../time';
import { Loading, LoadError, Ring, Section, formatUah, useLoad } from '../ui';
import { bookingStatusText } from './BookingRow';

const VISITS_SHOWN = 10;

export function ClientMoney({ clientId }: { clientId: number }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nav = useNav();
  const { data, setData, failed, reload } = useLoad<ClientHistory>(() => moneyApi.history(clientId), [clientId]);
  const [allVisits, setAllVisits] = useState(false);
  const [busy, setBusy] = useState(false);

  if (failed) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;

  const { summary, payments, audit } = data;
  // Майбутні невідмічені записи — окремо (від найближчого), решта — історія (від останнього).
  const nowMs = Date.now();
  const upcoming = data.visits
    .filter((v) => v.status === 'BOOKED' && v.slotStatus === 'OPEN' && new Date(v.startsAt).getTime() >= nowMs)
    .reverse();
  const visits = data.visits.filter((v) => !upcoming.includes(v));
  const shown = allVisits ? visits : visits.slice(0, VISITS_SHOWN);
  const low = summary.activePasses.length > 0 && summary.remaining <= 1;
  const activeTotal = summary.activePasses.reduce((n, p) => n + p.totalSessions, 0);

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

  return (
    <>
      <Section title={t('money.pass')}>
        <div className="remaining">
          <Ring value={activeTotal ? summary.remaining / activeTotal : 0} size={96} stroke={8} tone={low ? 'amber' : 'flow'} label={t('money.pass')}>
            <span className="ring-value remaining-num">{summary.remaining}</span>
          </Ring>
          <span className="muted">{t('money.sessionsLeft', { count: summary.remaining })}</span>
        </div>
        {low && <p className="warn-text small">{t('money.lowPass')}</p>}
        {summary.activePasses.length === 0 && <p className="muted small">{t('money.noActivePass')}</p>}
        {summary.unpaid > 0 && (
          <div className="stack unpaid">
            <span className="warn-text small">{t('money.unpaid', { count: summary.unpaid })}</span>
            {summary.activePasses.length > 0 && (
              <button className="small-button secondary" disabled={busy} onClick={() => void applyUnpaid()}>
                {t('money.applyUnpaid')}
              </button>
            )}
          </div>
        )}
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
        <div className="mark-buttons">
          <button className="small-button" onClick={() => nav.push({ name: 'paymentForm', clientId })}>
            + {t('money.addPayment')}
          </button>
          <button className="small-button secondary" onClick={() => nav.push({ name: 'passForm', clientId })}>
            + {t('money.addGiftPass')}
          </button>
        </div>
      </Section>

      {upcoming.length > 0 && (
        <Section title={t('money.upcoming')}>
          {upcoming.slice(0, 5).map((v) => (
            <button key={v.bookingId} className="list-row compact" onClick={() => nav.push({ name: 'slot', id: v.slotId })}>
              <span className="list-main">
                <span className="list-title">
                  {fmt(fromIso(v.startsAt), lang, 'ccc, d MMM')} · {timeRange(v.startsAt, v.durationMin)}
                </span>
                <span className="muted small">
                  {t(`calendar.type.${v.type}`)}
                  {v.isTrial && ` · ${t('calendar.trial')}`}
                </span>
              </span>
              <span className="chevron">›</span>
            </button>
          ))}
          {upcoming.length > 5 && <p className="muted small">{t('money.moreUpcoming', { count: upcoming.length - 5 })}</p>}
        </Section>
      )}

      <Section title={t('money.visits')} hint={t('money.visitsStats', { attended: summary.attended, noShows: summary.noShows })}>
        {visits.length === 0 && <p className="muted note">{t('money.noVisits')}</p>}
        {shown.map((v) => {
          const st = bookingStatusText(t, v);
          return (
            <button
              key={v.bookingId}
              className={`list-row compact${v.status === 'CANCELLED' ? ' faded' : ''}`}
              onClick={() => v.slotStatus === 'OPEN' && nav.push({ name: 'slot', id: v.slotId })}
            >
              <span className="list-main">
                <span className="list-title">
                  {fmt(fromIso(v.startsAt), lang, 'ccc, d MMM')} · {timeRange(v.startsAt, v.durationMin)}
                </span>
                <span className={`small ${st.tone === 'ok' ? 'ok-text' : st.tone === 'warn' ? 'warn-text' : st.tone === 'bad' ? 'error' : 'muted'}`}>
                  {st.text}
                  {v.type === 'GROUP' && ` · ${t('calendar.type.GROUP')}`}
                </span>
              </span>
            </button>
          );
        })}
        {visits.length > VISITS_SHOWN && !allVisits && (
          <button className="link-button small" onClick={() => setAllVisits(true)}>
            {t('money.showAll', { count: visits.length })}
          </button>
        )}
        <div className="mark-buttons">
          <button className="small-button secondary" onClick={() => nav.push({ name: 'visitForm', clientId })}>
            + {t('money.addVisit')}
          </button>
        </div>
      </Section>

      <Section title={t('money.payments')}>
        {payments.length === 0 && <p className="muted note">{t('money.noPayments')}</p>}
        {payments.map((p) => (
          <button key={p.id} className="list-row compact" onClick={() => nav.push({ name: 'paymentForm', clientId, id: p.id })}>
            <span className="list-main">
              <span className="list-title">{t('common.uah', { value: formatUah(p.amountUah, lang) })}</span>
              <span className="muted small">
                {fmt(fromIso(`${p.paidAt}T12:00`), lang, 'd MMM yyyy')} · {t(`money.purpose.${p.purpose}`)} ·{' '}
                {t(`money.method.${p.method}`)}
                {p.note && ` · ${p.note}`}
              </span>
            </span>
            <span className="chevron">›</span>
          </button>
        ))}
      </Section>

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

const STATUS_KEYS: Record<string, string> = {
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
