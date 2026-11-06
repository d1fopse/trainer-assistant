import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { moneyApi, waitlistApi, type BotSettings, type Lang, type Me } from '../api';
import { Icon } from '../icons';
import { haptic, openChat } from '../telegram';
import { fmt, formatDuration, fromIso, now, timeRange } from '../time';
import { Chip, Ev, Loading, PassLine, Screen, Section, Segmented, StreamNow, Switch, useLoad, type Tone } from '../ui';

export function Profile({ me, onLanguage }: { me: Me; onLanguage: (l: Lang) => void }) {
  const { t, i18n } = useTranslation();
  const name = me.client?.name ?? me.user.firstName ?? '';
  const role = me.user.role;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

  const language = (
    <Section>
      <div className="price-top" style={{ alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{t('common.language')}</span>
        <Segmented<Lang>
          inset
          value={(i18n.language === 'ru' ? 'ru' : 'uk') as Lang}
          onChange={onLanguage}
          options={[
            { value: 'uk', label: 'Українська' },
            { value: 'ru', label: 'Русский' },
          ]}
        />
      </div>
    </Section>
  );

  if (role === 'TRAINER') {
    return (
      <Screen title={t('profile.title')}>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="avatar" aria-hidden>
            {initials || '•'}
          </span>
          <div className="list-main">
            <span className="list-title">{name}</span>
            <span className="muted small">{t('role.TRAINER')}</span>
          </div>
        </div>
        <BotDay />
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="icon-button" style={{ background: 'rgba(76,141,255,0.14)', border: 0, color: 'var(--blue-text)' }} aria-hidden>
            <Icon name="send" size={20} />
          </span>
          <div className="list-main">
            <span className="list-title">{t('botSettings.broadcast')}</span>
            <span className="muted small" style={{ whiteSpace: 'normal' }}>
              {t('botSettings.broadcastHint')}
            </span>
          </div>
        </div>
        {language}
      </Screen>
    );
  }

  return (
    <Screen title={t('home.greeting', { name })} subtitle={fmt(now(), i18n.language, 'cccc, d MMMM')}>
      {role === 'GUEST' && <p className="card notice">{t('home.guestWaiting')}</p>}
      {me.client && role === 'CLIENT' && <ClientHome />}
      {me.trainerUsername && role === 'CLIENT' && (
        <button onClick={() => openChat(me.trainerUsername!)}>{t('home.writeTrainer')}</button>
      )}
      {language}
    </Screen>
  );
}

/** Головна клієнта: відлік до заняття, абонемент на шкалі, стрічка «мій тиждень». */
function ClientHome() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data } = useLoad(() => moneyApi.mySummary(), []);
  if (!data) return <Loading />;
  const s = data.summary;
  const next = data.upcoming[0];
  const pass = s ? [...s.activePasses].sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'))[0] : undefined;
  const typeTone = (type: string): Tone => (type === 'GROUP' ? 'violet' : 'blue');

  let countdown: string | null = null;
  if (next) {
    const min = Math.max(1, Math.round((new Date(next.startsAt).getTime() - Date.now()) / 60000));
    countdown =
      min < 180
        ? t('home.inTime', { time: formatDuration(min, lang) })
        : min < 48 * 60
          ? t('home.inTime', { time: formatDuration(Math.round(min / 60) * 60, lang) })
          : t('home.inDays', { count: Math.round(min / 1440) });
  }

  return (
    <>
      {next ? (
        <div className={`hero-next${next.type === 'GROUP' ? ' group' : ''}`}>
          <span className="eyebrow">{t('home.nextSession')}</span>
          <div className="price-top">
            <span className="big">{fromIso(next.startsAt).toFormat('HH:mm')}</span>
            <span className="countdown">{countdown}</span>
          </div>
          <span className="muted small">
            {fmt(fromIso(next.startsAt), lang, 'ccc, d MMMM')} · {t(`calendar.type.${next.type}`).toLowerCase()} · {formatDuration(next.durationMin, lang)}
            {next.isTrial && ` · ${t('calendar.trial')}`}
          </span>
        </div>
      ) : (
        <p className="card muted">{t('money.noUpcoming')}</p>
      )}

      {s && (
        <div className="card stack">
          <div className="price-top">
            <span className="muted small">{pass ? t('money.passOf', { count: pass.totalSessions }) : t('money.pass')}</span>
            <span className={`big-number${pass && s.remaining <= 1 ? ' warn-text' : ''}`} style={{ fontSize: 22 }}>
              {s.remaining} <span className="muted small">{t('money.leftShort')}</span>
            </span>
          </div>
          {pass ? (
            <PassLine
              start={pass.purchasedAt}
              end={pass.expiresAt}
              total={pass.totalSessions}
              remaining={pass.remaining}
              marks={[
                ...data.history
                  .filter((h) => h.startsAt >= `${pass.purchasedAt}T00`)
                  .map((h) => ({ at: h.startsAt, kind: (h.status === 'NO_SHOW' ? 'n' : 'v') as 'v' | 'n' })),
                ...data.upcoming.map((u) => ({ at: u.startsAt, kind: 'b' as const })),
              ]}
              lang={lang}
            />
          ) : (
            <p className="muted small">{t('money.noActivePassClient')}</p>
          )}
        </div>
      )}

      {(data.upcoming.length > 0 || data.history.length > 0) && (
        <Section title={t('home.myStream')} hint={s ? t('money.attendedCount', { count: s.attended }) : undefined}>
          <div className="stream">
            {[...data.upcoming].reverse().map((v) => (
              <Ev
                key={v.startsAt}
                tone={typeTone(v.type)}
                future
                title={`${fmt(fromIso(v.startsAt), lang, 'ccc d MMM')} · ${t(`calendar.type.${v.type}`)}`}
                sub={timeRange(v.startsAt, v.durationMin) + (v.isTrial ? ` · ${t('calendar.trial')}` : '')}
                chip={<Chip tone={typeTone(v.type)}>{t('home.booked')}</Chip>}
              />
            ))}
            <StreamNow label={t('money.nowMark', { date: fmt(now(), lang, 'ccc d MMM') })} />
            {data.history.slice(0, 10).map((v) => (
              <Ev
                key={v.startsAt}
                tone={v.status === 'ATTENDED' ? 'green' : 'red'}
                title={`${fmt(fromIso(v.startsAt), lang, 'ccc d MMM')} · ${t(`calendar.type.${v.type}`)}`}
                sub={timeRange(v.startsAt, v.durationMin)}
                chip={<Chip tone={v.status === 'ATTENDED' ? 'green' : 'red'}>{v.status === 'ATTENDED' ? t('home.came') : t('mark.noShow').toLowerCase()}</Chip>}
              />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/** Налаштування бота у вигляді його «розпорядку дня». */
function BotDay() {
  const { t } = useTranslation();
  const { data, setData } = useLoad<BotSettings>(() => waitlistApi.settings(), []);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!data) return <Loading />;

  async function save(patch: Partial<BotSettings>) {
    setSaved(false);
    setFailed(false);
    try {
      setData(await waitlistApi.saveSettings(patch));
      setSaved(true);
      haptic('success');
    } catch {
      setFailed(true);
      haptic('error');
    }
  }

  return (
    <Section
      title={
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          {t('botSettings.day')}
        </span>
      }
      hint={saved ? t('botSettings.saved') : t('botSettings.dayHint')}
    >
      <div className="stream" style={{ paddingTop: 8 }}>
        <div className="bot-ev">
          <span className="time">{data.dailySummaryTime}</span>
          <span className="ev-dot" style={{ ['--c' as string]: 'var(--blue)' }} />
          <div className="list-main">
            <span className="list-title">{t('botSettings.summary')}</span>
            <span className="muted tiny" style={{ whiteSpace: 'normal' }}>
              {t('botSettings.summaryHint')}
            </span>
            <input
              type="time"
              aria-label={t('botSettings.summaryTime')}
              value={data.dailySummaryTime}
              onChange={(e) => e.target.value && void save({ dailySummaryTime: e.target.value })}
            />
          </div>
        </div>
        <div className="bot-ev">
          <span className="time">−3 {t('botSettings.hoursShort')}</span>
          <span className="ev-dot" style={{ ['--c' as string]: data.remindersEnabled ? 'var(--green)' : 'var(--line-strong)' }} />
          <div className="list-main">
            <span className="list-title">{t('botSettings.reminder')}</span>
            <span className="muted tiny" style={{ whiteSpace: 'normal' }}>
              {t('botSettings.reminderHint')}
            </span>
          </div>
          <Switch checked={data.remindersEnabled} label={t('botSettings.reminders')} onChange={(v) => void save({ remindersEnabled: v })} />
        </div>
        <div className="bot-ev">
          <span className="time" style={{ fontSize: 16 }}>
            🔔
          </span>
          <span className="ev-dot" style={{ ['--c' as string]: 'var(--yellow)' }} />
          <div className="list-main">
            <span className="list-title">{t('botSettings.waitlist')}</span>
            <span className="muted tiny" style={{ whiteSpace: 'normal' }}>
              {t('botSettings.waitlistHint')}
            </span>
          </div>
        </div>
      </div>
      {failed && <p className="error small" style={{ paddingBottom: 10 }}>{t('errors.save')}</p>}
      <p className="muted tiny" style={{ paddingBottom: 12 }}>
        {t('botSettings.startHint')}
      </p>
    </Section>
  );
}
