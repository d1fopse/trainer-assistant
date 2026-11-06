import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, calendarApi, type ClientStatus, type TrainerSlot } from '../api';
import { useNav } from '../nav';
import { fmt, fromIso, isoDate, now, weekStart } from '../time';
import { Loading, LoadError, Screen, Segmented, useLoad } from '../ui';

// Фільтр і пошук запам'ятовуються, поки відкритий додаток (повернення з картки не скидає їх).
let lastFilter: ClientStatus = 'ACTIVE';
let lastQuery = '';

export function Clients() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nav = useNav();
  // Записи цього й наступного тижня — для рейки тижня і «наступного заняття».
  const week = weekStart(now());
  const weekSlots = useLoad<TrainerSlot[]>(
    () => calendarApi.trainerRange(week.toISO()!, week.plus({ days: 14 }).toISO()!),
    [isoDate(week)],
  );
  const activity = buildActivity(weekSlots.data, week);
  const todayIdx = Math.floor(now().diff(week, 'days').days);
  const [filter, setFilter] = useState<ClientStatus>(lastFilter);
  const [query, setQuery] = useState(lastQuery);
  const [debounced, setDebounced] = useState(lastQuery);

  useEffect(() => {
    lastFilter = filter;
    lastQuery = query;
    const h = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(h);
  }, [filter, query]);

  const list = useLoad(() => api.clients({ status: filter, q: debounced || undefined }), [filter, debounced]);
  // Кількість нових заявок — для бейджа на фільтрі.
  const guests = useLoad(() => api.clients({ status: 'GUEST' }), []);
  const guestCount = guests.data?.length ?? 0;

  return (
    <Screen
      title={t('clients.title')}
      action={
        <button className="small-button" onClick={() => nav.push({ name: 'clientForm' })}>
          + {t('clients.add')}
        </button>
      }
    >
      <Segmented<ClientStatus>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'GUEST', label: t('clients.filter.GUEST'), badge: guestCount },
          { value: 'ACTIVE', label: t('clients.filter.ACTIVE') },
          { value: 'INACTIVE', label: t('clients.filter.INACTIVE') },
        ]}
      />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('common.search')}
      />

      {list.failed ? (
        <LoadError onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <p className="muted center-text">{debounced ? t('clients.noResults') : t(`clients.empty.${filter}`)}</p>
      ) : (
        <>
          <div className="card list">
            <div className="list-row compact" aria-hidden>
              <span className="list-main muted tiny">{t('clients.nextSession')}</span>
              <span className="rail-head">
                {(t('calendar.weekdaysShort', { returnObjects: true }) as string[]).map((d) => (
                  <span key={d}>{d.charAt(0)}</span>
                ))}
              </span>
            </div>
            {list.data.map((c) => {
              const a = activity.get(c.id);
              const next = a?.next;
              return (
                <button key={c.id} className="list-row" onClick={() => nav.push({ name: 'client', id: c.id })}>
                  <span className="list-main">
                    <span className="list-title">{c.name}</span>
                    {next ? (
                      <span className="small link-text" style={{ fontWeight: 600 }}>
                        {fmt(fromIso(next), lang, 'ccc HH:mm')}
                      </span>
                    ) : (
                      <span className="muted small">
                        {filter === 'ACTIVE'
                          ? t('clients.notBooked')
                          : [c.phone, c.username ? `@${c.username}` : null].filter(Boolean).join(' · ') || (c.hasTelegram ? 'Telegram' : '')}
                      </span>
                    )}
                    {!c.hasTelegram && (
                      <span className="tiny warn-text" style={{ fontWeight: 700 }}>
                        {t('clients.noTelegram')}
                      </span>
                    )}
                  </span>
                  <span className="stack" style={{ alignItems: 'flex-end', gap: 6 }}>
                    <span className="rail" role="img" aria-label={t('clients.weekRail')}>
                      {Array.from({ length: 7 }, (_, i) => (
                        <span key={i} className={`${a?.days[i] ?? ''}${i === todayIdx ? ' today' : ''}`} />
                      ))}
                    </span>
                    {c.remaining !== null && (
                      <span className={`remaining-badge${c.remaining <= 1 ? ' low' : ''}`} title={t('money.sessionsLeft', { count: c.remaining })}>
                        {t('clients.left', { count: c.remaining })}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="legend">
            <span>
              <i style={{ background: 'var(--green)' }} />
              {t('mark.attended').toLowerCase()}
            </span>
            <span>
              <i style={{ border: '2px solid var(--blue)' }} />
              {t('mark.booked').toLowerCase()}
            </span>
            <span>
              <i style={{ background: 'var(--red)' }} />
              {t('mark.noShow').toLowerCase()}
            </span>
            <span>
              <i style={{ width: 2, borderRadius: 0, background: 'var(--red)' }} />
              {t('calendar.todayShort')}
            </span>
          </div>
        </>
      )}
    </Screen>
  );
}

type Activity = { days: string[]; next: string | null };

/** Для кожного клієнта: позначки по днях цього тижня і найближчий майбутній запис. */
function buildActivity(slots: TrainerSlot[] | null, week: ReturnType<typeof now>) {
  const map = new Map<number, Activity>();
  if (!slots) return map;
  const nowMs = Date.now();
  const weekEnd = week.plus({ days: 7 }).toMillis();
  for (const s of slots) {
    if (s.status !== 'OPEN') continue;
    const at = fromIso(s.startsAt);
    for (const b of s.bookings) {
      if (b.status === 'CANCELLED') continue;
      const a = map.get(b.clientId) ?? { days: Array(7).fill(''), next: null };
      if (at.toMillis() < weekEnd) {
        const i = Math.floor(at.startOf('day').diff(week, 'days').days);
        const mark = b.status === 'ATTENDED' ? 'v' : b.status === 'NO_SHOW' ? 'n' : s.type === 'GROUP' ? 'g' : 'b';
        // Відмітка «прийшов/неявка» важливіша за запис.
        if (i >= 0 && i < 7 && (a.days[i] === '' || mark === 'v' || mark === 'n')) a.days[i] = mark;
      }
      if (b.status === 'BOOKED' && at.toMillis() > nowMs && (!a.next || s.startsAt < a.next)) a.next = s.startsAt;
      map.set(b.clientId, a);
    }
  }
  return map;
}
