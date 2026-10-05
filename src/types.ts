export type Rarity = 'Обычная' | 'Редкая' | 'Эпическая' | 'Легендарная' | 'Особо важная' | 'Золотая';

export interface User {
  id: number;
  telegram_id: number;
  username: string;
  first_name: string;
  avatar_url?: string | null;
  balance: number;
  rating: number;
  rank_name: string;
  next_rank_at: number | null;
  rank_progress: number;
}

export interface Statement {
  id: number;
  category: string;
  location: string;
  description: string;
  score: number;
  rarity: Rarity;
  value: number;
  created_at: string;
  is_active: number;
}

export interface LeaderRow {
  place: number;
  username: string;
  first_name: string;
  rating: number;
  is_me?: boolean;
}

export interface Stats {
  statements: number;
  avg_score: number;
  best_score: number;
  upgrades: number;
  upgrade_wins: number;
  spins: number;
  place: number;
}

export interface MePayload {
  user: User;
  stats: Stats;
  wheel: { freeAvailable: boolean; nextFreeAt: string | null; paidCost: number };
}
