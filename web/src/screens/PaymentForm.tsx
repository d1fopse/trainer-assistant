import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, moneyApi, type PaymentMethod, type PaymentPurpose, type Price } from '../api';
import { errorText } from '../errors';
import { useNav } from '../nav';
import { confirmAction, haptic } from '../telegram';
import { isoDate, now } from '../time';
import { Loading, Screen, Segmented, formatUah } from '../ui';
import { localized } from './Prices';

const PURPOSES: PaymentPurpose[] = ['PASS', 'SINGLE', 'TRIAL', 'OTHER'];

type Form = {
  amount: string;
  paidAt: string;
  method: PaymentMethod;
  purpose: PaymentPurpose;
  note: string;
  sessions: string;
  expiresAt: string;
};

export function PaymentForm({ clientId, id }: { clientId: number; id?: number }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nav = useNav();
  const [prices, setPrices] = useState<Price[]>([]);
  const [form, setForm] = useState<Form | null>(
    id ? null : { amount: '', paidAt: isoDate(now()), method: 'CASH', purpose: 'PASS', note: '', sessions: '', expiresAt: '' },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) void api.prices().then(setPrices);
    else
      void moneyApi.history(clientId).then((h) => {
        const p = h.payments.find((x) => x.id === id);
        if (!p) return nav.pop();
        setForm({
          amount: String(p.amountUah),
          paidAt: p.paidAt,
          method: p.method,
          purpose: p.purpose,
          note: p.note ?? '',
          sessions: '',
          expiresAt: '',
        });
      });
  }, [id, clientId, nav]);

  if (!form) {
    return (
      <Screen title={t('money.editPayment')} back>
        <Loading />
      </Screen>
    );
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const amount = Number(form.amount);
  const sessions = Number(form.sessions);
  const withPass = !id && form.purpose === 'PASS';
  const canSave =
    form.amount !== '' && Number.isInteger(amount) && form.paidAt !== '' && (!withPass || sessions >= 1) && !busy;

  function fromPrice(pid: string) {
    const p = prices.find((x) => x.id === Number(pid));
    if (!p || !form) return;
    setForm({
      ...form,
      amount: String(p.priceUah),
      purpose: p.kind === 'PASS' ? 'PASS' : 'SINGLE',
      sessions: p.sessionsCount ? String(p.sessionsCount) : '',
      note: localized(p, lang).title,
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || !canSave) return;
    setBusy(true);
    setError(null);
    const body = {
      amountUah: amount,
      paidAt: form.paidAt,
      method: form.method,
      purpose: form.purpose,
      note: form.note.trim() || null,
    };
    try {
      if (id) {
        await moneyApi.updatePayment(id, body);
      } else {
        const r = await moneyApi.addPayment(clientId, {
          ...body,
          ...(withPass ? { pass: { totalSessions: sessions, expiresAt: form.expiresAt || null } } : {}),
        });
        // Є відвідування без абонемента — пропонуємо списати їх з нового.
        if (r.pass && r.summary.unpaid > 0 && (await confirmAction(t('money.applyUnpaidConfirm', { count: r.summary.unpaid })))) {
          await moneyApi.applyUnpaid(clientId);
        }
      }
      haptic('success');
      nav.pop();
    } catch (err) {
      setError(errorText(err, t));
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id || !(await confirmAction(t('money.confirmDeletePayment')))) return;
    setBusy(true);
    try {
      await moneyApi.deletePayment(id);
      nav.pop();
    } catch (err) {
      setError(errorText(err, t));
      setBusy(false);
    }
  }

  return (
    <Screen title={id ? t('money.editPayment') : t('money.newPayment')} back>
      <form className="stack" onSubmit={save}>
        {!id && prices.length > 0 && (
          <label>
            {t('money.fromPrice')}
            <select defaultValue="" onChange={(e) => fromPrice(e.target.value)}>
              <option value="">—</option>
              {prices.map((p) => (
                <option key={p.id} value={p.id}>
                  {localized(p, lang).title} · {t('common.uah', { value: formatUah(p.priceUah, lang) })}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          {t('money.purposeLabel')}
          <select value={form.purpose} onChange={(e) => set('purpose', e.target.value as PaymentPurpose)}>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {t(`money.purpose.${p}`)}
              </option>
            ))}
          </select>
        </label>

        <div className="row-2">
          <label>
            {t('money.amount')}
            <input inputMode="numeric" value={form.amount} onChange={(e) => set('amount', e.target.value.replace(/\D/g, ''))} required />
          </label>
          <label>
            {t('money.paidAt')}
            <input type="date" value={form.paidAt} onChange={(e) => set('paidAt', e.target.value)} required />
          </label>
        </div>

        <label>
          {t('money.methodLabel')}
          <Segmented<PaymentMethod>
            value={form.method}
            onChange={(v) => set('method', v)}
            options={(['CASH', 'CARD', 'TRANSFER'] as const).map((m) => ({ value: m, label: t(`money.method.${m}`) }))}
          />
        </label>

        {withPass && (
          <div className="row-2">
            <label>
              {t('money.sessions')}
              <input inputMode="numeric" value={form.sessions} onChange={(e) => set('sessions', e.target.value.replace(/\D/g, ''))} required />
            </label>
            <label>
              {t('money.expiresAt')}
              <input
                type="date"
                value={form.expiresAt}
                min={form.paidAt}
                onChange={(e) => set('expiresAt', e.target.value)}
              />
            </label>
          </div>
        )}

        <label>
          {t('money.note')}
          <input value={form.note} onChange={(e) => set('note', e.target.value)} maxLength={500} />
        </label>

        {id && <p className="muted small">{t('money.editPaymentHint')}</p>}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={!canSave}>
          {t('common.save')}
        </button>
        {id && (
          <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>
            {t('common.delete')}
          </button>
        )}
      </form>
    </Screen>
  );
}

/** Абонемент: редагування залишку/строку або подарунковий без оплати. */
export function PassForm({ clientId, id }: { clientId: number; id?: number }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [form, setForm] = useState<{ total: string; remaining: string; expiresAt: string; note: string } | null>(
    id ? null : { total: '', remaining: '', expiresAt: '', note: '' },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void moneyApi.history(clientId).then((h) => {
      const p = h.summary.passes.find((x) => x.id === id);
      if (!p) return nav.pop();
      setForm({ total: String(p.totalSessions), remaining: String(p.remaining), expiresAt: p.expiresAt ?? '', note: p.note ?? '' });
    });
  }, [id, clientId, nav]);

  if (!form) {
    return (
      <Screen title={t('money.editPass')} back>
        <Loading />
      </Screen>
    );
  }

  const total = Number(form.total);
  const remaining = form.remaining === '' ? total : Number(form.remaining);
  const canSave = total >= 1 && remaining >= 0 && !busy;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || !canSave) return;
    setBusy(true);
    setError(null);
    const body = { totalSessions: total, remaining, expiresAt: form.expiresAt || null, note: form.note.trim() || null };
    try {
      if (id) await moneyApi.updatePass(id, body);
      else await moneyApi.addPass(clientId, body);
      haptic('success');
      nav.pop();
    } catch (err) {
      setError(errorText(err, t));
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id || !(await confirmAction(t('money.confirmDeletePass')))) return;
    setBusy(true);
    try {
      await moneyApi.deletePass(id);
      nav.pop();
    } catch (err) {
      setError(errorText(err, t));
      setBusy(false);
    }
  }

  const digits = (v: string) => v.replace(/\D/g, '');
  return (
    <Screen title={id ? t('money.editPass') : t('money.giftPass')} back>
      {!id && <p className="muted">{t('money.giftPassHint')}</p>}
      <form className="stack" onSubmit={save}>
        <div className="row-2">
          <label>
            {t('money.sessions')}
            <input inputMode="numeric" value={form.total} onChange={(e) => setForm({ ...form, total: digits(e.target.value) })} required />
          </label>
          <label>
            {t('money.remainingLabel')}
            <input
              inputMode="numeric"
              value={form.remaining}
              placeholder={form.total}
              onChange={(e) => setForm({ ...form, remaining: digits(e.target.value) })}
            />
          </label>
        </div>
        <label>
          {t('money.expiresAt')}
          <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
        </label>
        <label>
          {t('money.note')}
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={500} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={!canSave}>
          {t('common.save')}
        </button>
        {id && (
          <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>
            {t('common.delete')}
          </button>
        )}
      </form>
    </Screen>
  );
}

