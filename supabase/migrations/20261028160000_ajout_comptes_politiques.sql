-- ============================================================================
-- Blockwave — migration 2026-10-28 : 36 comptes ajoutés à la liste publique
--
-- À exécuter dans Supabase → SQL Editor → New query → Run, après schema.sql.
--
-- Idempotente : les comptes déjà présents sont ignorés, quel que soit leur
-- statut (un compte rejeté n'est donc pas réhabilité par cette migration).
-- 7 des 36 pseudos figurent déjà dans seed.sql ; ils sont répétés ici pour que
-- la migration soit autosuffisante sur une base amorcée avant cette date.
--
-- La liste est reprise à l'identique dans supabase/seed.sql (amorçage d'une
-- base neuve). La liste de secours embarquée dans l'extension n'a pas à être
-- complétée : c'est un amorçage dégradé figé, pas un miroir de la base.
-- ============================================================================

begin;

-- Le trigger anti-spam plafonne à 40 insertions par heure et n'exempte que les
-- administrateurs — or le SQL Editor n'a pas d'auth.uid(), donc is_admin() est
-- faux et un ajout en masse serait refusé au 41e compte de la dernière heure.
-- On le coupe le temps de l'insertion ; begin/commit garantit qu'il est réarmé
-- même si celle-ci échoue (l'échec annule aussi le disable).
alter table public.accounts disable trigger blockwave_throttle;

insert into public.accounts (username, status, reviewed_at)
values
  ('emmanuelmacron',       'approved', now()),
  ('realdonaldtrump',      'approved', now()),
  ('marine_lepen',         'approved', now()),
  ('jordanbardella',       'approved', now()),
  ('cyrilhanouna',         'approved', now()),
  ('b.netanyahu',          'approved', now()),
  ('ericzemmour_',         'approved', now()),
  ('gerald_darmanin',      'approved', now()),
  ('giorgiameloni',        'approved', now()),
  ('jairmessiasbolsonaro', 'approved', now()),
  ('orbanviktor',          'approved', now()),
  ('javiermilei',          'approved', now()),
  ('marionmarechal_',      'approved', now()),
  ('bruno_retailleau',     'approved', now()),
  ('laurentnunezmi',       'approved', now()),
  ('eciotti',              'approved', now()),
  ('pascalpraud',          'approved', now()),
  ('f_philippot',          'approved', now()),
  ('sarahknafo1',          'approved', now()),
  ('sebastien_chenu',      'approved', now()),
  ('julien_odoul',         'approved', now()),
  ('messiha.jean',         'approved', now()),
  ('davidlisnard',         'approved', now()),
  ('charlotte_d.ornellas', 'approved', now()),
  ('buducnostsrbijeav',    'approved', now()),
  ('laurentjacobelli',     'approved', now()),
  ('tanguyjeanphilippe',   'approved', now()),
  ('nicolasbay',           'approved', now()),
  ('rachel_khan88',        'approved', now()),
  ('erik_tegner',          'approved', now()),
  ('edwige_diaz',          'approved', now()),
  ('flaviobolsonaro',      'approved', now()),
  ('tiffany_joncour',      'approved', now()),
  ('marcdefleurian',       'approved', now()),
  ('antoinegolliot',       'approved', now()),
  ('bernhardt_th',         'approved', now())
on conflict (lower(username)) do nothing;

alter table public.accounts enable trigger blockwave_throttle;

select count(*) as comptes_approuves
from public.accounts
where status = 'approved';

commit;
