import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ClientStatus } from '../api';
import { useNav } from '../nav';
import { Loading, LoadError, Screen, Segmented, useLoad } from '../ui';

// Фільтр і пошук запам'ятовуються, поки відкритий додаток (повернення з картки не скидає їх).
let lastFilter: ClientStatus = 'ACTIVE';
let lastQuery = '';

export function Clients() {
  const { t } = useTranslation();
  const nav = useNav();
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
        <div className="card list">
          {list.data.map((c) => (
            <button key={c.id} className="list-row" onClick={() => nav.push({ name: 'client', id: c.id })}>
              <span className="avatar" aria-hidden>
                {c.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="list-main">
                <span className="list-title">{c.name}</span>
                <span className="muted small">
                  {[c.phone, c.username ? `@${c.username}` : null].filter(Boolean).join(' · ') ||
                    (c.hasTelegram ? 'Telegram' : '')}
                  {!c.hasTelegram && <span className="tag">{t('clients.noTelegram')}</span>}
                </span>
              </span>
              {c.remaining !== null && (
                <span className={`remaining-badge${c.remaining <= 1 ? ' low' : ''}`} title={t('money.sessionsLeft', { count: c.remaining })}>
                  {c.remaining}
                </span>
              )}
              <span className="chevron" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>
      )}
    </Screen>
  );
}