/** Ручне відвідування в минулому (не через календар). */
export function VisitForm({ clientId }: { clientId: number }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [date, setDate] = useState(isoDate(now().minus({ days: 1 })));
  const [time, setTime] = useState('18:00');
  const [status, setStatus] = useState<'ATTENDED' | 'NO_SHOW'>('ATTENDED');
  const [deduct, setDeduct] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await moneyApi.addVisit(clientId, { date, time, durationMin: 60, status, isTrial, deduct: status === 'NO_SHOW' ? deduct : undefined });
      haptic(r.warning ? 'warning' : 'success');
      nav.pop();
    } catch (err) {
      setError(errorText(err, t));
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t('money.addVisit')} back>
      <p className="muted">{t('money.addVisitHint')}</p>
      <form className="stack" onSubmit={save}>
        <div className="row-2">
          <label>
            {t('slot.date')}
            <input type="date" value={date} max={isoDate(now())} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            {t('slot.time')}
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </label>
        </div>
        <Segmented<'ATTENDED' | 'NO_SHOW'>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ATTENDED', label: t('mark.attended') },
            { value: 'NO_SHOW', label: t('mark.noShow') },
          ]}
        />
        {status === 'NO_SHOW' && !isTrial && (
          <label className="check">
            <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />
            <span>{t('mark.noShowDeduct')}</span>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={isTrial} onChange={(e) => setIsTrial(e.target.checked)} />
          <span>{t('slot.trial')}</span>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || !date || !time}>
          {t('common.save')}
        </button>
      </form>
    </Screen>
  );
}

