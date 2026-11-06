import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, GOALS, LEVELS, type ClientInput, type ClientListItem } from '../api';
import { useNav } from '../nav';
import { haptic } from '../telegram';
import { Loading, PHONE_RE, Screen } from '../ui';

type Form = {
  name: string;
  phone: string;
  goal: string;
  experience: string;
  health: string;
  injuries: string;
  trainerNotes: string;
  referredByClientId: string;
};

const empty: Form = {
  name: '',
  phone: '',
  goal: '',
  experience: '',
  health: '',
  injuries: '',
  trainerNotes: '',
  referredByClientId: '',
};

export function ClientForm({ id }: { id?: number }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [form, setForm] = useState<Form | null>(id ? null : empty);
  const [others, setOthers] = useState<ClientListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void api.clients().then((all) => setOthers(all.filter((c) => c.id !== id)));
    if (!id) return;
    void api.client(id).then((c) =>
      setForm({
        name: c.name,
        phone: c.phone ?? '',
        goal: c.goal ?? '',
        experience: c.experience ?? '',
        health: c.health ?? '',
        injuries: c.injuries ?? '',
        trainerNotes: c.trainerNotes ?? '',
        referredByClientId: c.referredByClientId ? String(c.referredByClientId) : '',
      }),
    );
  }, [id]);

  if (!form) {
    return (
      <Screen title={t('clients.editClient')} back>
        <Loading />
      </Screen>
    );
  }

  const set = (k: keyof Form, v: string) => setForm({ ...form, [k]: v });
  const phoneOk = PHONE_RE.test(form.phone.trim());
  const canSave = form.name.trim() !== '' && phoneOk && !busy;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canSave || !form) return;
    setBusy(true);
    setFailed(false);
    const body: ClientInput = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      goal: form.goal || null,
      experience: form.experience || null,
      health: form.health,
      injuries: form.injuries,
      trainerNotes: form.trainerNotes,
      referredByClientId: form.referredByClientId ? Number(form.referredByClientId) : null,
    };
    try {
      if (id) {
        await api.updateClient(id, body);
        nav.pop();
      } else {
        const created = await api.createClient(body);
        nav.replace({ name: 'client', id: created.id });
      }
      haptic('success');
    } catch {
      setFailed(true);
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={id ? t('clients.editClient') : t('clients.newClient')} back>
      <form className="stack" onSubmit={save}>
        <label>
          {t('form.name')}
          <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={100} required />
        </label>
        <label>
          {t('form.phone')}
          <input
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="+380…"
          />
          {!phoneOk && <span className="error small">{t('errors.phone')}</span>}
        </label>
        <label>
          {t('form.goal')}
          <select value={form.goal} onChange={(e) => set('goal', e.target.value)}>
            <option value="">{t('form.none')}</option>
            {GOALS.map((g) => (
              <option key={g} value={g}>
                {t(`onboarding.goals.${g}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('form.experience')}
          <select value={form.experience} onChange={(e) => set('experience', e.target.value)}>
            <option value="">{t('form.none')}</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`onboarding.levels.${l}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('form.health')}
          <textarea value={form.health} onChange={(e) => set('health', e.target.value)} maxLength={1000} rows={3} />
        </label>
        <label>
          {t('form.injuries')}
          <textarea value={form.injuries} onChange={(e) => set('injuries', e.target.value)} maxLength={1000} rows={3} />
        </label>
        <label>
          {t('form.notes')}
          <textarea
            value={form.trainerNotes}
            onChange={(e) => set('trainerNotes', e.target.value)}
            maxLength={5000}
            rows={4}
          />
        </label>
        <label>
          {t('form.referredBy')}
          <select value={form.referredByClientId} onChange={(e) => set('referredByClientId', e.target.value)}>
            <option value="">{t('form.nobody')}</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.phone ? ` · ${c.phone}` : ''}
              </option>
            ))}
          </select>
        </label>

        {failed && <p className="error">{t('errors.save')}</p>}
        <button type="submit" disabled={!canSave}>
          {t('common.save')}
        </button>
      </form>
    </Screen>
  );
}
