import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateTime } from 'luxon';
import { analyticsApi, calendarApi, type Analytics, type TrainerSlot } from '../api';
import { useNav } from '../nav';
import { getPref, setPref } from '../telegram';
import { ZONE, fmt, fromIso, isoDate, now, timeRange, weekStart } from '../time';
import { Chip, Ev, Loading, LoadError, Screen, Section, Segmented, Stat, formatUah, useLoad } from '../ui';

type Period = 'month' | 'prev' | 'quarter' | 'year';
let lastPeriod: Period | null = null;

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
  const [period, setPeriod] = useState<Period>(
    () => lastPeriod ?? (['month', 'prev', 'quarter', 'year'] as const).find((p) => p === getPref('analyticsPeriod')) ?? 'month',
  );
  lastPeriod = period;
  useEffect(() => setPref('analyticsPeriod', period), [period]);
  const [from, to] = range(period);
  const { data, failed, reload } = useLoad<Analytics>(() => analyticsApi.get(from!.toISODate()!, to!.toISODate()!), [period]);
  const week = weekStart(now());
  const weekSlots = useLoad<TrainerSlot[]>(() => calendarApi.trainerRange(week.toISO()!, week.plus({ days: 7 }).toISO()!), [isoDate(week)]);
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
          <div className="card stack">
            <div className="price-top">
              <span className="muted small">
                {t('analytics.income')} · {fmt(fromIso(`${data.period.from}T12:00`), lang, 'd MMM')} – {fmt(fromIso(`${data.period.to}T12:00`), lang, 'd MMM')}
              </span>
              <span className="tiny muted">{t('analytics.payments', { count: data.income.payments })}</span>
            </div>
            <span className="big-number">{uah(data.income.total)}</span>
            <BarChart
              data={data.income.byMonth.map((m) => ({
                label: fmt(DateTime.fromISO(`${m.month}-01`), lang, 'LLL'),
                value: m.total,
              }))}
              format={(v) => formatUah(v, lang)}
            />
            {data.income.byPurpose.length > 0 && (
              <div className="legend" style={{ padding: 0 }}>
                {data.income.byPurpose.map((p) => (
                  <span key={p.purpose}>
                    {t(`money.purpose.${p.purpose}`)}: <b style={{ color: 'var(--text)' }}>{uah(p.total)}</b>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="tiles">
            <Stat label={t('analytics.visits')} value={data.attendance.attended} sub={t('analytics.attendanceRate', { rate: pctText(data.attendance.rate) })} subTone="green" />
            <Stat label={t('analytics.load')} value={pctText(data.load.rate)} sub={t('analytics.seats', { booked: data.load.booked, seats: data.load.seats })} />
            <Stat
              label={t('mark.noShow')}
              value={data.attendance.noShows}
              tone={data.attendance.noShows ? 'red' : undefined}
              sub={`${data.attendance.cancelled} ${t('analytics.cancelledCount', { count: data.attendance.cancelled })}`}
            />
          </div>
          <div className="tiles two">
            <Stat label={t('analytics.trialConversion')} value={pctText(data.trials.rate)} sub={t('analytics.trialsOf', { converted: data.trials.converted, total: data.trials.attended })} />
            <Stat label={t('analytics.newClientsShort')} value={data.newClients} tone={data.newClients ? 'blue' : undefined} sub={t('analytics.forPeriod')} />
          </div>

          {(data.attendance.unmarked > 0 || data.unpaidVisits > 0) && (
            <div className="card warn-card">
              {data.attendance.unmarked > 0 && <p className="warn-text small">{t('analytics.unmarked', { count: data.attendance.unmarked })}</p>}
              {data.unpaidVisits > 0 && <p className="warn-text small">{t('analytics.unpaid', { count: data.unpaidVisits })}</p>}
            </div>
          )}

          <Section title={t('analytics.thisWeek')} hint={t('analytics.thisWeekHint')}>
            {weekSlots.data ? <WeekGantt slots={weekSlots.data} byWeekday={data.load.byWeekday} /> : <Loading />}
          </Section>

          {(data.endingPasses.length > 0 || data.trials.list.length > 0) && (
            <Section title={t('analytics.events')}>
              <div className="stream">
                {data.endingPasses.map((p) => (
                  <Ev
                    key={`e${p.clientId}`}
                    tone="yellow"
                    future
                    title={p.name}
                    sub={
                      t('money.sessionsLeft', { count: p.remaining }) +
                      `: ${p.remaining}` +
                      (p.expiresAt ? ` · ${t('money.until', { date: fmt(fromIso(`${p.expiresAt}T12:00`), lang, 'd MMM') })}` : '')
                    }
                    chip={<Chip tone="yellow">{t('analytics.renew')}</Chip>}
                    onClick={() => nav.push({ name: 'client', id: p.clientId })}
                  />
                ))}
                {data.trials.list.map((tr) => (
                  <Ev
                    key={`t${tr.clientId}-${tr.at}`}
                    tone={tr.converted ? 'green' : tr.status === 'ATTENDED' ? 'yellow' : 'blue'}
                    future={tr.status === 'BOOKED'}
                    title={`${t('calendar.trial')} · ${tr.name}`}
                    sub={fmt(fromIso(tr.at), lang, 'd MMM, HH:mm')}
                    chip={
                      <Chip tone={tr.converted ? 'green' : tr.status === 'ATTENDED' ? 'yellow' : 'blue'}>
                        {tr.converted ? t('analytics.converted') : tr.status === 'ATTENDED' ? t('analytics.notConverted') : t('mark.booked')}
                      </Chip>
                    }
                    onClick={() => nav.push({ name: 'client', id: tr.clientId })}
                  />
                ))}
              </div>
            </Section>
          )}

          <Section title={t('analytics.byClient')} hint={t('analytics.byClientHint')}>
            {data.attendance.perClient.length === 0 && <p className="muted note">{t('analytics.noData')}</p>}
            {(() => {
              const list = [...data.attendance.perClient].sort((a, b) => b.attended - a.attended);
              const max = Math.max(1, ...list.map((c) => c.attended));
              return (allClients ? list : list.slice(0, 8)).map((c) => (
                <button key={c.clientId} className="bar-row list-row" onClick={() => nav.push({ name: 'client', id: c.clientId })}>
                  <span className="name">{c.name}</span>
                  <span className="track">
                    <i style={{ width: `${(c.attended / max) * 100}%` }} />
                  </span>
                  <span className="num">{c.attended}</span>
                  <span className={`num${c.noShows ? ' error' : ' faint'}`}>{c.noShows}</span>
                </button>
              ));
            })()}
            {data.attendance.perClient.length > 8 && !allClients && (
              <button className="link-button small" style={{ padding: '4px 0 10px' }} onClick={() => setAllClients(true)}>
                {t('money.showAll', { count: data.attendance.perClient.length })}
              </button>
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}

/** Тиждень як шкала: кожен день — смуга 7:00–22:00 зі слотами; праворуч — заповненість дня тижня за період. */
function WeekGantt({ slots, byWeekday }: { slots: TrainerSlot[]; byWeekday: Analytics['load']['byWeekday'] }) {
  const { t } = useTranslation();
  const open = slots.filter((s) => s.status === 'OPEN');
  const hour = (iso: string) => {
    const d = fromIso(iso);
    return d.hour + d.minute / 60;
  };
  const from = Math.min(7, ...open.map((s) => Math.floor(hour(s.startsAt))));
  const to = Math.max(22, ...open.map((s) => Math.ceil(hour(s.startsAt) + s.durationMin / 60)));
  const pct = (x: number) => ((x - from) / (to - from)) * 100;
  const names = t('calendar.weekdaysShort', { returnObjects: true }) as string[];
  const ticks: number[] = [];
  for (let h = from; h <= to; h += 3) ticks.push(h);
  return (
    <div className="gantt" style={{ paddingBottom: 12 }}>
      <div className="gantt-row" aria-hidden>
        <span className="d" />
        <div className="gantt-track ticks">
          {ticks.map((h) => (
            <span key={h} style={{ left: `${pct(h)}%` }}>
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>
        <span className="r" />
      </div>
      {names.map((name, i) => {
        const daySlots = open.filter((s) => fromIso(s.startsAt).weekday === i + 1);
        const w = byWeekday.find((d) => d.weekday === i + 1);
        const load = w && w.seats ? `${Math.round((w.booked / w.seats) * 100)}%` : '—';
        return (
          <div key={name} className="gantt-row">
            <span className="d">{name}</span>
            <div className="gantt-track" role="img" aria-label={`${name}: ${daySlots.map((s) => timeRange(s.startsAt, s.durationMin)).join(', ')}`}>
              {daySlots.map((s) => {
                const a = hour(s.startsAt);
                return (
                  <i
                    key={s.id}
                    className={s.type === 'GROUP' ? 'group' : ''}
                    style={{ left: `${pct(a)}%`, width: `${pct(a + s.durationMin / 60) - pct(a)}%`, opacity: s.bookedCount ? 1 : 0.35 }}
                  />
                );
              })}
            </div>
            <span className="r">{load}</span>
          </div>
        );
      })}
      <div className="legend" style={{ padding: '4px 0 0' }}>
        <span>
          <i style={{ background: 'var(--blue)', borderRadius: 3 }} />
          {t('calendar.type.INDIVIDUAL').toLowerCase()}
        </span>
        <span>
          <i style={{ background: 'var(--violet)', borderRadius: 3 }} />
          {t('calendar.type.GROUP').toLowerCase()}
        </span>
        <span>
          <i style={{ background: 'var(--blue)', opacity: 0.35, borderRadius: 3 }} />
          {t('calendar.free').toLowerCase()}
        </span>
      </div>
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
  const pad = 14; // поля, щоб підписи крайніх стовпчиків не обрізались
  const top_ = Math.max(max ?? 0, ...data.map((d) => d.value), 1);
  const bw = (W - pad * 2) / data.length;
  const best = data.reduce((i, d, j) => (d.value > data[i]!.value ? j : i), 0);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} className="chart-axis" />
      {data.map((d, i) => {
        const h = ((H - top - bottom) * d.value) / top_;
        const x = pad + i * bw + bw * 0.18;
        const y = H - bottom - h;
        const showValue = data.length <= 7 || i === best || i === data.length - 1;
        return (
          <g key={i}>
            <title>{`${d.label}: ${format(d.value)}${d.note ? ` (${d.note})` : ''}`}</title>
            <rect
              x={x}
              y={y}
              width={bw * 0.64}
              height={Math.max(h, d.value ? 2 : 0)}
              rx="4"
              className={(highlightLast && i === data.length - 1) || (!highlightLast && i === best && d.value > 0) ? 'chart-bar hot' : 'chart-bar'}
            />
            {showValue && d.value > 0 && (
              <text x={x + bw * 0.32} y={y - 4} textAnchor="middle" className="chart-value">
                {format(d.value)}
              </text>
            )}
            {/* При 12 стовпчиках підписуємо кожен другий (останній — завжди), щоб підписи не злипались. */}
            {(data.length <= 7 || (data.length - 1 - i) % 2 === 0) && (
              <text x={x + bw * 0.32} y={H - 6} textAnchor="middle" className="chart-label">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
