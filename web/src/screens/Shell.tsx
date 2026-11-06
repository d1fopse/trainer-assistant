import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Lang, Me } from '../api';
import { NavContext, type Nav, type Route, type Tab } from '../nav';
import { bindBackButton } from '../telegram';
import { Calendar } from './Calendar';
import { AnalyticsScreen } from './Analytics';
import { Clients } from './Clients';
import { ClientCardScreen } from './ClientCard';
import { ClientForm } from './ClientForm';
import { PickClient } from './PickClient';
import { Prices } from './Prices';
import { PriceForm } from './PriceForm';
import { Profile } from './Profile';
import { SlotScreen } from './SlotScreen';
import { SlotForm } from './SlotForm';
import { SeriesForm } from './SeriesForm';
import { PassForm, PaymentForm, VisitForm } from './PaymentForm';

const TAB_ICONS: Record<Tab, string> = { calendar: '📅', clients: '👥', analytics: '📊', prices: '₴', profile: '👤' };

export function Shell({ me, onLanguage }: { me: Me; onLanguage: (l: Lang) => void }) {
  const { t } = useTranslation();
  const isTrainer = me.user.role === 'TRAINER';
  const tabs: Tab[] = isTrainer ? ['calendar', 'clients', 'analytics', 'prices', 'profile'] : ['calendar', 'prices', 'profile'];

  const [tab, setTab] = useState<Tab>(tabs[0]!);
  // Окрема історія екранів для кожної вкладки.
  const [stacks, setStacks] = useState<Record<Tab, Route[]>>({
    calendar: [{ name: 'calendar' }],
    clients: [{ name: 'clients' }],
    analytics: [{ name: 'analytics' }],
    prices: [{ name: 'prices' }],
    profile: [{ name: 'profile' }],
  });
  const stack = stacks[tab];
  const route = stack[stack.length - 1]!;

  const nav = useMemo<Nav>(
    () => ({
      push: (r) => setStacks((s) => ({ ...s, [tab]: [...s[tab], r] })),
      pop: () => setStacks((s) => ({ ...s, [tab]: s[tab].length > 1 ? s[tab].slice(0, -1) : s[tab] })),
      replace: (r) => setStacks((s) => ({ ...s, [tab]: [...s[tab].slice(0, -1), r] })),
    }),
    [tab],
  );

  const canGoBack = stack.length > 1;
  useEffect(() => {
    const unbind = bindBackButton(canGoBack ? nav.pop : null);
    return () => unbind();
  }, [canGoBack, nav]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  function selectTab(next: Tab) {
    if (next === tab) {
      // Повторне натискання на вкладку повертає до її початкового екрана.
      setStacks((s) => ({ ...s, [tab]: s[tab].slice(0, 1) }));
    } else {
      setTab(next);
    }
  }

  return (
    <NavContext.Provider value={nav}>
      <main className="content" key={`${tab}:${stack.length}:${JSON.stringify(route)}`}>
        {renderRoute(route, me, onLanguage)}
      </main>
      <nav className="tabbar">
        {tabs.map((tb) => (
          <button key={tb} className={tb === tab ? 'active' : ''} onClick={() => selectTab(tb)}>
            <span className="tab-icon" aria-hidden>
              {TAB_ICONS[tb]}
            </span>
            {t(`tabs.${tb}`)}
          </button>
        ))}
      </nav>
    </NavContext.Provider>
  );
}

function renderRoute(route: Route, me: Me, onLanguage: (l: Lang) => void) {
  const isTrainer = me.user.role === 'TRAINER';
  switch (route.name) {
    case 'calendar':
      return <Calendar isTrainer={isTrainer} canWaitlist={me.user.role === 'CLIENT'} trainerUsername={me.trainerUsername} />;
    case 'slot':
      return isTrainer ? <SlotScreen id={route.id} /> : null;
    case 'slotForm':
      return isTrainer ? <SlotForm id={route.id} date={route.date} /> : null;
    case 'seriesForm':
      return isTrainer ? <SeriesForm seriesId={route.seriesId} fromDate={route.fromDate} /> : null;
    case 'clients':
      return isTrainer ? <Clients /> : null;
    case 'analytics':
      return isTrainer ? <AnalyticsScreen /> : null;
    case 'client':
      return isTrainer ? <ClientCardScreen id={route.id} /> : null;
    case 'clientForm':
      return isTrainer ? <ClientForm id={route.id} /> : null;
    case 'pickClient':
      return isTrainer ? <PickClient {...route} /> : null;
    case 'prices':
      return <Prices isTrainer={isTrainer} trainerUsername={me.trainerUsername} />;
    case 'priceForm':
      return isTrainer ? <PriceForm id={route.id} /> : null;
    case 'paymentForm':
      return isTrainer ? <PaymentForm clientId={route.clientId} id={route.id} /> : null;
    case 'passForm':
      return isTrainer ? <PassForm clientId={route.clientId} id={route.id} /> : null;
    case 'visitForm':
      return isTrainer ? <VisitForm clientId={route.clientId} /> : null;
    case 'profile':
      return <Profile me={me} onLanguage={onLanguage} />;
  }
}
