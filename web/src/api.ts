import { getAuthHeader } from './telegram';

export type Role = 'TRAINER' | 'CLIENT' | 'GUEST';
export type Lang = 'uk' | 'ru';
export type ClientStatus = 'GUEST' | 'ACTIVE' | 'INACTIVE';
export type PriceKind = 'SINGLE' | 'PASS';

export const GOALS = ['weight_loss', 'muscle_gain', 'strength', 'health', 'other'] as const;
export const LEVELS = ['none', 'beginner', 'intermediate', 'advanced'] as const;

export type Me = {
  user: { id: number; role: Role; language: Lang; firstName: string | null };
  client: { id: number; name: string; status: ClientStatus } | null;
  needsOnboarding: boolean;
  trainerUsername: string | null;
};

export type OnboardingPayload = {
  name: string;
  phone?: string;
  goal: string;
  experience: string;
  health?: string;
  injuries?: string;
  consent: true;
};

export type ClientListItem = {
  id: number;
  name: string;
  phone: string | null;
  status: ClientStatus;
  username: string | null;
  hasTelegram: boolean;
  createdAt: string;
};

export type ClientCard = {
  id: number;
  name: string;
  phone: string | null;
  status: ClientStatus;
  goal: string | null;
  experience: string | null;
  health: string | null;
  injuries: string | null;
  consentAt: string | null;
  trainerNotes: string | null;
  referredByClientId: number | null;
  createdAt: string;
  telegram: { username: string | null; firstName: string | null } | null;
  referredBy: { id: number; name: string } | null;
  referrals: { id: number; name: string }[];
};

export type ClientInput = Partial<{
  name: string;
  phone: string;
  status: ClientStatus;
  goal: string | null;
  experience: string | null;
  health: string;
  injuries: string;
  trainerNotes: string;
  referredByClientId: number | null;
}>;

export type Price = {
  id: number;
  kind: PriceKind;
  titleUk: string;
  titleRu: string | null;
  descriptionUk: string | null;
  descriptionRu: string | null;
  priceUah: number;
  sessionsCount: number | null;
  sortOrder: number;
  isVisible: boolean;
};

export type PriceInput = {
  kind: PriceKind;
  titleUk: string;
  titleRu: string;
  descriptionUk: string;
  descriptionRu: string;
  priceUah: number;
  sessionsCount: number | null;
  isVisible: boolean;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code?: string,
    public body?: Record<string, unknown>,
  ) {
    super(`API error ${status}${code ? `: ${code}` : ''}`);
  }
}

const base = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = getAuthHeader();
  if (!auth) throw new ApiError(401);
  const res = await fetch(base + path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: auth,
      ...init.headers,
    },
  });
  if (!res.ok) {
    let body: Record<string, unknown> | undefined;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* тіла може не бути */
    }
    throw new ApiError(res.status, typeof body?.error === 'string' ? body.error : undefined, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  me: () => request<Me>('/api/me'),
  setLanguage: (language: Lang) => request<{ language: Lang }>('/api/me/language', json('PATCH', { language })),
  submitOnboarding: (payload: OnboardingPayload) => request<unknown>('/api/onboarding', json('POST', payload)),

  clients: (params: { status?: ClientStatus; q?: string; withTelegram?: boolean; withoutTelegram?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.q) qs.set('q', params.q);
    if (params.withTelegram) qs.set('withTelegram', 'true');
    if (params.withoutTelegram) qs.set('withoutTelegram', 'true');
    const s = qs.toString();
    return request<{ clients: ClientListItem[] }>(`/api/clients${s ? `?${s}` : ''}`).then((r) => r.clients);
  },
  client: (id: number) => request<{ client: ClientCard }>(`/api/clients/${id}`).then((r) => r.client),
  createClient: (body: ClientInput) =>
    request<{ client: ClientCard }>('/api/clients', json('POST', body)).then((r) => r.client),
  updateClient: (id: number, body: ClientInput) =>
    request<{ client: ClientCard }>(`/api/clients/${id}`, json('PATCH', body)).then((r) => r.client),
  linkClient: (targetId: number, sourceClientId: number) =>
    request<{ client: ClientCard }>(`/api/clients/${targetId}/link`, json('POST', { sourceClientId })).then(
      (r) => r.client,
    ),

  prices: () => request<{ prices: Price[] }>('/api/prices').then((r) => r.prices),
  createPrice: (body: PriceInput) => request<{ price: Price }>('/api/prices', json('POST', body)).then((r) => r.price),
  updatePrice: (id: number, body: Partial<PriceInput>) =>
    request<{ price: Price }>(`/api/prices/${id}`, json('PATCH', body)).then((r) => r.price),
  deletePrice: (id: number) => request<void>(`/api/prices/${id}`, { method: 'DELETE' }),
  reorderPrices: (ids: number[]) =>
    request<{ prices: Price[] }>('/api/prices/order', json('PUT', { ids })).then((r) => r.prices),
};

