import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type PriceInput, type PriceKind } from '../api';
import { useNav } from '../nav';
import { confirmAction, haptic } from '../telegram';
import { Loading, Screen, Segmented } from '../ui';

const empty: PriceInput = {
  kind: 'SINGLE',
  titleUk: '',
  titleRu: '',
  descriptionUk: '',
  descriptionRu: '',
  priceUah: 0,
  sessionsCount: null,
  isVisible: true,
};

export function PriceForm({ id }: { id?: number }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [form, setForm] = useState<PriceInput | null>(id ? null : empty);
  const [priceText, setPriceText] = useState('');
  const [sessionsText, setSessionsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    void api.prices().then((all) => {
      const p = all.find((x) => x.id === id);
      if (!p) return nav.pop();
      setForm({
        kind: p.kind,
        titleUk: p.titleUk,
        titleRu: p.titleRu ?? '',
        descriptionUk: p.descriptionUk ?? '',
        descriptionRu: p.descriptionRu ?? '',
        priceUah: p.priceUah,
        sessionsCount: p.sessionsCount,
        isVisible: p.isVisible,
      });
      setPriceText(String(p.priceUah));
      setSessionsText(p.sessionsCount ? String(p.sessionsCount) : '');
    });
  }, [id, nav]);

  if (!form) {
    return (
      <Screen title={t('prices.editPrice')} back>
        <Loading />
      </Screen>
    );
  }

  const set = <K extends keyof PriceInput>(k: K, v: PriceInput[K]) => setForm({ ...form, [k]: v });
  const price = Number(priceText);
  const sessions = Number(sessionsText);
  const priceOk = priceText !== '' && Number.isInteger(price) && price >= 0;
  const sessionsOk = form.kind === 'SINGLE' || (Number.isInteger(sessions) && sessions >= 1);
  const canSave = form.titleUk.trim() !== '' && priceOk && sessionsOk && !busy;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canSave || !form) return;
    setBusy(true);
    setFailed(false);
    const body: PriceInput = {
      ...form,
      priceUah: price,
      sessionsCount: form.kind === 'PASS' ? sessions : null,
    };
    try {
      if (id) await api.updatePrice(id, body);
      else await api.createPrice(body);
      haptic('success');
      nav.pop();
    } catch {
      setFailed(true);
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id || !form) return;
    if (!(await confirmAction(t('prices.confirmDelete', { title: form.titleUk })))) return;
    setBusy(true);
    try {
      await api.deletePrice(id);
      nav.pop();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <Screen title={id ? t('prices.editPrice') : t('prices.newPrice')} back>
      <form className="stack" onSubmit={save}>
        <label>
          {t('prices.type')}
          <Segmented<PriceKind>
            value={form.kind}
            onChange={(v) => set('kind', v)}
            options={[
              { value: 'SINGLE', label: t('prices.kind.SINGLE') },
              { value: 'PASS', label: t('prices.kind.PASS') },
            ]}
          />
        </label>

        <label>
          {t('prices.titleUk')}
          <input value={form.titleUk} onChange={(e) => set('titleUk', e.target.value)} maxLength={100} required />
        </label>

        <div className="row-2">
          <label>
            {t('prices.price')}
            <input
              inputMode="numeric"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value.replace(/\D/g, ''))}
              placeholder="600"
              required
            />
          </label>
          {form.kind === 'PASS' && (
            <label>
              {t('prices.sessionsCount')}
              <input
                inputMode="numeric"
                value={sessionsText}
                onChange={(e) => setSessionsText(e.target.value.replace(/\D/g, ''))}
                placeholder="8"
                required
              />
            </label>
          )}
        </div>

        <label>
          {t('prices.descriptionUk')}
          <textarea
            value={form.descriptionUk}
            onChange={(e) => set('descriptionUk', e.target.value)}
            maxLength={500}
            rows={3}
          />
        </label>

        <details className="details">
          <summary>{t('prices.titleRu')} / {t('prices.descriptionRu')}</summary>
          <p className="muted small">{t('prices.ruHint')}</p>
          <label>
            {t('prices.titleRu')}
            <input value={form.titleRu} onChange={(e) => set('titleRu', e.target.value)} maxLength={100} />
          </label>
          <label>
            {t('prices.descriptionRu')}
            <textarea
              value={form.descriptionRu}
              onChange={(e) => set('descriptionRu', e.target.value)}
              maxLength={500}
              rows={3}
            />
          </label>
        </details>

        <label className="check">
          <input type="checkbox" checked={form.isVisible} onChange={(e) => set('isVisible', e.target.checked)} />
          <span>{t('prices.visible')}</span>
        </label>

        {failed && <p className="error">{t('errors.save')}</p>}

        <button type="submit" disabled={!canSave}>
          {t('common.save')}
        </button>
        {id && (
          <button type="button" className="danger" onClick={() => void remove()} disabled={busy}>
            {t('common.delete')}
          </button>
        )}
      </form>
    </Screen>
  );
}
