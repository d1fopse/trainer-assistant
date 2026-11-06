import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { calendarApi, waitlistApi, type BookingStatus, type TrainerSlot, type WaitlistEntry } from '../api';
import { errorText } from '../errors';
import { useNav } from '../nav';
import { confirmAction, haptic } from '../telegram';
import { fmt, formatDuration, fromIso, isoDate, timeRange } from '../time';
import { InfoRow, Loading, LoadError, Screen, Section, useLoad } from '../ui';
import { ClientSelect, useClientOptions } from './ClientSelect';
import { BookingRow } from './BookingRow';

export function SlotScreen({ id }: { id: number }) {
  const { t, i18n } = useTranslation();
  const nav = useNav();
  const lang = i18n.language;
  const { data: slot, setData, failed, reload } = useLoad(() => calendarApi.slot(id), [id]);
  const clients = useClientOptions();
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

  return (
    <Screen
      title={`${fmt(start, lang, 'ccc, d MMMM')} · ${timeRange(slot.startsAt, slot.durationMin)}`}
      back
      action={
        <button className="small-button secondary" onClick={() => nav.push({ name: 'slotForm', id })}>
          {t('common.edit')}
        </button>
      }
    >
      <Section>
        <InfoRow label={t('slot.type')}>
          {t(`calendar.type.${slot.type}`)}
          {slot.type === 'GROUP' && ` · ${slot.bookedCount}/${slot.capacity}`}
        </InfoRow>
        <InfoRow label={t('slot.duration')}>{formatDuration(slot.durationMin, lang)}</InfoRow>
        {slot.seriesId && <InfoRow label={t('slot.repeat')}>↻ {t('slot.inSeries')}</InfoRow>}
        {slot.note && <InfoRow label={t('slot.note')}>{slot.note}</InfoRow>}
      </Section>

      <Section title={t('slot.participants')}>
        {slot.bookings.length === 0 ? (
          <p className="muted note">{t('calendar.free')}</p>
        ) : (
          slot.bookings.map((b) => (
            <BookingRow
              key={b.id}
              b={b}
              busy={busy}
              onOpenClient={() => nav.push({ name: 'client', id: b.clientId })}
              onMark={(status, deduct) => void markBooking(b.id, status, deduct)}
              onCancel={() => void cancelBooking(b.id, b.name)}
            />
          ))
        )}
      </Section>

      {(slot.waitlist?.length ?? 0) > 0 && (
        <Section title={t('waitlist.title')} hint={t('waitlist.hint')}>
          {slot.waitlist!.map((w, i) => (
            <div key={w.id} className="booking-row">
              <span className="muted small">{i + 1}.</span>
              <button className="link-button" onClick={() => nav.push({ name: 'client', id: w.clientId })}>
                {w.name}
              </button>
              <span className={`status-chip ${w.status === 'NOTIFIED' ? 'ok' : 'muted'}`}>
                {w.status === 'NOTIFIED' ? t('waitlist.notified') : t('waitlist.waiting')}
              </span>
              <span className="spacer" />
              <button className="small-button secondary" disabled={busy} onClick={() => void waitlistAction(() => waitlistApi.notify(w.id))}>
                {t('waitlist.notify')}
              </button>
              <button className="icon-button" aria-label={t('common.delete')} disabled={busy} onClick={() => void waitlistAction(() => waitlistApi.remove(w.id))}>
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
