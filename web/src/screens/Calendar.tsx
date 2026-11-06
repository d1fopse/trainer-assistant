import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DateTime } from 'luxon';
import { calendarApi, moneyApi, waitlistApi, type PublicSlot, type TrainerSlot } from '../api';
import { Icon } from '../icons';
import { errorText } from '../errors';
import { useNav } from '../nav';
import { confirmAction, haptic, openChat } from '../telegram';
import { fmt, fromIso, isoDate, now, timeRange, weekStart } from '../time';
import { Loading, LoadError, Ring, Screen, useLoad } from '../ui';

// Обраний тиждень і день зберігаються, поки відкритий додаток.
let lastWeek: DateTime | null = null;
let lastDay: string | null = null;

type Props = {
  isTrainer: boolean;
  canWaitlist: boolean;
  awaitingApproval?: boolean;
  /** Показати кільце абонемента (у клієнта є картка). */
  showMyPass?: boolean;
  trainerUsername: string | null;
};

export function Calendar({ isTrainer, canWaitlist, awaitingApproval, showMyPass, trainerUsername }: Props) {
  const { t, i18n } = useTranslation();
  const nav = useNav();
  const lang = i18n.language;
  const today = isoDate(now());
  const [week, setWeek] = useState<DateTime>(lastWeek ?? weekStart(now()));
  const [day, setDay] = useState<string>(lastDay ?? today);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
    setDay(isoDate(w.plus({ days: Math.max(0, days.findIndex((d) => isoDate(d) === day)) })));
  }

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

  const daySlots = byDay.get(day) ?? [];
  const selected = days.find((d) => isoDate(d) === day) ?? days[0]!;

  return (
    <Screen
      title={t('calendar.title')}
      action={
        isTrainer && (
          <button className="small-button" onClick={() => nav.push({ name: 'slotForm', date: day })}>
            + {t('calendar.addSlot')}
          </button>
        )
      }
    >
      {awaitingApproval && <p className="card notice">{t('home.guestWaiting')}</p>}
      {showMyPass && <MyPassHero />}

      <div className="week-nav">
        <button className="icon-button" aria-label={t('calendar.prevWeek')} onClick={() => shiftWeek(-1)}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <button className="link-button week-label" onClick={goToday}>
          {fmt(days[0]!, lang, 'd MMM')} – {fmt(days[6]!, lang, 'd MMM')}
        </button>
        <button className="icon-button" aria-label={t('calendar.nextWeek')} onClick={() => shiftWeek(1)}>
          <Icon name="chevronRight" size={18} />
        </button>
      </div>

      <div className="week-strip">
        {days.map((d) => {
          const k = isoDate(d);
          const count = byDay.get(k)?.length ?? 0;
          return (
            <button
              key={k}
              className={`day${k === day ? ' active' : ''}${k === today ? ' today' : ''}${k < today ? ' past' : ''}`}
              onClick={() => setDay(k)}
            >
              <span className="day-name">{fmt(d, lang, 'ccc')}</span>
              <span className="day-num">{d.day}</span>
              <span className={`day-dot${count ? ' on' : ''}`} />
            </button>
          );
        })}
      </div>

      {isTrainer && data ? (
        <DayHero title={fmt(selected, lang, 'cccc, d MMMM')} slots={daySlots as TrainerSlot[]} />
      ) : (
        <h2 className="day-title">{fmt(selected, lang, 'cccc, d MMMM')}</h2>
      )}

      {failed ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : daySlots.length === 0 ? (
        <p className="muted center-text">{isTrainer ? t('calendar.emptyTrainer') : t('calendar.empty')}</p>
      ) : (
        <div className="stack">
          {daySlots.map((s) =>
            isTrainer ? (
              <TrainerSlotCard key={s.id} slot={s as TrainerSlot} onOpen={() => nav.push({ name: 'slot', id: s.id })} />
            ) : (
              <PublicSlotCard
                key={s.id}
                slot={s as PublicSlot}
                canWaitlist={canWaitlist}
                onChange={(next) => setData((data ?? []).map((x) => (x.id === next.id ? next : x)))}
              />
            ),
          )}
        </div>
      )}

      {isTrainer && (
        <div className="stack">
          <button className="secondary" disabled={copying} onClick={() => void copyWeek()}>
            {t('calendar.copyWeek')}
          </button>
          {notice && <p className="muted small center-text">{notice}</p>}
        </div>
      )}
      {!isTrainer && trainerUsername && (
        <div className="stack contact">
          <p className="muted small center-text">{t('calendar.bookHint')}</p>
          <button onClick={() => openChat(trainerUsername)}>{t('prices.contact')}</button>
        </div>
      )}
    </Screen>
  );
}

function TrainerSlotCard({ slot, onOpen }: { slot: TrainerSlot; onOpen: () => void }) {
  const { t } = useTranslation();
  const free = slot.capacity - slot.bookedCount;
  return (
    <button className={`card slot-card${slot.bookedCount === 0 ? ' free' : slot.type === 'GROUP' ? ' group' : ''}`} onClick={onOpen}>
      <div className="slot-time">
        <span>{timeRange(slot.startsAt, slot.durationMin)}</span>
        {slot.seriesId && (
          <span className="series-icon" title={t('calendar.series')}>
            <Icon name="repeat" size={14} />
          </span>
        )}
      </div>
      <div className="slot-main">
        <span className="muted small">
          {slot.type === 'GROUP'
            ? `${t('calendar.type.GROUP')} · ${slot.bookedCount}/${slot.capacity}`
            : t('calendar.type.INDIVIDUAL')}
        </span>
        {slot.bookings.length === 0 ? (
          <span className="ok-text">{t('calendar.free')}</span>
        ) : (
          <span className="slot-names">
            {slot.bookings.map((b) => (
              <span key={b.id}>
                {b.name}
                {b.isTrial && <span className="tag trial">{t('calendar.trial')}</span>}
              </span>
            ))}
          </span>
        )}
        {slot.type === 'GROUP' && free > 0 && slot.bookings.length > 0 && (
          <span className="muted small">{t('calendar.seatsLeft', { count: free })}</span>
        )}
        {slot.note && <span className="muted small">{slot.note}</span>}
      </div>
      <span className="chevron">
        <Icon name="chevronRight" size={18} />
      </span>
    </button>
  );
}

