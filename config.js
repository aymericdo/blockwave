/* Blockwave — configuration partagée (extension + pages web).
 *
 * Les deux valeurs ci-dessous sont PUBLIQUES par construction : une clé `anon`
 * Supabase est faite pour être servie dans un navigateur. Toute la sécurité
 * repose sur les politiques RLS de `supabase/schema.sql`, jamais sur le secret.
 *
 * ⚠️ Ne JAMAIS mettre ici la clé `service_role` : elle contourne la RLS.
 */

export const CONFIG = {
  /** Ex. https://abcdefghijklmnop.supabase.co (Supabase → Settings → API) */
  supabaseUrl: 'https://fbxtqwjrftgzfppmbuhi.supabase.co',

  /** Clé publique « anon » / « publishable » (même écran). */
  supabaseAnonKey: 'sb_publishable_GX1qlE6JL6Qh57HkK5HGKw_pCu544QF',

  /** Durée de validité du cache de liste dans l'extension. */
  listTtlMs: 6 * 60 * 60 * 1000,

  /**
   * Garde-fou : nombre maximum de comptes traités en une seule exécution.
   * À ~15 s par compte, 250 comptes représentent déjà une heure de navigation.
   */
  maxPerRun: 250,
};
