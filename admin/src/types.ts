export type Status = 'pending' | 'approved' | 'rejected';

export const STATUSES: readonly Status[] = ['pending', 'approved', 'rejected'];

export const STATUS_LABEL: Record<Status, string> = {
  pending: 'en attente',
  approved: 'approuvé',
  rejected: 'rejeté',
};

export interface Account {
  id: string;
  username: string;
  status: Status;
  reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}
