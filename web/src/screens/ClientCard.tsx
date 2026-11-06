import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ClientStatus } from '../api';
import { useNav } from '../nav';
import { confirmAction, haptic, openChat } from '../telegram';
import { fmt, fromIso } from '../time';
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

  const since = fmt(fromIso(c.createdAt), i18n.language, 'MMMM yyyy');
  const subtitle = [t(`status.${c.status}`), t('card.since', { date: since }), c.referredBy ? t('card.invitedBy', { name: c.referredBy.name }) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen
      title={c.name}
      subtitle={subtitle}
      subTone={c.status === 'ACTIVE' ? 'green' : undefined}
      back
      action={
        <button className="small-button secondary" onClick={() => nav.push({ name: 'clientForm', id: c.id })}>
          {t('common.edit')}
        </button>
      }
    >
      {c.status === 'GUEST' && (
        <button disabled={busy} onClick={() => void setStatus('ACTIVE')}>
          {t('card.approve')}
        </button>
      )}

      <div className="tiles two">
        {c.phone ? (
          <a className="stat" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>
            <span className="stat-label">{t('card.phone')}</span>
            <span className="link">{c.phone}</span>
          </a>
        ) : (
          <button className="stat" onClick={() => nav.push({ name: 'clientForm', id: c.id })}>
            <span className="stat-label">{t('card.phone')}</span>
            <span className="link">{t('card.addPhone')}</span>
          </button>
        )}
        {c.telegram ? (
          c.telegram.username ? (
            <button className="stat" onClick={() => openChat(c.telegram!.username!)}>
              <span className="stat-label">{t('card.telegram')}</span>
              <span className="link">@{c.telegram.username}</span>
            </button>
          ) : (
            <div className="stat">
              <span className="stat-label">{t('card.telegram')}</span>
              <span className="link" style={{ color: 'var(--text)' }}>
                {c.telegram.firstName ?? 'Telegram'}
              </span>
            </div>
          )
        ) : (
          <button
            className="stat"
            onClick={() => nav.push({ name: 'pickClient', mode: 'guestFor', clientId: c.id, clientName: c.name })}
          >
            <span className="stat-label">{t('card.telegram')}</span>
            <span className="link">{t('card.linkTelegram')}</span>
          </button>
        )}
      </div>
      {!c.telegram && <p className="muted tiny" style={{ padding: '0 4px' }}>{t('card.linkTelegramHint')}</p>}
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
        <div className="info-row">
          <div className="tiles two" style={{ gap: 8 }}>
            <div className="list-main">
              <span className="muted tiny">{t('card.goal')}</span>
              <span className="value">{c.goal ? t(`onboarding.goals.${c.goal}`) : notSet}</span>
            </div>
            <div className="list-main">
              <span className="muted tiny">{t('card.experience')}</span>
              <span className="value">{c.experience ? t(`onboarding.levels.${c.experience}`) : notSet}</span>
            </div>
          </div>
        </div>
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