// ---------- Календар (етап 3) ----------

export type SlotType = 'INDIVIDUAL' | 'GROUP';
export type BookingStatus = 'BOOKED' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED';

export type SlotBooking = {
  id: number;
  clientId: number;
  name: string;
  status: BookingStatus;
  isTrial: boolean;
};

export type TrainerSlot = {
  id: number;
  startsAt: string;
  durationMin: number;
  type: SlotType;
  capacity: number;
  status: 'OPEN' | 'CANCELLED';
  seriesId: number | null;
  note: string | null;
  bookings: SlotBooking[];
  bookedCount: number;
};

export type PublicSlot = {
  id: number;
  startsAt: string;
  durationMin: number;
  type: SlotType;
  capacity: number;
  freeSeats: number;
  mine: boolean;
};

export type SeriesInfo = {
  id: number;
  clientId: number;
  weekdays: number[];
  startTime: string;
  durationMin: number;
  startDate: string;
  endDate: string;
};

export type Overlap = { id: number; startsAt: string; durationMin: number; type: SlotType };

export type SlotCreate = {
  startsAt: string;
  durationMin: number;
  type: SlotType;
  capacity?: number;
  note?: string;
  clientIds?: number[];
  isTrial?: boolean;
  force?: boolean;
};

export type SeriesCreate = {
  clientId: number;
  weekdays: number[];
  startTime: string;
  durationMin: number;
  startDate: string;
  endDate: string;
};

export type SeriesResult = { series: SeriesInfo; created: number; skipped: string[] };

/** Деталі помилки 409 overlap. */
export async function readErrorBody(e: unknown): Promise<Record<string, unknown> | null> {
  return e instanceof ApiError ? (e.body ?? null) : null;
}

export const calendarApi = {
  trainerRange: (from: string, to: string) =>
    request<{ slots: TrainerSlot[] }>(`/api/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then(
      (r) => r.slots,
    ),
  publicRange: (from: string, to: string) =>
    request<{ slots: PublicSlot[] }>(`/api/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then(
      (r) => r.slots,
    ),
  slot: (id: number) => request<{ slot: TrainerSlot }>(`/api/slots/${id}`).then((r) => r.slot),
  createSlot: (body: SlotCreate) => request<{ slot: TrainerSlot }>('/api/slots', json('POST', body)).then((r) => r.slot),
  updateSlot: (
    id: number,
    body: Partial<{ startsAt: string; durationMin: number; capacity: number; note: string | null; force: boolean }>,
  ) => request<{ slot: TrainerSlot }>(`/api/slots/${id}`, json('PATCH', body)).then((r) => r.slot),
  cancelSlot: (id: number) => request<{ ok: true }>(`/api/slots/${id}/cancel`, { method: 'POST' }),
  addBooking: (slotId: number, clientId: number, isTrial = false) =>
    request<{ slot: TrainerSlot }>(`/api/slots/${slotId}/bookings`, json('POST', { clientId, isTrial })).then((r) => r.slot),
  cancelBooking: (id: number) =>
    request<{ slot: TrainerSlot }>(`/api/bookings/${id}`, json('PATCH', { status: 'CANCELLED' })).then((r) => r.slot),
  createSeries: (body: SeriesCreate) => request<SeriesResult>('/api/series', json('POST', body)),
  series: (id: number) => request<{ series: SeriesInfo }>(`/api/series/${id}`).then((r) => r.series),
  cancelSeries: (id: number, fromDate: string) =>
    request<{ cancelled: number }>(`/api/series/${id}/cancel`, json('POST', { fromDate })),
  splitSeries: (id: number, body: Omit<SeriesCreate, 'clientId' | 'startDate'> & { fromDate: string }) =>
    request<SeriesResult>(`/api/series/${id}/split`, json('POST', body)),
  copyWeek: (from: string, to: string) =>
    request<{ created: number; skipped: string[] }>('/api/calendar/copy-week', json('POST', { from, to })),
};
