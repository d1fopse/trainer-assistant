import { getAuthHeader } from './telegram';

export type Role = 'TRAINER' | 'CLIENT' | 'GUEST';
export type Lang = 'uk' | 'ru';

export type Me = {
  user: { id: number; role: Role; language: Lang; firstName: string | null };
  client: { id: number; name: string; status: 'GUEST' | 'ACTIVE' | 'INACTIVE' } | null;
  needsOnboarding: boolean;
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

export class ApiError extends Error {
  constructor(public status: number) {
    super(`API error ${status}`);
  }
}

const base = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = getAuthHeader();
  if (!auth) throw new ApiError(401);
  const res = await fetch(base + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
      ...init.headers,
    },
  });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

export const api = {
  me: () => request<Me>('/api/me'),
  setLanguage: (language: Lang) =>
    request<{ language: Lang }>('/api/me/language', {
      method: 'PATCH',
      body: JSON.stringify({ language }),
    }),
  submitOnboarding: (payload: OnboardingPayload) =>
    request<unknown>('/api/onboarding', { method: 'POST', body: JSON.stringify(payload) }),
};
