import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ClientStatus } from '../api';
import { useNav } from '../nav';
import { confirmAction, haptic, openChat } from '../telegram';
import { InfoRow, Loading, LoadError, Screen, Section, formatDate, useLoad } from '../ui';
import { ClientMoney } from './ClientMoney';

export function ClientCardScreen({ id }: { id: number }) {
  const { t, i18n } = useTranslation();
  const nav = useNav();
  const { data: c, setData, failed, reload } = useLoad(() => api.client(id), [id]);
  const [busy, setBusy] = useState(false);

  if (failed) {
    return (
      <Screen title="" back>
        <LoadError onRetry={reload} />
      </Screen>
    );
  }
  if (!c) {
    return (
      <Screen title="" back>
        <Loading />
      </Screen>
    );
  }

  const notSet = <span className="muted">{t('common.notSet')}</span>;

  async function setStatus(status: ClientStatus) {
    if (!c) return;
    if (status === 'INACTIVE' && !(await confirmAction(t('card.confirmArchive', { name: c.name })))) return;
    setBusy(true);
    try {
      setData(await api.updateClient(c.id, { status }));
      haptic('success');
    } catch {
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={c.name}
      back
      action={
        <button className="small-button secondary" onClick={() => nav.push({ name: 'clientForm', id: c.id })}>
          {t('common.edit')}
        </button>
      }
    >
      <p>
        <span className={`badge status-${c.status}`}>{t(`status.${c.status}`)}</span>
      </p>

      {c.status === 'GUEST' && (
        <button disabled={busy} onClick={() => void setStatus('ACTIVE')}>
          {t('card.approve')}
        </button>
      )}

      <Section title={t('card.contacts')}>
        <InfoRow label={t('card.phone')}>{c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a> : notSet}</InfoRow>
        <InfoRow label={t('card.telegram')}>
          {c.telegram ? (
            c.telegram.username ? (
              <button className="link-button" onClick={() => openChat(c.telegram!.username!)}>
                @{c.telegram.username}
              </button>
            ) : (
              c.telegram.firstName ?? 'Telegram'
            )
          ) : (
            <span className="muted">{t('card.telegramNone')}</span>
          )}
        </InfoRow>
      </Section>

      {!c.telegram && (
        <div className="stack">
          <button
            className="secondary"
            onClick={() => nav.push({ name: 'pickClient', mode: 'guestFor', clientId: c.id, clientName: c.name })}
          >
            {t('card.linkTelegram')}
          </button>
          <p className="muted small">{t('card.linkTelegramHint')}</p>
        </div>
      )}
      {c.telegram && c.status === 'GUEST' && (
        <div className="stack">
          <button
            className="secondary"
            onClick={() => nav.push({ name: 'pickClient', mode: 'manualFor', clientId: c.id, clientName: c.name })}
          >
            {t('card.mergeIntoExisting')}
          </button>
          <p className="muted small">{t('card.mergeIntoExistingHint')}</p>
        </div>
      )}

      <ClientMoney clientId={c.id} />

      <Section title={t('card.questionnaire')}>
        <InfoRow label={t('card.goal')}>{c.goal ? t(`onboarding.goals.${c.goal}`) : notSet}</InfoRow>
        <InfoRow label={t('card.experience')}>{c.experience ? t(`onboarding.levels.${c.experience}`) : notSet}</InfoRow>
        <InfoRow label={t('card.health')}>{c.health ? <span className="pre">{c.health}</span> : notSet}</InfoRow>
        <InfoRow label={t('card.injuries')}>
          {c.injuries ? <span className="pre warn-text">{c.injuries}</span> : notSet}
        </InfoRow>
        <InfoRow label={t('card.consent')}>
          {c.consentAt ? (
            t('card.consentGiven', { date: formatDate(c.consentAt, i18n.language) })
          ) : (
            <span className="muted">{t('card.consentMissing')}</span>
          )}
        </InfoRow>
      </Section>

      <Section title={t('card.notes')} hint={t('card.notesHint')}>
        {c.trainerNotes ? <p className="pre note">{c.trainerNotes}</p> : <p className="muted note">{t('common.notSet')}</p>}
      </Section>

      <Section title={t('card.referral')}>
        <InfoRow label={t('card.referredBy')}>
          {c.referredBy ? (
            <button className="link-button" onClick={() => nav.push({ name: 'client', id: c.referredBy!.id })}>
              {c.referredBy.name}
            </button>
          ) : (
            notSet
          )}
        </InfoRow>
        {c.referrals.length > 0 && (
          <InfoRow label={t('card.referrals')}>
            <span className="chips">
              {c.referrals.map((r) => (
                <button key={r.id} className="link-button" onClick={() => nav.push({ name: 'client', id: r.id })}>
                  {r.name}
                </button>
              ))}
            </span>
          </InfoRow>
        )}
      </Section>

      {c.status === 'ACTIVE' && (
        <button className="danger" disabled={busy} onClick={() => void setStatus('INACTIVE')}>
          {t('card.archive')}
        </button>
      )}
      {c.status === 'INACTIVE' && (
        <button className="secondary" disabled={busy} onClick={() => void setStatus('ACTIVE')}>
          {t('card.restore')}
        </button>
      )}
    </Screen>
  );
}
