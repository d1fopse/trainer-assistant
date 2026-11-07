import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DateTime } from 'luxon';
import { calendarApi, waitlistApi, type PublicSlot, type TrainerSlot } from '../api';
import { Icon } from '../icons';
import { errorText, withOverlapConfirm } from '../errors';
import { useNav } from '../nav';
import { confirmAction, haptic, hapticImpact, openChat } from '../telegram';
import { fmt, fromIso, isoDate, now, timeRange, toIso, weekStart } from '../time';
import { Loading, LoadError, Screen, Stat, TimedNotice, useLoad } from '../ui';
import { DayScale, Seats, type ScaleItem } from './DayScale';

/** Скільки днів уперед бачать клієнти й гості (як PUBLIC_DAYS_AHEAD на сервері). */
const PUBLIC_DAYS_AHEAD = 28;
const lastVisibleDay = () => isoDate(now().plus({ days: PUBLIC_DAYS_AHEAD }));

// Обраний тиждень і день зберігаються, поки відкритий додаток.
let lastWeek: DateTime | null = null;
let lastDay: string | null = null;

type Props = {
  isTrainer: boolean;
  canWaitlist: boolean;
  awaitingApproval?: boolean;
  trainerUsername: string | null;
};

export function Calendar({ isTrainer, canWaitlist, awaitingApproval, trainerUsername }: Props) {
  const { t, i18n } = useTranslation();
  const nav = useNav();
  const lang = i18n.language;
  const today = isoDate(now());
  const [week, setWeek] = useState<DateTime>(() =>
    lastWeek && (isTrainer || (isoDate(lastWeek) >= isoDate(weekStart(now())) && isoDate(lastWeek) <= lastVisibleDay())) ? lastWeek : weekStart(now()),
  );
  const [day, setDay] = useState<string>(() => (lastDay && (isTrainer || (lastDay >= today && lastDay <= lastVisibleDay())) ? lastDay : today));
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bellError, setBellError] = useState<string | null>(null);
  const [bellBusy, setBellBusy] = useState<number | null>(null);
  lastWeek = week;
  lastDay = day;

  const from = week.toISO()!;
  const to = week.plus({ days: 7 }).toISO()!;
  const { data, setData, failed, reload } = useLoad<(TrainerSlot | PublicSlot)[]>(
    () => (isTrainer ? calendarApi.trainerRange(from, to) : calendarApi.publicRange(from, to)),
    [from, isTrainer],
  );

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => week.plus({ days: i })), [week]);
  const byDay = useMemo(() => {
    const m = new Map<string, (TrainerSlot | PublicSlot)[]>();
    for (const s of data ?? []) {
      const k = isoDate(fromIso(s.startsAt));
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [data]);

  function shiftWeek(n: number) {
    const w = week.plus({ weeks: n });
    setWeek(w);
    // Переходимо на той самий день тижня.
    const next = isoDate(w.plus({ days: Math.max(0, days.findIndex((d) => isoDate(d) === day)) }));
    // Клієнти й гості не бачать минулих днів.
    setDay(!isTrainer && next < today ? today : !isTrainer && next > lastVisibleDay() ? lastVisibleDay() : next);
  }

  const atCurrentWeek = isoDate(week) <= isoDate(weekStart(now()));
  // Клієнти й гості бачать лише 4 тижні вперед (сьогодні + 28 днів; так само обмежує сервер).
  const horizon = lastVisibleDay();
  const atLastWeek = isoDate(week.plus({ weeks: 1 })) > horizon;

  function goToday() {
    setWeek(weekStart(now()));
    setDay(today);
  }

  async function copyWeek() {
    const target = week.plus({ weeks: 1 });
    if (!(await confirmAction(t('calendar.copyConfirm', { date: fmt(target, lang, 'd MMMM') })))) return;
    setCopying(true);
    setNotice(null);
    try {
      const r = await calendarApi.copyWeek(isoDate(week), isoDate(target));
      haptic('success');
      setNotice(t('calendar.copyDone', { created: r.created, skipped: r.skipped.length }));
    } catch {
      haptic('error');
      setNotice(t('errors.save'));
    } finally {
      setCopying(false);
    }
  }

  // Утримання пальця на порожньому місці шкали — індивідуальний слот на годину.
  const [pending, setPending] = useState<number | null>(null);
  const [quickNote, setQuickNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setQuickNote(null), [day]);
  async function quickCreate(hour: number) {
    if (pending !== null) return;
    const time = `${String(Math.floor(hour)).padStart(2, '0')}:${hour % 1 ? '30' : '00'}`;
    setPending(hour);
    setQuickNote(null);
    hapticImpact();
    try {
      const slot = await withOverlapConfirm(t, (force) =>
        calendarApi.createSlot({ startsAt: toIso(day, time), durationMin: 60, type: 'INDIVIDUAL', clientIds: [], force }),
      );
      if (slot) {
        haptic('success');
        setData([...(data ?? []), slot]);
        setQuickNote({ ok: true, text: t('calendar.quickCreated', { time: timeRange(slot.startsAt, slot.durationMin) }) });
      }
    } catch (e) {
      haptic('error');
      setQuickNote({ ok: false, text: errorText(e, t) });
    } finally {
      setPending(null);
    }
  }

  async function toggleBell(slot: PublicSlot) {
    setBellBusy(slot.id);
    setBellError(null);
    try {
      if (slot.waiting) await waitlistApi.leave(slot.id);
      else await waitlistApi.join(slot.id);
      haptic('success');
      setData((data ?? []).map((x) => (x.id === slot.id ? { ...slot, waiting: !slot.waiting } : x)));
    } catch (e) {
      setBellError(errorText(e, t));
      haptic('error');
    } finally {
      setBellBusy(null);
    }
  }

  const daySlots = byDay.get(day) ?? [];
  const selected = days.find((d) => isoDate(d) === day) ?? days[0]!;
  const items = isTrainer
    ? (daySlots as TrainerSlot[]).map((s) => trainerItem(s, t, () => nav.push({ name: 'slot', id: s.id })))
    : (daySlots as PublicSlot[]).map((s) => publicItem(s, t, canWaitlist, bellBusy === s.id, () => void toggleBell(s)));

  return (
    <Screen
      title={fmt(selected, lang, 'ccc, d MMMM')}
      action={
        isTrainer && (
          <button className="small-button" onClick={() => nav.push({ name: 'slotForm', date: day })}>
            + {t('calendar.addSlot')}
          </button>
        )
      }
    >
      {awaitingApproval && <TimedNotice id="guestWaiting">{t('home.guestWaiting')}</TimedNotice>}

      <div className="week-nav">
        <button
          className="icon-button sm"
          aria-label={t('calendar.prevWeek')}
          disabled={!isTrainer && atCurrentWeek}
          onClick={() => shiftWeek(-1)}
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <button className="link-button week-label" onClick={goToday}>
          {fmt(days[0]!, lang, 'd MMM')} – {fmt(days[6]!, lang, 'd MMM')}
          {isoDate(week) !== isoDate(weekStart(now())) && ` · ${t('calendar.today')}`}
        </button>
        <button
          className="icon-button sm"
          aria-label={t('calendar.nextWeek')}
          disabled={!isTrainer && atLastWeek}
          onClick={() => shiftWeek(1)}
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </div>

      <div className="week-strip">
        {days.map((d) => {
          const k = isoDate(d);
          const count = byDay.get(k)?.length ?? 0;
          return (
            <button
              key={k}
              aria-current={k === today ? 'date' : undefined}
              aria-pressed={k === day}
              className={`day${k === day ? ' active' : ''}${k === today ? ' today' : ''}${k < today ? ' past' : ''}`}
              disabled={!isTrainer && (k < today || k > horizon)}
              onClick={() => setDay(k)}
            >
              <span className="day-name">{fmt(d, lang, 'ccc')}</span>
              <span className="day-num">{d.day}</span>
              <span className={`day-dot${count ? ' on' : ''}`} />
            </button>
          );
        })}
      </div>

      {isTrainer && data && <DayStats slots={daySlots as TrainerSlot[]} />}

      {failed ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : isTrainer ? (
        <>
          <DayScale
            items={items}
            isToday={day === today}
            nowLabel={t('calendar.now', { time: now().toFormat('HH:mm') })}
            minRange={[7, 22]}
            onLongPress={(h) => void quickCreate(h)}
            pending={pending}
            pendingLabel={t('calendar.quickCreating')}
            pressHint={t('calendar.quickHold')}
          />
          {quickNote ? (
            <p className={`small ${quickNote.ok ? 'ok-text' : 'error'}`} style={{ padding: '0 4px' }} role="status">
              {quickNote.text}
            </p>
          ) : (
            <p className="muted tiny" style={{ padding: '0 4px' }}>
              {items.length === 0 ? `${t('calendar.emptyTrainer')} ` : ''}
              {t('calendar.quickHint')}
            </p>
          )}
        </>
      ) : items.length === 0 ? (
        <p className="card muted center-text">{t('calendar.empty')}</p>
      ) : (
        <DayScale items={items} isToday={day === today} nowLabel={t('calendar.now', { time: now().toFormat('HH:mm') })} />
      )}

      {bellError && <p className="error small">{bellError}</p>}

      {isTrainer && (
        <div className="stack">
          <button className="secondary" disabled={copying} onClick={() => void copyWeek()}>
            {t('calendar.copyWeek')}
          </button>
          {notice && <p className="muted small center-text">{notice}</p>}
        </div>
      )}
      {!isTrainer && (
        <div className="stack contact">
          {canWaitlist && <p className="muted small">{t('calendar.bellHint')}</p>}
          {trainerUsername && (
            <>
              <p className="muted small">{t('calendar.bookHint')}</p>
              <button onClick={() => openChat(trainerUsername)}>{t('prices.contact')}</button>
            </>
          )}
        </div>
      )}
    </Screen>
  );
}

type T = (k: string, o?: Record<string, unknown>) => string;

function trainerItem(s: TrainerSlot, t: T, onClick: () => void): ScaleItem {
  const time = timeRange(s.startsAt, s.durationMin);
  const names = s.bookings.map((b) => b.name).join(', ');
  const trial = s.bookings.some((b) => b.isTrial);
  const series = s.seriesId ? ' · ↻' : '';
  if (s.bookings.length === 0) {
    return {
      id: s.id,
      startsAt: s.startsAt,
      durationMin: s.durationMin,
      kind: 'free',
      title: s.type === 'GROUP' ? `${t('calendar.type.GROUP')} · ${t('calendar.free').toLowerCase()}` : t('calendar.freeWindow'),
      meta: `${time}${series}`,
      extra: s.type === 'GROUP' ? <Seats booked={0} capacity={s.capacity} /> : undefined,
      onClick,
      label: `${time} ${t('calendar.freeWindow')}`,
    };
  }
  if (s.type === 'GROUP') {
    return {
      id: s.id,
      startsAt: s.startsAt,
      durationMin: s.durationMin,
      kind: 'group',
      title: s.note || t('calendar.type.GROUP'),
      meta: `${time} · ${s.bookedCount}/${s.capacity}${series}`,
      extra: (
        <>
          <span className="block-meta">{names}</span>
          <Seats booked={s.bookedCount} capacity={s.capacity} />
        </>
      ),
      onClick,
      label: `${time} ${t('calendar.type.GROUP')} ${s.bookedCount}/${s.capacity}: ${names}`,
    };
  }
  return {
    id: s.id,
    startsAt: s.startsAt,
    durationMin: s.durationMin,
    kind: 'indiv',
    title: (
      <>
        {names}
        {trial && <span className="tag trial">{t('calendar.trial')}</span>}
      </>
    ),
    meta: `${time}${series}`,
    extra: s.note ? <span className="block-meta">{s.note}</span> : undefined,
    onClick,
    label: `${time} ${names}`,
  };
}

function publicItem(s: PublicSlot, t: T, canWaitlist: boolean, busy: boolean, onBell: () => void): ScaleItem {
  const time = timeRange(s.startsAt, s.durationMin);
  const future = new Date(s.startsAt).getTime() > Date.now();
  // 🔔 — лише клієнтам, на зайнятий майбутній слот, де вони не записані.
  const showBell = canWaitlist && future && !s.mine && s.freeSeats === 0;
  const base = { id: s.id, startsAt: s.startsAt, durationMin: s.durationMin };
  if (s.mine) {
    return {
      ...base,
      kind: 'mine',
      title: t('calendar.mine'),
      meta: `${time} · ${t(`calendar.type.${s.type}`).toLowerCase()}`,
      label: `${time} ${t('calendar.mine')}`,
    };
  }
  if (s.freeSeats === 0) {
    return {
      ...base,
      kind: 'busy',
      title: t('calendar.busy'),
      meta: s.waiting && showBell ? `${time} · ${t('waitlist.inQueue')}` : time,
      side: showBell ? (
        <button
          className={`bell${s.waiting ? ' on' : ''}`}
          aria-pressed={s.waiting}
          aria-label={s.waiting ? t('waitlist.leave') : t('waitlist.join')}
          title={s.waiting ? t('waitlist.leave') : t('waitlist.join')}
          disabled={busy}
          onClick={onBell}
        >
          <Icon name="bell" size={18} />
        </button>
      ) : undefined,
      label: `${time} ${t('calendar.busy')}`,
    };
  }
  if (s.type === 'GROUP') {
    return {
      ...base,
      kind: 'group',
      title: t('calendar.type.GROUP'),
      meta: `${time} · ${t('calendar.seatsOf', { free: s.freeSeats, total: s.capacity })}`,
      extra: <Seats booked={s.capacity - s.freeSeats} capacity={s.capacity} />,
      label: `${time} ${t('calendar.type.GROUP')}`,
    };
  }
  return { ...base, kind: 'free', title: t('calendar.free'), meta: time, label: `${time} ${t('calendar.free')}` };
}

/** Зведення дня для тренера: зайняті місця, вільні слоти, що відмітити. */
function DayStats({ slots }: { slots: TrainerSlot[] }) {
  const { t } = useTranslation();
  const seats = slots.reduce((n, s) => n + s.capacity, 0);
  const booked = slots.reduce((n, s) => n + s.bookedCount, 0);
  const free = slots.filter((s) => s.bookedCount === 0).length;
  const nowMs = Date.now();
  const toMark = slots
    .filter((s) => new Date(s.startsAt).getTime() + s.durationMin * 60000 < nowMs)
    .reduce((n, s) => n + s.bookings.filter((b) => b.status === 'BOOKED').length, 0);
  return (
    <div className="tiles">
      <Stat
        label={t('calendar.booked')}
        value={
          <>
            {booked}
            <small>/{seats}</small>
          </>
        }
      />
      <Stat label={t('calendar.freeSlotsLabel')} value={free} tone={free ? 'green' : undefined} />
      <Stat label={t('calendar.toMark')} value={toMark} tone={toMark ? 'yellow' : undefined} />
    </div>
  );
}
