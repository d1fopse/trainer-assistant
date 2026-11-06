import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateTime } from 'luxon';
import { analyticsApi, type Analytics } from '../api';
import { useNav } from '../nav';
import { ZONE, fmt, fromIso } from '../time';
import { Loading, LoadError, Screen, Section, Segmented, formatUah, useLoad } from '../ui';

type Period = 'month' | 'prev' | 'quarter' | 'year';
let lastPeriod: Period = 'month';

function range(p: Period) {
  const now = DateTime.now().setZone(ZONE);
  switch (p) {
    case 'month':
      return [now.startOf('month'), now.endOf('month')];
    case 'prev':
      return [now.minus({ months: 1 }).startOf('month'), now.minus({ months: 1 }).endOf('month')];
    case 'quarter':
      return [now.minus({ months: 2 }).startOf('month'), now.endOf('month')];
    case 'year':
      return [now.minus({ months: 11 }).startOf('month'), now.endOf('month')];
  }
}

export function AnalyticsScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nav = useNav();
  const [period, setPeriod] = useState<Period>(lastPeriod);
  lastPeriod = period;
  const [from, to] = range(period);
  const { data, failed, reload } = useLoad<Analytics>(() => analyticsApi.get(from!.toISODate()!, to!.toISODate()!), [period]);
  const [allClients, setAllClients] = useState(false);
  const uah = (v: number) => t('common.uah', { value: formatUah(v, lang) });
  const pctText = (v: number | null) => (v === null ? '—' : `${v.toFixed(v % 1 ? 1 : 0)}%`);

  return (
    <Screen title={t('analytics.title')}>
      <Segmented<Period>
        value={period}
        onChange={setPeriod}
        options={(['month', 'prev', 'quarter', 'year'] as const).map((p) => ({ value: p, label: t(`analytics.period.${p}`) }))}
      />

      {failed ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <p className="muted small center-text">
            {fmt(fromIso(`${data.period.from}T12:00`), lang, 'd MMM yyyy')} – {fmt(fromIso(`${data.period.to}T12:00`), lang, 'd MMM yyyy')}
          </p>

          <div className="kpis">
            <Kpi label={t('analytics.income')} value={uah(data.income.total)} sub={t('analytics.payments', { count: data.income.payments })} />
            <Kpi
              label={t('analytics.load')}
              value={pctText(data.load.rate)}
              sub={t('analytics.seats', { booked: data.load.booked, seats: data.load.seats })}
            />
            <Kpi
              label={t('analytics.attendance')}
              value={pctText(data.attendance.rate)}
              sub={t('analytics.attendedOf', { attended: data.attendance.attended, noShows: data.attendance.noShows })}
            />
            <Kpi
              label={t('analytics.trialConversion')}
              value={pctText(data.trials.rate)}
              sub={t('analytics.trialsOf', { converted: data.trials.converted, total: data.trials.attended })}
            />
          </div>

          {(data.attendance.unmarked > 0 || data.unpaidVisits > 0) && (
            <div className="card warn-card">
              {data.attendance.unmarked > 0 && <p className="warn-text small">{t('analytics.unmarked', { count: data.attendance.unmarked })}</p>}
              {data.unpaidVisits > 0 && <p className="warn-text small">{t('analytics.unpaid', { count: data.unpaidVisits })}</p>}
            </div>
          )}

          <Section title={t('analytics.incomeByMonth')}>
            <BarChart
              data={data.income.byMonth.map((m) => ({
                label: fmt(DateTime.fromISO(`${m.month}-01`), lang, 'LLL'),
                value: m.total,
              }))}
              format={(v) => formatUah(v, lang)}
            />
            {data.income.byPurpose.length > 0 && (
              <div className="legend">
                {data.income.byPurpose.map((p) => (
                  <span key={p.purpose}>
                    {t(`money.purpose.${p.purpose}`)}: <b>{uah(p.total)}</b>
                  </span>
                ))}
                {data.income.byMethod.map((m) => (
                  <span key={m.method} className="muted">
                    {t(`money.method.${m.method}`)}: {uah(m.total)}
                  </span>
                ))}
              </div>
            )}
          </Section>

          <Section title={t('analytics.loadByWeekday')} hint={t('analytics.emptySlots', { count: data.load.emptySlots })}>
            <BarChart
              data={data.load.byWeekday.map((d) => ({
                label: (t('calendar.weekdaysShort', { returnObjects: true }) as string[])[d.weekday - 1]!,
                value: d.seats ? Math.round((d.booked / d.seats) * 100) : 0,
                note: d.seats ? `${d.booked}/${d.seats}` : '',
              }))}
              max={100}
              highlightLast={false}
              format={(v) => `${v}%`}
            />
          </Section>

          <Section title={t('analytics.byClient')}>
            {data.attendance.perClient.length === 0 && <p className="muted note">{t('analytics.noData')}</p>}
            {data.attendance.perClient.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('analytics.client')}</th>
                    <th>{t('mark.attended')}</th>
                    <th>{t('mark.noShow')}</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {(allClients ? data.attendance.perClient : data.attendance.perClient.slice(0, 10)).map((c) => (
                    <tr key={c.clientId} onClick={() => nav.push({ name: 'client', id: c.clientId })}>
                      <td>{c.name}</td>
                      <td>{c.attended}</td>
                      <td className={c.noShows ? 'error' : ''}>{c.noShows}</td>
                      <td>{pctText(c.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.attendance.perClient.length > 10 && !allClients && (
              <button className="link-button small" onClick={() => setAllClients(true)}>
                {t('money.showAll', { count: data.attendance.perClient.length })}
              </button>
            )}
          </Section>

          <Section title={t('analytics.endingPasses')}>
            {data.endingPasses.length === 0 ? (
              <p className="muted note">{t('analytics.noEnding')}</p>
            ) : (
              data.endingPasses.map((p) => (
                <button key={p.clientId} className="list-row compact" onClick={() => nav.push({ name: 'client', id: p.clientId })}>
                  <span className="list-main">
                    <span className="list-title">{p.name}</span>
                    <span className="muted small">
                      {t('money.sessionsLeft', { count: p.remaining })}: {p.remaining}
                      {p.expiresAt && ` · ${t('money.until', { date: fmt(fromIso(`${p.expiresAt}T12:00`), lang, 'd MMM') })}`}
                    </span>
                  </span>
                  <span className="chevron">›</span>
                </button>
              ))
            )}
          </Section>

          {data.trials.list.length > 0 && (
            <Section title={t('analytics.trials')}>
              {data.trials.list.map((tr) => (
                <button key={`${tr.clientId}-${tr.at}`} className="list-row compact" onClick={() => nav.push({ name: 'client', id: tr.clientId })}>
                  <span className="list-main">
                    <span className="list-title">{tr.name}</span>
                    <span className="muted small">{fmt(fromIso(tr.at), lang, 'd MMM, HH:mm')}</span>
                  </span>
                  <span className={`status-chip ${tr.converted ? 'ok' : tr.status === 'ATTENDED' ? 'warn' : 'muted'}`}>
                    {tr.converted ? t('analytics.converted') : tr.status === 'ATTENDED' ? t('analytics.notConverted') : t('mark.booked')}
                  </span>
                </button>
              ))}
            </Section>
          )}

          <p className="muted small center-text">{t('analytics.newClients', { count: data.newClients })}</p>
        </>
      )}
    </Screen>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="kpi card">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="muted small">{sub}</span>
    </div>
  );
}

/** Простий стовпчиковий графік на SVG (без бібліотек). */
export function BarChart({
  data,
  format,
  max,
  highlightLast = true,
}: {
  data: { label: string; value: number; note?: string }[];
  format: (v: number) => string;
  max?: number;
  /** Підсвітити останній стовпчик (поточний місяць). */
  highlightLast?: boolean;
}) {
  const W = 320;
  const H = 140;
  const top = 18;
  const bottom = 20;
  const top_ = Math.max(max ?? 0, ...data.map((d) => d.value), 1);
  const bw = W / data.length;
  const best = data.reduce((i, d, j) => (d.value > data[i]!.value ? j : i), 0);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} className="chart-axis" />
      {data.map((d, i) => {
        const h = ((H - top - bottom) * d.value) / top_;
        const x = i * bw + bw * 0.18;
        const y = H - bottom - h;
        const showValue = data.length <= 7 || i === best || i === data.length - 1;
        return (
          <g key={i}>
            <title>{`${d.label}: ${format(d.value)}${d.note ? ` (${d.note})` : ''}`}</title>
            <rect x={x} y={y} width={bw * 0.64} height={Math.max(h, d.value ? 2 : 0)} rx="3" className={highlightLast && i === data.length - 1 ? 'chart-bar current' : 'chart-bar'} />
            {showValue && d.value > 0 && (
              <text x={x + bw * 0.32} y={y - 4} textAnchor="middle" className="chart-value">
                {format(d.value)}
              </text>
            )}
            <text x={x + bw * 0.32} y={H - 6} textAnchor="middle" className="chart-label">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
