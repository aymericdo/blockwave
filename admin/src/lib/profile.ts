import type { Platform } from '../types';

const HOST: Record<Platform, string> = {
  instagram: 'https://www.instagram.com',
  facebook: 'https://www.facebook.com',
};

export function profileUrl(platform: Platform, username: string): string {
  return `${HOST[platform]}/${encodeURIComponent(username)}/`;
}
