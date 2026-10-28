export type Status = 'pending' | 'approved' | 'rejected';

export const STATUSES: readonly Status[] = ['pending', 'approved', 'rejected'];

export const STATUS_LABEL: Record<Status, string> = {
  pending: 'en attente',
  approved: 'approuvé',
  rejected: 'rejeté',
};

export type Platform = 'instagram' | 'facebook';

export const PLATFORMS: readonly Platform[] = ['instagram', 'facebook'];

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
};

/** `all` n'est pas une plateforme : c'est l'absence de filtre. */
export type PlatformFilter = Platform | 'all';

export interface Account {
  id: string;
  platform: Platform;
  username: string;
  status: Status;
  reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}
