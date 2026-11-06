import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { moneyApi, waitlistApi, type BotSettings, type Lang, type Me } from '../api';
import { haptic } from '../telegram';
import { fmt, fromIso, timeRange } from '../time';
import { InfoRow, Loading, Ring, Screen, Section, useLoad } from '../ui';

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
      {role === 'TRAINER' && <BotSettingsSection />}

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
  const total = s ? s.activePasses.reduce((n, p) => n + p.totalSessions, 0) : 0;

  return (
    <>
      {s && (
        <Section title={t('money.pass')}>
          <div className="remaining">
            <Ring
              value={total ? s.remaining / total : 0}
              size={120}
              stroke={9}
              tone={total && s.remaining <= 1 ? 'amber' : 'flow'}
              label={t('money.pass')}
            >
              <span className="ring-value remaining-num">{s.remaining}</span>
            </Ring>
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

function BotSettingsSection() {
  const { t } = useTranslation();
  const { data, setData } = useLoad<BotSettings>(() => waitlistApi.settings(), []);
  const [saved, setSaved] = useState(false);
  if (!data) return <Loading />;

  async function save(patch: Partial<BotSettings>) {
    setSaved(false);
    const next = await waitlistApi.saveSettings(patch);
    setData(next);
    setSaved(true);
    haptic('success');
  }

  return (
    <Section title={t('botSettings.title')}>
      <div className="stack">
        <label>
          {t('botSettings.summaryTime')}
          <input type="time" value={data.dailySummaryTime} onChange={(e) => e.target.value && void save({ dailySummaryTime: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={data.remindersEnabled} onChange={(e) => void save({ remindersEnabled: e.target.checked })} />
          <span>{t('botSettings.reminders')}</span>
        </label>
        <p className="muted small">{t('botSettings.hint')}</p>
        {saved && <p className="ok-text small">{t('botSettings.saved')}</p>}
      </div>
    </Section>
  );
}
