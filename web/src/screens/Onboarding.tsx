import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { getTelegramFirstName } from '../telegram';

const GOALS = ['weight_loss', 'muscle_gain', 'strength', 'health', 'other'] as const;
const LEVELS = ['none', 'beginner', 'intermediate', 'advanced'] as const;

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(getTelegramFirstName());
  const [phone, setPhone] = useState('');
  const [goal, setGoal] = useState<string>(GOALS[0]);
  const [experience, setExperience] = useState<string>(LEVELS[0]);
  const [health, setHealth] = useState('');
  const [injuries, setInjuries] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const canSubmit = consent && name.trim().length > 0 && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.submitOnboarding({
        name: name.trim(),
        phone: phone.trim() || undefined,
        goal,
        experience,
        health: health.trim() || undefined,
        injuries: injuries.trim() || undefined,
        consent: true,
      });
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="screen" onSubmit={submit}>
      <h1>{t('onboarding.title')}</h1>
      <p className="muted">{t('onboarding.subtitle')}</p>

      <label>
        {t('onboarding.name')}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
      </label>

      <label>
        {t('onboarding.phone')}
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+380…"
        />
      </label>

      <label>
        {t('onboarding.goal')}
        <select value={goal} onChange={(e) => setGoal(e.target.value)}>
          {GOALS.map((g) => (
            <option key={g} value={g}>
              {t(`onboarding.goals.${g}`)}
            </option>
          ))}
        </select>
      </label>

      <label>
        {t('onboarding.experience')}
        <select value={experience} onChange={(e) => setExperience(e.target.value)}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {t(`onboarding.levels.${l}`)}
            </option>
          ))}
        </select>
      </label>

      <label>
        {t('onboarding.health')}
        <textarea value={health} onChange={(e) => setHealth(e.target.value)} maxLength={1000} rows={3} />
      </label>

      <label>
        {t('onboarding.injuries')}
        <textarea
          value={injuries}
          onChange={(e) => setInjuries(e.target.value)}
          maxLength={1000}
          rows={3}
        />
      </label>

      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t('onboarding.consent')}</span>
      </label>

      {failed && <p className="error">{t('errors.submit')}</p>}

      <button type="submit" disabled={!canSubmit}>
        {t('onboarding.submit')}
      </button>
    </form>
  );
}
