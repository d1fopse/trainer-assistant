import { useTranslation } from 'react-i18next';
import { api, type ClientListItem } from '../api';
import { useLoad } from '../ui';

/** Випадний список клієнтів (без архівних). */
export function useClientOptions() {
  return useLoad(() => api.clients().then((all) => all.filter((c) => c.status !== 'INACTIVE')), []);
}

export function ClientSelect({
  value,
  onChange,
  options,
  exclude = [],
  emptyLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ClientListItem[] | null;
  exclude?: number[];
  emptyLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel ?? t('slot.pickClient')}</option>
      {(options ?? [])
        .filter((c) => !exclude.includes(c.id))
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.status === 'GUEST' ? ` · ${t('status.GUEST')}` : ''}
            {c.phone ? ` · ${c.phone}` : ''}
          </option>
        ))}
    </select>
  );
}
