import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { calendarApi } from '../api';
import { errorText } from '../errors';
import { useNav } from '../nav';
import { haptic } from '../telegram';
import { fmt, fromIso } from '../time';
import { Loading, Screen } from '../ui';
import { DurationSelect, WeekdayPicker } from './SlotForm';

/** «Змінити це й наступні»: нові день(і), час і тривалість серії, починаючи з дати. */
export function SeriesForm({ seriesId, fromDate }: { seriesId: number; fromDate: string }) {
  const { t, i18n } = useTranslation();
  const nav = useNav();
  const [form, setForm] = useState<{ weekdays: number[]; time: string; durationMin: number; endDate: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Серію створено, але частину дат пропущено — показуємо підсумок і кнопку «Готово».
  const [doneNote, setDoneNote] = useState<string | null>(null);

  useEffect(() => {
    void calendarApi.series(seriesId).then((s) =>
      setForm({
        weekdays: s.weekdays,
        time: s.startTime,
        durationMin: s.durationMin,
        endDate: s.endDate < fromDate ? fromDate : s.endDate,
      }),
    );
  }, [seriesId, fromDate]);

  if (!form) {
    return (
      <Screen title={t('slot.editSeries')} back>
        <Loading />
      </Screen>
    );
  }

  const canSave = form.weekdays.length > 0 && form.time !== '' && form.endDate >= fromDate && !busy;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (doneNote) {
      nav.pop();
      nav.pop();
      return;
    }
    if (!form || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const r = await calendarApi.splitSeries(seriesId, {
        fromDate,
        weekdays: form.weekdays,
        startTime: form.time,
        durationMin: form.durationMin,
        endDate: form.endDate,
      });
      haptic('success');
      if (r.skipped.length) {
        setDoneNote(t('slot.seriesSkipped', { created: r.created, dates: r.skipped.join(', ') }));
        return;
      }
      // Повертаємось до календаря: старий слот уже скасовано.
      nav.pop();
      nav.pop();
    } catch (err) {
      setError(errorText(err, t));
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t('slot.editSeries')} back>
      <p className="muted">{t('slot.editSeriesHint', { date: fmt(fromIso(`${fromDate}T12:00:00`), i18n.language, 'd MMMM') })}</p>
      <form className="stack" onSubmit={save}>
        <label>
          {t('slot.weekdays')}
          <WeekdayPicker value={form.weekdays} onChange={(v) => setForm({ ...form, weekdays: v })} />
        </label>
        <div className="row-2">
          <label>
            {t('slot.time')}
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </label>
          <label>
            {t('slot.duration')}
            <DurationSelect value={form.durationMin} onChange={(v) => setForm({ ...form, durationMin: v })} />
          </label>
        </div>
        <label>
          {t('slot.until')}
          <input
            type="date"
            value={form.endDate}
            min={fromDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
        </label>
        {error && <p className="error">{error}</p>}
        {doneNote && <p className="warn-text">{doneNote}</p>}
        <button type="submit" disabled={!doneNote && !canSave}>
          {doneNote ? t('common.done') : t('common.save')}
        </button>
      </form>
    </Screen>
  );
}
