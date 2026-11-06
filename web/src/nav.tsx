import { createContext, useContext } from 'react';

export type Tab = 'clients' | 'prices' | 'profile';

export type Route =
  | { name: 'clients' }
  | { name: 'prices' }
  | { name: 'profile' }
  | { name: 'client'; id: number }
  | { name: 'clientForm'; id?: number }
  | { name: 'pickClient'; mode: 'guestFor' | 'manualFor'; clientId: number; clientName: string }
  | { name: 'priceForm'; id?: number };

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
