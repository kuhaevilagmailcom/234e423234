import type { AdminStatement, LeaderRow, MePayload, Statement } from './types';

const tg = window.Telegram?.WebApp;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (tg?.initData) headers.set('X-Telegram-Init-Data', tg.initData);
  const res = await fetch(path, { ...options, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Ошибка запроса');
  return json as T;
}

export const api = {
  me: () => request<MePayload>('/api/me'),
  reasons: () => request<{ reasons: string[]; locations: string[] }>('/api/reasons'),
  statements: () => request<{ statements: Statement[] }>('/api/statements'),
  createStatement: (payload: {
    category: string;
    location: string;
    description: string;
    targetUserId?: number | null;
    targetUsername?: string | null;
    targetName: string;
  }) => request<{ statement: Statement; reward: { rating: number; balance: number }; phrase: string }>(
    '/api/statements',
    { method: 'POST', body: JSON.stringify(payload) }
  ),
  upgradePreview: (sourceId: number, multiplier: number) =>
    request<{ source: Statement; targetValue: number; chance: number }>('/api/upgrades/preview', { method: 'POST', body: JSON.stringify({ sourceId, multiplier }) }),
  upgrade: (sourceId: number, multiplier: number) =>
    request<{ success: boolean; chance: number; finalAngle: number; targetValue: number; statement?: Statement }>('/api/upgrades', { method: 'POST', body: JSON.stringify({ sourceId, multiplier }) }),
  spin: () => request<{ reward: { label: string; type: string; value: number }; segmentIndex: number; paid: boolean }>('/api/wheel/spin', { method: 'POST' }),
  leaderboard: (period: string) => request<{ rows: LeaderRow[]; myPlace: number; myRating: number }>(`/api/leaderboard?period=${period}`),
  adminStatements: (q = '') => request<{ statements: AdminStatement[] }>(`/api/admin/statements?q=${encodeURIComponent(q)}`),
};
