import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';

export const configured = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

/* La clé `anon` est publique par conception : toute la protection vient des
 * politiques RLS de supabase/schema.sql, pas du secret. */
export const supabase = configured
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
  : null;
