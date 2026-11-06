import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ClientListItem } from '../api';
import { useNav } from '../nav';
import { confirmAction, haptic } from '../telegram';
import { Loading, LoadError, Screen, useLoad } from '../ui';

/**
 * Вибір картки для об'єднання.
 * guestFor  — до ручної картки (clientId) прив'язуємо анкету гостя з Telegram.
 * manualFor — анкету гостя (clientId) переносимо в ручну картку, створену раніше.
 */
export function PickClient({
  mode,
  clientId,
  clientName,
}: {
  mode: 'guestFor' | 'manualFor';
  clientId: number;
  clientName: string;
}) {
  const { t } = useTranslation();
  const nav = useNav();
  const [busy, setBusy] = useState(false);
  const { data, failed, reload } = useLoad(
    () =>
      mode === 'guestFor'
        ? api.clients({ status: 'GUEST', withTelegram: true })
        : api.clients({ withoutTelegram: true }),
    [mode],
  );

  async function pick(other: ClientListItem) {
    const target = mode === 'guestFor' ? { id: clientId, name: clientName } : other;
    const source = mode === 'guestFor' ? other : { id: clientId, name: clientName };
    if (!(await confirmAction(t('card.confirmLink', { source: source.name, target: target.name })))) return;
    setBusy(true);
    try {
      await api.linkClient(target.id, source.id);
      haptic('success');
      nav.pop();
      // Після злиття актуальна картка — та, у яку об'єднали.
      nav.replace({ name: 'client', id: target.id });
    } catch {
      haptic('error');
      setBusy(false);
      void reload();
    }
  }

  return (
    <Screen title={mode === 'guestFor' ? t('card.pickGuest') : t('card.pickManual')} back>
      {failed ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="muted center-text">{t('card.nothingToPick')}</p>
      ) : (
        <div className="card list">
          {data.map((c) => (
            <button key={c.id} className="list-row" disabled={busy} onClick={() => void pick(c)}>
              <span className="avatar" aria-hidden>
                {c.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="list-main">
                <span className="list-title">{c.name}</span>
                <span className="muted small">
                  {[c.phone, c.username ? `@${c.username}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Screen>
  );
}
