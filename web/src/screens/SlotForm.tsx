import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { calendarApi, type SlotType } from '../api';
import { errorText, withOverlapConfirm } from '../errors';
import { useNav } from '../nav';
import { haptic } from '../telegram';
import { fromIso, isoDate, now, toIso } from '../time';
import { Loading, Screen, Segmented } from '../ui';
import { ClientSelect, useClientOptions } from './ClientSelect';

export const DURATIONS = [30, 45, 60, 75, 90, 120];

type Form = {
  date: string;
  time: string;
  durationMin: number;
  type: SlotType;
  capacity: string;
  note: string;
  clientId: string;
  isTrial: boolean;
  repeat: boolean;
  weekdays: number[];
  endDate: string;
};

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const { t } = useTranslation();
  const names = t('calendar.weekdaysShort', { returnObjects: true }) as string[];
  return (
    <div className="weekday-picker">
      {[1, 2, 3, 4, 5, 6, 7].map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            className={on ? 'active' : ''}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
          >
            {names[d - 1]}
          </button>
        );
      })}
    </div>
  );
}

export function DurationSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation();
  const opts = DURATIONS.includes(value) ? DURATIONS : [...DURATIONS, value].sort((a, b) => a - b);
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {opts.map((d) => (
        <option key={d} value={d}>
          {t('slot.minutes', { count: d })}
        </option>
      ))}
    </select>
  );
}

export function SlotForm({ id, date }: { id?: number; date?: string }) {
  const { t } = useTranslation();
  const nav = useNav();
  const clients = useClientOptions();
  const start = date ?? isoDate(now());
  const [form, setForm] = useState<Form | null>(
    id
      ? null
      : {
          date: start,
          time: '18:00',
          durationMin: 60,
          type: 'INDIVIDUAL',
          capacity: '6',
          note: '',
          clientId: '',
          isTrial: false,
          repeat: false,
          weekdays: [fromIso(`${start}T12:00:00`).weekday],
          endDate: fromIso(`${start}T12:00:00`).plus({ weeks: 8 }).toISODate()!,
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Серію створено, але частину дат пропущено — показуємо підсумок і кнопку «Готово».
  const [doneNote, setDoneNote] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void calendarApi.slot(id).then((s) => {
      const st = fromIso(s.startsAt);
      setForm({
        date: isoDate(st),
        time: st.toFormat('HH:mm'),
        durationMin: s.durationMin,
        type: s.type,
        capacity: String(s.capacity),
        note: s.note ?? '',
        clientId: '',
        isTrial: false,
        repeat: false,
        weekdays: [],
        endDate: '',
      });
    });
  }, [id]);

  if (!form) {
    return (
      <Screen title={t('slot.edit')} back>
        <Loading />
      </Screen>
    );
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const capacity = Number(form.capacity);
  const groupOk = form.type === 'INDIVIDUAL' || (Number.isInteger(capacity) && capacity >= 2 && capacity <= 100);
  const canRepeat = !id && form.type === 'INDIVIDUAL' && form.clientId !== '';
  const repeat = canRepeat && form.repeat;
  const repeatOk = !repeat || (form.weekdays.length > 0 && form.endDate >= form.date);
  const canSave = form.date !== '' && form.time !== '' && groupOk && repeatOk && !busy;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (doneNote) {
      nav.pop();
      return;
    }
    if (!form || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      if (id) {
        const r = await withOverlapConfirm(t, (force) =>
          calendarApi.updateSlot(id, {
            startsAt: toIso(form.date, form.time),
            durationMin: form.durationMin,
            ...(form.type === 'GROUP' ? { capacity } : {}),
            note: form.note.trim() || null,
            force,
          }),
        );
        if (!r) return;
        haptic('success');
        nav.pop();
      } else if (repeat) {
        const r = await calendarApi.createSeries({
          clientId: Number(form.clientId),
          weekdays: form.weekdays,
          startTime: form.time,
          durationMin: form.durationMin,
          startDate: form.date,
          endDate: form.endDate,
        });
        haptic('success');
        if (r.skipped.length) {
          setDoneNote(t('slot.seriesSkipped', { created: r.created, dates: r.skipped.join(', ') }));
          setBusy(false);
          return;
        }
        nav.pop();
      } else {
        const r = await withOverlapConfirm(t, (force) =>
          calendarApi.createSlot({
            startsAt: toIso(form.date, form.time),
            durationMin: form.durationMin,
            type: form.type,
            ...(form.type === 'GROUP' ? { capacity } : {}),
            note: form.note.trim() || undefined,
            clientIds: form.clientId ? [Number(form.clientId)] : [],
            isTrial: form.type === 'INDIVIDUAL' && form.clientId !== '' && form.isTrial,
            force,
          }),
        );
        if (!r) return;
        haptic('success');
        nav.replace({ name: 'slot', id: r.id });
      }
    } catch (err) {
      setError(errorText(err, t));
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={id ? t('slot.edit') : t('slot.new')} back>
      <form className="stack" onSubmit={save}>
        {!id && (
          <label>
            {t('slot.type')}
            <Segmented<SlotType>
              value={form.type}
              onChange={(v) => set('type', v)}
              options={[
                { value: 'INDIVIDUAL', label: t('calendar.type.INDIVIDUAL') },
                { value: 'GROUP', label: t('calendar.type.GROUP') },
              ]}
            />
          </label>
        )}

        <div className="row-2">
          <label>
            {t('slot.date')}
            <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required />
          </label>
          <label>
            {t('slot.time')}
            <input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} required />
          </label>
        </div>

        <div className="row-2">
          <label>
            {t('slot.duration')}
            <DurationSelect value={form.durationMin} onChange={(v) => set('durationMin', v)} />
          </label>
          {form.type === 'GROUP' && (
            <label>
              {t('slot.capacity')}
              <input
                inputMode="numeric"
                value={form.capacity}
                onChange={(e) => set('capacity', e.target.value.replace(/\D/g, ''))}
              />
            </label>
          )}
        </div>

        {!id && (
          <label>
            {form.type === 'GROUP' ? t('slot.firstParticipant') : t('slot.client')}
            <ClientSelect
              value={form.clientId}
              onChange={(v) => set('clientId', v)}
              options={clients.data}
              emptyLabel={t('slot.noClient')}
            />
          </label>
        )}

        {!id && form.type === 'INDIVIDUAL' && form.clientId && (
          <label className="check">
            <input type="checkbox" checked={form.isTrial} onChange={(e) => set('isTrial', e.target.checked)} />
            <span>{t('slot.trial')}</span>
          </label>
        )}

        {canRepeat && (
          <label className="check">
            <input type="checkbox" checked={form.repeat} onChange={(e) => set('repeat', e.target.checked)} />
            <span>{t('slot.repeatWeekly')}</span>
          </label>
        )}

        {repeat && (
          <>
            <label>
              {t('slot.weekdays')}
              <WeekdayPicker value={form.weekdays} onChange={(v) => set('weekdays', v)} />
            </label>
            <label>
              {t('slot.until')}
              <input type="date" value={form.endDate} min={form.date} onChange={(e) => set('endDate', e.target.value)} />
            </label>
          </>
        )}

        <label>
          {t('slot.note')}
          <input value={form.note} onChange={(e) => set('note', e.target.value)} maxLength={500} />
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
