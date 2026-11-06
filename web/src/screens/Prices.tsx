import { useTranslation } from 'react-i18next';
import { api, moneyApi, type Price } from '../api';
import { useNav } from '../nav';
import { openChat } from '../telegram';
import { fmt, fromIso } from '../time';
import { Chip, Loading, LoadError, PassLine, Screen, Section, formatUah, useLoad } from '../ui';

export function localized(p: Price, lang: string) {
  const ru = lang === 'ru';
  return {
    title: (ru && p.titleRu) || p.titleUk,
    description: (ru && p.descriptionRu) || p.descriptionUk,
  };
}

export function Prices({ isTrainer, trainerUsername }: { isTrainer: boolean; trainerUsername: string | null }) {
  const { t, i18n } = useTranslation();
  const nav = useNav();
  const { data, setData, failed, reload } = useLoad(() => api.prices(), []);
  const lang = i18n.language;

  async function move(index: number, dir: -1 | 1) {
    if (!data) return;
    const next = [...data];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item!);
    setData(next); // оптимістично
    try {
      setData(await api.reorderPrices(next.map((p) => p.id)));
    } catch {
      void reload();
    }
  }

  return (
    <Screen
      title={t('tabs.prices')}
      action={
        isTrainer && (
          <button className="small-button" onClick={() => nav.push({ name: 'priceForm' })}>
            + {t('prices.add')}
          </button>
        )
      }
    >
      {failed ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="card muted center-text">{isTrainer ? t('prices.emptyTrainer') : t('prices.empty')}</p>
      ) : (
        <>
          {!isTrainer && <MyPassTile />}
          {(['SINGLE', 'PASS'] as const).map((kind) => {
            const group = data.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === kind);
            if (group.length === 0) return null;
            // Найдешевше заняття серед абонементів — позначка «вигідно».
            const per = (p: Price) => (p.sessionsCount ? p.priceUah / p.sessionsCount : p.priceUah);
            const best = kind === 'PASS' && group.length > 1 ? group.reduce((a, b) => (per(b.p) < per(a.p) ? b : a)).p.id : null;
            const maxSingle = Math.max(...group.map(({ p }) => p.priceUah));
            return (
              <Section key={kind} title={t(`prices.group.${kind}`)} hint={kind === 'PASS' ? t('prices.dotsHint') : undefined}>
                {group.map(({ p, i }) => {
                  const { title, description } = localized(p, lang);
                  const perSession = kind === 'PASS' && p.sessionsCount ? Math.round(p.priceUah / p.sessionsCount) : null;
                  const body = (
                    <>
                      <span className="price-top">
                        <span className="price-title">
                          {title}
                          {!p.isVisible && <Chip>{t('prices.hidden')}</Chip>}
                          {p.id === best && <Chip tone="green">{t('prices.best')}</Chip>}
                        </span>
                        <span className="price-amount">{t('common.uah', { value: formatUah(p.priceUah, lang) })}</span>
                      </span>
                      {description && <span className="price-desc">{description}</span>}
                      {kind === 'PASS' && p.sessionsCount ? (
                        <>
                          <span className="dots" aria-hidden>
                            {Array.from({ length: Math.min(p.sessionsCount, 30) }, (_, k) => (
                              <span key={k} />
                            ))}
                          </span>
                          <span className="price-meta">
                            <span>{t('prices.sessions', { count: p.sessionsCount })}</span>
                            {perSession !== null && <b>{t('prices.perSession', { value: formatUah(perSession, lang) })}</b>}
                          </span>
                        </>
                      ) : group.length < 2 ? null : (
                        <span className="price-bar" aria-hidden>
                          <i style={{ width: `${(p.priceUah / maxSingle) * 100}%` }} />
                        </span>
                      )}
                    </>
                  );
                  return isTrainer ? (
                    <div key={p.id} className={`price-row${p.isVisible ? '' : ' faded'}`}>
                      <button className="price-body" onClick={() => nav.push({ name: 'priceForm', id: p.id })}>
                        {body}
                      </button>
                      <div className="reorder">
                        <button className="icon-button sm" aria-label={t('prices.moveUp')} disabled={i === 0} onClick={() => void move(i, -1)}>
                          ↑
                        </button>
                        <button
                          className="icon-button sm"
                          aria-label={t('prices.moveDown')}
                          disabled={i === data.length - 1}
                          onClick={() => void move(i, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={p.id} className="price-row">
                      <div className="price-body">{body}</div>
                    </div>
                  );
                })}
              </Section>
            );
          })}
          {isTrainer && <p className="muted tiny" style={{ padding: '0 4px' }}>{t('prices.trainerHint')}</p>}
        </>
      )}

      {!isTrainer && trainerUsername && (
        <div className="stack contact">
          <p className="muted small center-text">{t('prices.contactHint')}</p>
          <button onClick={() => openChat(trainerUsername)}>{t('prices.contact')}</button>
        </div>
      )}
    </Screen>
  );
}

/** Абонемент клієнта зверху сторінки цін: скільки лишилось і до коли. */
function MyPassTile() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data } = useLoad(() => moneyApi.mySummary(), []);
  const s = data?.summary;
  if (!s || s.activePasses.length === 0) return null;
  const pass = [...s.activePasses].sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'))[0]!;
  const start = pass.purchasedAt;
  const daysLeft = pass.expiresAt ? Math.max(0, Math.ceil((new Date(`${pass.expiresAt}T23:59`).getTime() - Date.now()) / 86400000)) : null;
  const perWeek = daysLeft ? Math.ceil((pass.remaining / Math.max(daysLeft, 1)) * 7) : null;
  return (
    <div className="card stack">
      <div className="price-top">
        <span className="muted small">{t('money.yourPass', { count: pass.totalSessions })}</span>
        <span className="muted tiny">
          {pass.expiresAt ? t('money.daysLeft', { count: daysLeft ?? 0 }) : t('money.noExpiry')}
        </span>
      </div>
      <span className="big-number" style={{ fontSize: 30 }}>
        {pass.remaining} <span className="muted small">{t('money.sessionsLeft', { count: pass.remaining })}</span>
      </span>
      <PassLine
        start={start}
        end={pass.expiresAt}
        total={pass.totalSessions}
        remaining={pass.remaining}
        marks={[
          ...data!.history.filter((h) => h.startsAt >= `${start}T00`).map((h) => ({ at: h.startsAt, kind: (h.status === 'NO_SHOW' ? 'n' : 'v') as 'v' | 'n' })),
          ...data!.upcoming.map((u) => ({ at: u.startsAt, kind: 'b' as const })),
        ]}
        lang={lang}
      />
      {perWeek !== null && pass.remaining > 0 && <span className="muted tiny">{t('money.paceHint', { count: perWeek })}</span>}
      {pass.expiresAt && <span className="faint tiny">{t('money.until', { date: fmt(fromIso(`${pass.expiresAt}T12:00`), lang, 'd MMMM') })}</span>}
    </div>
  );
}
