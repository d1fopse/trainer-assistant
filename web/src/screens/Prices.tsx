import { useTranslation } from 'react-i18next';
import { api, type Price } from '../api';
import { useNav } from '../nav';
import { openChat } from '../telegram';
import { Loading, LoadError, Screen, formatUah, useLoad } from '../ui';

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
      title={t('prices.title')}
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
        <p className="muted center-text">{isTrainer ? t('prices.emptyTrainer') : t('prices.empty')}</p>
      ) : (
        <div className="stack">
          {data.map((p, i) => {
            const { title, description } = localized(p, lang);
            const perSession =
              p.kind === 'PASS' && p.sessionsCount ? Math.round(p.priceUah / p.sessionsCount) : null;
            const body = (
              <>
                <div className="price-top">
                  <div>
                    <div className="price-title">{title}</div>
                    <div className="muted small">
                      {p.kind === 'PASS' && p.sessionsCount
                        ? `${t('prices.kind.PASS')} · ${t('prices.sessions', { count: p.sessionsCount })}`
                        : t('prices.kind.SINGLE')}
                    </div>
                  </div>
                  <div className="price-amount">{t('common.uah', { value: formatUah(p.priceUah, lang) })}</div>
                </div>
                {description && <p className="price-desc">{description}</p>}
                {perSession !== null && (
                  <div className="muted small">{t('prices.perSession', { value: formatUah(perSession, lang) })}</div>
                )}
                {!p.isVisible && <span className="badge warn">{t('prices.hidden')}</span>}
              </>
            );

            return isTrainer ? (
              <div key={p.id} className={`card price${p.isVisible ? '' : ' faded'}`}>
                <button className="card-button" onClick={() => nav.push({ name: 'priceForm', id: p.id })}>
                  {body}
                </button>
                <div className="reorder">
                  <button
                    className="icon-button"
                    aria-label={t('prices.moveUp')}
                    disabled={i === 0}
                    onClick={() => void move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t('prices.moveDown')}
                    disabled={i === data.length - 1}
                    onClick={() => void move(i, 1)}
                  >
                    ↓
                  </button>
                </div>
              </div>
            ) : (
              <div key={p.id} className="card price">
                <div className="card-button">{body}</div>
              </div>
            );
          })}
        </div>
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
