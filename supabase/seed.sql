-- ============================================================================
-- Blockwave — liste de départ
--
-- Idempotent : peut être relancé à tout moment. Les comptes déjà présents sont
-- ignorés quel que soit leur statut (un compte rejeté le reste), les autres
-- sont insérés en `approved`.
--
-- À exécuter dans Supabase → SQL Editor, après schema.sql.
-- Pour mettre à jour la liste par défaut plus tard : ajouter les lignes ici,
-- puis relancer ce fichier.
-- ============================================================================

insert into public.accounts (username, status, reviewed_at)
values
  ('ericzemmour_',        'approved', now()),
  ('edwige_diaz',         'approved', now()),
  ('marine_lepen',        'approved', now()),
  ('vincentfou12',        'approved', now()),
  ('auroreberge.fr',      'approved', now()),
  ('voxpopuli988',        'approved', now()),
  ('va_plus',             'approved', now()),
  ('jordanflorentin_',    'approved', now()),
  ('lucasfourcadeoffi',   'approved', now()),
  ('alice_cordier_',      'approved', now()),
  ('yona.faedda',         'approved', now()),
  ('vincent.lapierre',    'approved', now()),
  ('hugonemesisdeux',     'approved', now()),
  ('tanguyjeanphilippe',  'approved', now()),
  ('julien_odoul',        'approved', now()),
  ('collectif.nemesis',   'approved', now()),
  ('sarahknafo1',         'approved', now()),
  ('frontieresmedia',     'approved', now()),
  ('jordanbardella',      'approved', now()),
  ('cnews',               'approved', now()),
  ('mc_pao',              'approved', now()),
  ('le___carlito',        'approved', now()),
  ('impact33news',        'approved', now())
on conflict (lower(username)) do nothing;

-- Contrôle : doit renvoyer 23 (ou plus si tu as approuvé d'autres comptes).
select count(*) as comptes_approuves
from public.accounts
where status = 'approved';

-- ⚠️ Si ce script dépasse 40 insertions d'un coup, le trigger anti-spam
--    (`blockwave_throttle`) le rejettera. Dans ce cas :
--      alter table public.accounts disable trigger blockwave_throttle;
--      -- … relancer l'insert …
--      alter table public.accounts enable trigger blockwave_throttle;