function PublicSlotCard({
  slot,
  canWaitlist,
  onChange,
}: {
  slot: PublicSlot;
  canWaitlist: boolean;
  onChange: (s: PublicSlot) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const future = new Date(slot.startsAt).getTime() > Date.now();
  // 🔔 — лише клієнтам, на зайнятий майбутній слот, де вони не записані.
  const showBell = canWaitlist && future && !slot.mine && slot.freeSeats === 0;

  async function toggleBell() {
    setBusy(true);
    setError(null);
    try {
      if (slot.waiting) await waitlistApi.leave(slot.id);
      else await waitlistApi.join(slot.id);
      haptic('success');
      onChange({ ...slot, waiting: !slot.waiting });
    } catch (e) {
      setError(errorText(e, t));
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  let label: string;
  let cls: string;
  if (slot.mine) {
    label = t('calendar.mine');
    cls = 'mine';
  } else if (slot.freeSeats === 0) {
    label = t('calendar.busy');
    cls = 'busy';
  } else if (slot.type === 'GROUP') {
    label = t('calendar.seatsOf', { free: slot.freeSeats, total: slot.capacity });
    cls = 'free';
  } else {
    label = t('calendar.free');
    cls = 'free';
  }
  return (
    <div className={`card slot-card public ${cls}`}>
      <div className="slot-time">{timeRange(slot.startsAt, slot.durationMin)}</div>
      <div className="slot-main">
        <span className="muted small">{t(`calendar.type.${slot.type}`)}</span>
        <span className="slot-state">{label}</span>
        {slot.waiting && showBell && <span className="small link-text">{t('waitlist.youAreWaiting')}</span>}
        {error && <span className="error small">{error}</span>}
      </div>
      {showBell && (
        <button
          className={`bell${slot.waiting ? ' on' : ''}`}
          aria-pressed={slot.waiting}
          aria-label={slot.waiting ? t('waitlist.leave') : t('waitlist.join')}
          title={slot.waiting ? t('waitlist.leave') : t('waitlist.join')}
          disabled={busy}
          onClick={() => void toggleBell()}
        >
          <Icon name="bell" size={20} />
        </button>
      )}
    </div>
  );
}

/** Кільце завантаження дня для тренера: зайняті місця з усіх. */
function DayHero({ title, slots }: { title: string; slots: TrainerSlot[] }) {
  const { t } = useTranslation();
  const seats = slots.reduce((n, s) => n + s.capacity, 0);
  const booked = slots.reduce((n, s) => n + s.bookedCount, 0);
  const free = slots.filter((s) => s.bookedCount === 0).length;
  const groups = slots.filter((s) => s.type === 'GROUP').length;
  return (
    <div className="card hero">
      <Ring value={seats ? booked / seats : 0} size={132} stroke={10} label={t('calendar.dayLoad')}>
        <span className="ring-value">
          {booked}
          <small>/{seats}</small>
        </span>
        <span className="ring-caption">{t('calendar.seatsBooked')}</span>
      </Ring>
      <div className="hero-side">
        <h2 className="day-title">{title}</h2>
        <div className="day-stats">
          <div className="hero-stat sky">
            <b>{slots.length}</b>
            <span>{t('calendar.slotsCount', { count: slots.length })}</span>
          </div>
          <div className="hero-stat mint">
            <b>{free}</b>
            <span>{t('calendar.freeSlots', { count: free })}</span>
          </div>
          <div className="hero-stat violet">
            <b>{groups}</b>
            <span>{t('calendar.groupsCount', { count: groups })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Кільце абонемента клієнта + найближче заняття. */
function MyPassHero() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data } = useLoad(() => moneyApi.mySummary(), []);
  if (!data?.summary) return null;
  const total = data.summary.activePasses.reduce((n, p) => n + p.totalSessions, 0);
  const left = data.summary.remaining;
  const next = data.upcoming[0];
  return (
    <div className="card hero">
      <Ring value={total ? left / total : 0} size={132} stroke={10} tone={total && left <= 1 ? 'amber' : 'flow'} label={t('money.pass')}>
        <span className="ring-value">
          {left}
          {total > 0 && <small>/{total}</small>}
        </span>
        <span className="ring-caption">{t('money.sessionsLeft', { count: left })}</span>
      </Ring>
      <div className="hero-side">
        <div className="hero-stat sky">
          <span>{t('money.upcoming')}</span>
          {next ? (
            <b>
              {fmt(fromIso(next.startsAt), lang, 'ccc d MMM')}, {fromIso(next.startsAt).toFormat('HH:mm')}
            </b>
          ) : (
            <span className="muted">{t('money.noUpcomingShort')}</span>
          )}
        </div>
        <div className="hero-stat mint">
          <span>{t('money.myHistory')}</span>
          <b>{data.summary.attended}</b>
        </div>
      </div>
    </div>
  );
}
