import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { getTelegramFirstName } from '../telegram';
import { PhoneInput, phoneValid, phoneValue } from '../ui';

const GOALS = ['weight_loss', 'muscle_gain', 'strength', 'health', 'other'] as const;
const LEVELS = ['none', 'beginner', 'intermediate', 'advanced'] as const;

/** Анкета першого входу: три кроки на одній вертикальній лінії. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(getTelegramFirstName());
  const [phone, setPhone] = useState('');
  const [goal, setGoal] = useState<string>(GOALS[0]);
  const [experience, setExperience] = useState<string>(LEVELS[0]);
  const [health, setHealth] = useState('');
  const [injuries, setInjuries] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const phoneOk = phoneValid(phone);
  const stepOk = [name.trim().length > 0 && phoneOk, true, consent][step]!;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (step < 2) {
      if (stepOk) setStep(step + 1);
      return;
    }
    if (!consent || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.submitOnboarding({
        name: name.trim(),
        phone: phoneValue(phone) || undefined,
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

  const titles = [t('onboarding.stepContacts'), t('onboarding.stepGoal'), t('onboarding.stepConsent')];
  const summaries = [
    [name.trim(), phoneValue(phone)].filter(Boolean).join(' · '),
    `${t(`onboarding.goals.${goal}`)} · ${t(`onboarding.levels.${experience}`)}`,
    '',
  ];

  const content: ReactNode[] = [
    <>
      <label>
        {t('onboarding.name')}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
      </label>
      <label>
        {t('onboarding.phone')}
        <PhoneInput value={phone} onChange={setPhone} />
        {!phoneOk && <span className="error small">{t('errors.phone')}</span>}
      </label>
    </>,
    <>
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted tiny" style={{ fontWeight: 600 }}>
          {t('onboarding.goal')}
        </span>
        <div className="choice-chips" role="radiogroup" aria-label={t('onboarding.goal')}>
          {GOALS.map((g) => (
            <button type="button" key={g} role="radio" aria-checked={goal === g} aria-pressed={goal === g} onClick={() => setGoal(g)}>
              {t(`onboarding.goals.${g}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted tiny" style={{ fontWeight: 600 }}>
          {t('onboarding.experience')}
        </span>
        <div className="choice-chips" role="radiogroup" aria-label={t('onboarding.experience')}>
          {LEVELS.map((l) => (
            <button type="button" key={l} role="radio" aria-checked={experience === l} aria-pressed={experience === l} onClick={() => setExperience(l)}>
              {t(`onboarding.levels.${l}`)}
            </button>
          ))}
        </div>
      </div>
      <label>
        {t('onboarding.health')}
        <textarea value={health} onChange={(e) => setHealth(e.target.value)} maxLength={1000} rows={2} />
      </label>
      <label className="injury">
        {t('onboarding.injuries')}
        <textarea value={injuries} onChange={(e) => setInjuries(e.target.value)} maxLength={1000} rows={2} placeholder={t('onboarding.injuriesPlaceholder')} />
      </label>
    </>,
    <>
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t('onboarding.consent')}</span>
      </label>
      {failed && <p className="error">{t('errors.submit')}</p>}
    </>,
  ];

  return (
    <form className="screen" onSubmit={submit}>
      <div className="stack" style={{ gap: 6, padding: '4px 2px 6px' }}>
        <h1>{t('onboarding.title')}</h1>
        <p className="muted">{t('onboarding.subtitle')}</p>
      </div>

      <div className="card" style={{ paddingBottom: 0 }}>
        {titles.map((title, i) => (
          <div key={i} className={`step${i < step ? ' done' : i === step ? ' current' : ''}`}>
            <span className="step-mark" aria-hidden>
              {i < step ? '✓' : i + 1}
            </span>
            <div className="step-body">
              {i < step ? (
                <button type="button" className="link-button" style={{ color: 'var(--hint)' }} onClick={() => setStep(i)}>
                  {summaries[i] || title}
                </button>
              ) : (
                <span className="step-title" aria-current={i === step ? 'step' : undefined}>
                  {title}
                </span>
              )}
              {i === step && content[i]}
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 4 }}>
        {step > 0 && (
          <button type="button" className="secondary" style={{ flex: 'none' }} onClick={() => setStep(step - 1)}>
            {t('common.back')}
          </button>
        )}
        <button type="submit" disabled={!stepOk || busy}>
          {step < 2 ? t('onboarding.next') : t('onboarding.submit')}
        </button>
      </div>
    </form>
  );
}
