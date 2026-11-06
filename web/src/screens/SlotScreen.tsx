import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { calendarApi, waitlistApi, type BookingStatus, type TrainerSlot, type WaitlistEntry } from '../api';
import { errorText } from '../errors';
import { useNav } from '../nav';
import { confirmAction, haptic } from '../telegram';
import { fmt, formatDuration, fromIso, isoDate, now, timeRange } from '../time';
import { Loading, LoadError, Screen, Section, Stat, useLoad } from '../ui';
import { ClientSelect, useClientOptions } from './ClientSelect';
import { BookingRow } from './BookingRow';

export function SlotScreen({ id }: { id: number }) {
  const { t, i18n } = useTranslation();
  const nav = useNav();
  const lang = i18n.language;
  const { data: slot, setData, failed, reload } = useLoad(() => calendarApi.slot(id), [id]);
  const clients = useClientOptions();
  // Сусідні слоти дня — для міні-шкали.
  const dayKey = slot ? isoDate(fromIso(slot.startsAt)) : null;
  const daySlots = useLoad(
    () =>
      dayKey
        ? calendarApi.trainerRange(fromIso(`${dayKey}T00:00`).toISO()!, fromIso(`${dayKey}T00:00`).plus({ days: 1 }).toISO()!)
        : Promise.resolve([] as TrainerSlot[]),
    [dayKey],
  );
  const [pick, setPick] = useState('');
  const [trial, setTrial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (failed) {
    return (
      <Screen title="" back>
        <LoadError onRetry={reload} />
      </Screen>
    );
  }
  if (!slot) {
    return (
      <Screen title="" back>
        <Loading />
      </Screen>
    );
  }

  const start = fromIso(slot.startsAt);
  const free = slot.capacity - slot.bookedCount;

  async function run(action: () => Promise<TrainerSlot | void>) {
    setBusy(true);
    setError(null);
    try {
      const r = await action();
      if (r) {
        setData({ ...r, waitlist: slot?.waitlist });
        void reload(); // підтягнути актуальну чергу
      }
      haptic('success');
    } catch (e) {
      setError(errorText(e, t));
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  async function addClient() {
    if (!pick) return;
    await run(() => calendarApi.addBooking(id, Number(pick), trial));
    setPick('');
    setTrial(false);
  }

  async function markBooking(bookingId: number, status: BookingStatus, deduct?: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await calendarApi.mark(bookingId, status, deduct);
      setData({ ...r.slot, waitlist: slot?.waitlist });
      void reload();
      if (r.warning === 'no_active_pass') setNotice(t('mark.noPassWarning'));
      haptic(r.warning ? 'warning' : 'success');
    } catch (e) {
      setError(errorText(e, t));
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  async function waitlistAction(action: () => Promise<{ waitlist: WaitlistEntry[]; delivered?: boolean }>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await action();
      setData({ ...slot!, waitlist: r.waitlist });
      if (r.delivered === false) setNotice(t('waitlist.notDelivered'));
      haptic('success');
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking(bookingId: number, name: string) {
    if (!(await confirmAction(t('slot.confirmCancelBooking', { name })))) return;
    await run(() => calendarApi.cancelBooking(bookingId));
  }

  async function cancelSlot() {
    if (!slot || !(await confirmAction(t('slot.confirmCancelSlot')))) return;
    await run(async () => {
      await calendarApi.cancelSlot(id);
      nav.pop();
    });
  }

  async function cancelSeriesFromHere() {
    if (!slot?.seriesId || !(await confirmAction(t('slot.confirmCancelSeries')))) return;
    await run(async () => {
      await calendarApi.cancelSeries(slot.seriesId!, isoDate(start));
      nav.pop();
    });
  }

  const isGroup = slot.type === 'GROUP';
  const waitCount = slot.waitlist?.length ?? 0;
  const startMs = start.toMillis();
  const untilMin = Math.round((startMs - Date.now()) / 60000);

  return (
    <Screen
      title={timeRange(slot.startsAt, slot.durationMin)}
      subtitle={`${fmt(start, lang, 'ccc, d MMMM')} · ${t(`calendar.type.${slot.type}`)}${slot.note ? ` · ${slot.note}` : ''}`}
      subTone={isGroup ? 'violet' : 'blue'}
      back
      action={
        <button className="small-button secondary" onClick={() => nav.push({ name: 'slotForm', id })}>
          {t('common.edit')}
        </button>
      }
    >
      <div className="card stack">
        <div className="price-top">
          <span className="muted tiny">{t('slot.dayContext')}</span>
          {untilMin > 0 && untilMin < 24 * 60 && (
            <span className="tiny error" style={{ fontWeight: 700 }}>
              {t('slot.startsIn', { time: formatDuration(Math.max(untilMin, 1), lang) })}
            </span>
          )}
        </div>
        <MiniScale slot={slot} others={daySlots.data ?? []} />
      </div>

      <div className="tiles">
        <Stat
          label={t('slot.seats')}
          value={
            <>
              {slot.bookedCount}
              <small>/{slot.capacity}</small>
            </>
          }
        />
        <Stat label={t('slot.queue')} value={waitCount} tone={waitCount ? 'yellow' : undefined} />
        <Stat label={t('slot.duration')} value={t('slot.minutes', { count: slot.durationMin })} sub={slot.seriesId ? `↻ ${t('slot.inSeriesShort')}` : undefined} />
      </div>

      <Section title={t('slot.participants')}>
        <div className="participants">
          {slot.bookings.length === 0 && <p className="muted note">{t('calendar.freeWindow')}</p>}
          {slot.bookings.map((b) => (
            <div key={b.id} className={`participant${isGroup ? ' group' : ''}`}>
              <BookingRow
                b={b}
                busy={busy}
                onOpenClient={() => nav.push({ name: 'client', id: b.clientId })}
                onMark={(status, deduct) => void markBooking(b.id, status, deduct)}
                onCancel={() => void cancelBooking(b.id, b.name)}
              />
            </div>
          ))}
        </div>
      </Section>

      {waitCount > 0 && (
        <Section title={t('waitlist.title')} hint={t('waitlist.hint')} className="warn-card">
          {slot.waitlist!.map((w, i) => (
            <div key={w.id} className="booking-row">
              <span className="muted small">{i + 1}.</span>
              <div className="list-main">
                <button className="link-button" onClick={() => nav.push({ name: 'client', id: w.clientId })}>
                  {w.name}
                </button>
                <span className="muted tiny">
                  {w.status === 'NOTIFIED' && w.notifiedAt
                    ? `${t('waitlist.notified')} ${fmt(fromIso(w.notifiedAt), lang, 'd MMM, HH:mm')}`
                    : `${t('waitlist.waitingSince')} ${fmt(fromIso(w.createdAt), lang, 'd MMM, HH:mm')}`}
                </span>
              </div>
              <button className="small-button warn" disabled={busy} onClick={() => void waitlistAction(() => waitlistApi.notify(w.id))}>
                {t('waitlist.notify')}
              </button>
              <button className="icon-button sm" aria-label={t('common.delete')} disabled={busy} onClick={() => void waitlistAction(() => waitlistApi.remove(w.id))}>
                ×
              </button>
            </div>
          ))}
        </Section>
      )}

      {free > 0 && (
        <Section title={t('slot.addParticipant')}>
          <div className="stack">
            <ClientSelect
              value={pick}
              onChange={setPick}
              options={clients.data}
              exclude={slot.bookings.map((b) => b.clientId)}
            />
            {slot.type === 'INDIVIDUAL' && (
              <label className="check">
                <input type="checkbox" checked={trial} onChange={(e) => setTrial(e.target.checked)} />
                <span>{t('slot.trial')}</span>
              </label>
            )}
            <button disabled={!pick || busy} onClick={() => void addClient()}>
              {t('slot.add')}
            </button>
          </div>
        </Section>
      )}

      {error && <p className="error">{error}</p>}
      {notice && <p className="warn-text">{notice}</p>}

      {slot.seriesId && (
        <div className="stack">
          <button
            className="secondary"
            onClick={() => nav.push({ name: 'seriesForm', seriesId: slot.seriesId!, fromDate: isoDate(start) })}
          >
            {t('slot.editSeries')}
          </button>
          <button className="danger" disabled={busy} onClick={() => void cancelSeriesFromHere()}>
            {t('slot.cancelSeries')}
          </button>
        </div>
      )}
      <button className="danger" disabled={busy} onClick={() => void cancelSlot()}>
        {slot.seriesId ? t('slot.cancelThisOnly') : t('slot.cancelSlot')}
      </button>
    </Screen>
  );
}

/** Міні-шкала дня: цей слот підсвічений, сусідні — блідіші, червона риска — зараз. */
function MiniScale({ slot, others }: { slot: TrainerSlot; others: TrainerSlot[] }) {
  const all = [slot, ...others.filter((o) => o.id !== slot.id && o.status === 'OPEN')];
  const h = (iso: string) => {
    const d = fromIso(iso);
    return d.hour + d.minute / 60;
  };
  const from = Math.floor(Math.min(...all.map((s) => h(s.startsAt))));
  const to = Math.min(24, Math.max(from + 2, Math.ceil(Math.max(...all.map((s) => h(s.startsAt) + s.durationMin / 60)))));
  const pct = (x: number) => ((x - from) / (to - from)) * 100;
  const n = now();
  const sameDay = isoDate(n) === isoDate(fromIso(slot.startsAt));
  const nowH = n.hour + n.minute / 60;
  const step = to - from > 8 ? 2 : 1;
  const ticks = [];
  for (let x = from; x <= to; x += step) ticks.push(x);
  return (
    <div className="mini-scale" role="img" aria-label={timeRange(slot.startsAt, slot.durationMin)}>
      {ticks.map((x) => (
        <span key={x} className="tick" style={{ left: `${pct(x)}%` }}>
          <span>{x}</span>
        </span>
      ))}
      {all.map((s) => (
        <span
          key={s.id}
          className={`seg${s.id === slot.id ? ' current' : ''}${s.type === 'GROUP' ? ' group' : ''}`}
          style={{ left: `${pct(h(s.startsAt))}%`, width: `${pct(h(s.startsAt) + s.durationMin / 60) - pct(h(s.startsAt))}%` }}
        />
      ))}
      {sameDay && nowH >= from && nowH <= to && <span className="now" style={{ left: `${pct(nowH)}%` }} />}
    </div>
  );
}
