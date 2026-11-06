import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type Lang, type Me } from './api';
import { getAuthHeader } from './telegram';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';

type State =
  | { kind: 'loading' }
  | { kind: 'no-telegram' }
  | { kind: 'error' }
  | { kind: 'ready'; me: Me };

export function App() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!getAuthHeader()) {
      setState({ kind: 'no-telegram' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const me = await api.me();
      await i18n.changeLanguage(me.user.language);
      setState({ kind: 'ready', me });
    } catch (e) {
      setState(e instanceof ApiError && e.status === 401 ? { kind: 'no-telegram' } : { kind: 'error' });
    }
  }, [i18n]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeLanguage(lang: Lang) {
    await i18n.changeLanguage(lang);
    try {
      await api.setLanguage(lang);
    } catch {
      /* мова вже змінена локально; збережеться при наступній зміні */
    }
  }

  switch (state.kind) {
    case 'loading':
      return <div className="screen center muted">{t('common.loading')}</div>;
    case 'no-telegram':
      return <div className="screen center">{t('errors.openInTelegram')}</div>;
    case 'error':
      return (
        <div className="screen center">
          <p>{t('errors.load')}</p>
          <button onClick={() => void load()}>{t('common.retry')}</button>
        </div>
      );
    case 'ready':
      return state.me.needsOnboarding ? (
        <Onboarding onDone={() => void load()} />
      ) : (
        <Home me={state.me} onLanguage={(l) => void changeLanguage(l)} />
      );
  }
}
