import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BookingStatus, SlotBooking } from '../api';

/** Підпис статусу запису з урахуванням списання. */
export function bookingStatusText(
  t: (k: string) => string,
  b: { status: BookingStatus; isTrial: boolean; deducted: boolean },
): { text: string; tone: 'ok' | 'warn' | 'muted' | 'bad' } {
  switch (b.status) {
    case 'ATTENDED':
      if (b.isTrial) return { text: `${t('mark.attended')} · ${t('calendar.trial')}`, tone: 'ok' };
      return b.deducted
        ? { text: `${t('mark.attended')} · ${t('mark.deducted')}`, tone: 'ok' }
        : { text: `${t('mark.attended')} · ${t('mark.unpaid')}`, tone: 'warn' };
    case 'NO_SHOW':
      return { text: `${t('mark.noShow')} · ${b.deducted ? t('mark.deducted') : t('mark.notDeducted')}`, tone: 'bad' };
    case 'CANCELLED':
      return { text: t('mark.cancelled'), tone: 'muted' };
    default:
      return { text: t('mark.booked'), tone: 'muted' };
  }
}

export function BookingRow({
  b,
  busy,
  onOpenClient,
  onMark,
  onCancel,
}: {
  b: SlotBooking;
  busy: boolean;
  onOpenClient: () => void;
  onMark: (status: BookingStatus, deduct?: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [askNoShow, setAskNoShow] = useState(false);
  const st = bookingStatusText(t, b);

  return (
    <div className="booking-row column">
      <div className="booking-head">
        <button className="link-button" onClick={onOpenClient}>
          {b.name}
        </button>
        {b.isTrial && <span className="tag">{t('calendar.trial')}</span>}
        <span className="spacer" />
        {b.status !== 'BOOKED' && <span className={`status-chip ${st.tone}`}>{st.text}</span>}
      </div>

      {b.status === 'BOOKED' && !askNoShow && (
        <div className="mark-buttons">
          <button className="small-button ok" disabled={busy} onClick={() => onMark('ATTENDED')}>
            ✓ {t('mark.attended')}
          </button>
          <button className="small-button secondary" disabled={busy} onClick={() => (b.isTrial ? onMark('NO_SHOW') : setAskNoShow(true))}>
            {t('mark.noShow')}
          </button>
          <button className="small-button danger" disabled={busy} onClick={onCancel}>
            {t('slot.cancelBooking')}
          </button>
        </div>
      )}

      {b.status === 'BOOKED' && askNoShow && (
        <div className="stack">
          <span className="muted small">{t('mark.deductQuestion')}</span>
          <div className="mark-buttons">
            <button
              className="small-button danger"
              disabled={busy}
              onClick={() => {
                setAskNoShow(false);
                onMark('NO_SHOW', true);
              }}
            >
              {t('mark.noShowDeduct')}
            </button>
            <button
              className="small-button secondary"
              disabled={busy}
              onClick={() => {
                setAskNoShow(false);
                onMark('NO_SHOW', false);
              }}
            >
              {t('mark.noShowKeep')}
            </button>
            <button className="small-button secondary" onClick={() => setAskNoShow(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {b.status !== 'BOOKED' && (
        <div className="mark-buttons">
          <button className="link-button small" disabled={busy} onClick={() => onMark('BOOKED')}>
            ↺ {t('mark.reset')}
          </button>
        </div>
      )}
    </div>
  );
}
