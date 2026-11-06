import { useTranslation } from 'react-i18next';
import { moneyApi, type Lang, type Me } from '../api';
import { fmt, fromIso, timeRange } from '../time';
import { InfoRow, Loading, Screen, Section, useLoad } from '../ui';

export function Profile({ me, onLanguage }: { me: Me; onLanguage: (l: Lang) => void }) {
  const { t, i18n } = useTranslation();
  const name = me.client?.name ?? me.user.firstName ?? '';
  const role = me.user.role;

  return (
    <Screen title={t('home.greeting', { name })}>
      <Section>
        <InfoRow label={t('profile.role')}>
          <span className="badge">{t(`role.${role}`)}</span>
        </InfoRow>
      </Section>

      {role === 'GUEST' && <p className="muted">{t('home.guestWaiting')}</p>}
      {role === 'TRAINER' && <p className="muted">{t('home.trainerHint')}</p>}

      {role !== 'TRAINER' && me.client && <MyTrainings />}

      <label>
        {t('common.language')}
        <select value={i18n.language} onChange={(e) => onLanguage(e.target.value as Lang)}>
          <option value="uk">Українська</option>
          <option value="ru">Русский</option>
        </select>
      </label>
    </Screen>
  );
}

function MyTrainings() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data } = useLoad(() => moneyApi.mySummary(), []);
  if (!data) return <Loading />;
  const s = data.summary;

  return (
    <>
      {s && (
        <Section title={t('money.pass')}>
          <div className="remaining">
            <span className={`remaining-num${s.activePasses.length > 0 && s.remaining <= 1 ? ' warn-text' : ''}`}>{s.remaining}</span>
            <span className="muted">{t('money.sessionsLeft', { count: s.remaining })}</span>
          </div>
          {s.activePasses.length === 0 && <p className="muted small">{t('money.noActivePassClient')}</p>}
          {s.activePasses.map((p) => (
            <p key={p.id} className="muted small">
              {p.remaining} / {p.totalSessions}
              {p.expiresAt && ` · ${t('money.until', { date: fmt(fromIso(`${p.expiresAt}T12:00`), lang, 'd MMMM yyyy') })}`}
            </p>
          ))}
        </Section>
      )}

      <Section title={t('money.upcoming')}>
        {data.upcoming.length === 0 ? (
          <p className="muted note">{t('money.noUpcoming')}</p>
        ) : (
          data.upcoming.map((v) => (
            <div key={v.startsAt} className="info-row">
              <span className="value">
                {fmt(fromIso(v.startsAt), lang, 'cccc, d MMMM')} · {timeRange(v.startsAt, v.durationMin)}
              </span>
              <span className="muted small">
                {t(`calendar.type.${v.type}`)}
                {v.isTrial && ` · ${t('calendar.trial')}`}
              </span>
            </div>
          ))
        )}
      </Section>

      {data.history.length > 0 && (
        <Section title={t('money.myHistory')} hint={t('money.attendedCount', { count: s?.attended ?? 0 })}>
          {data.history.slice(0, 20).map((v) => (
            <div key={v.startsAt} className="info-row">
              <span className="value">
                {fmt(fromIso(v.startsAt), lang, 'd MMMM')} · {timeRange(v.startsAt, v.durationMin)}
              </span>
              <span className={`small ${v.status === 'ATTENDED' ? 'ok-text' : 'error'}`}>
                {v.status === 'ATTENDED' ? t('mark.attended') : t('mark.noShow')}
              </span>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}
