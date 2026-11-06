import { createContext, useContext } from 'react';

export type Tab = 'calendar' | 'clients' | 'prices' | 'profile';

export type Route =
  | { name: 'calendar' }
  | { name: 'slot'; id: number }
  | { name: 'slotForm'; id?: number; date?: string }
  | { name: 'seriesForm'; seriesId: number; fromDate: string }
  | { name: 'clients' }
  | { name: 'prices' }
  | { name: 'profile' }
  | { name: 'client'; id: number }
  | { name: 'clientForm'; id?: number }
  | { name: 'pickClient'; mode: 'guestFor' | 'manualFor'; clientId: number; clientName: string }
  | { name: 'priceForm'; id?: number }
  | { name: 'paymentForm'; clientId: number; id?: number }
  | { name: 'passForm'; clientId: number; id?: number }
  | { name: 'visitForm'; clientId: number };

export type Nav = {
  push(route: Route): void;
  pop(): void;
  /** Замінює поточний екран (без додавання в історію). */
  replace(route: Route): void;
};

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside NavContext');
  return nav;
}
