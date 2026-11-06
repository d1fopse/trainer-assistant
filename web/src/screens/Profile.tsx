import { useTranslation } from 'react-i18next';
import type { Lang, Me } from '../api';
import { InfoRow, Screen, Section } from '../ui';

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
