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
--
-- La source de vérité reste la table `accounts` : la liste de secours de
-- l'extension (FALLBACK_ACCOUNTS, dans src/background.js) est un amorçage
-- dégradé figé, qui n'a pas à être complétée à chaque ajout.
--
-- Sur une base déjà en service, préférer supabase/migrations/ : le seed est
-- destiné à l'amorçage.
-- ============================================================================

begin;

-- 52 comptes dépassent le plafond de 40 insertions par heure du trigger
-- anti-spam, qui n'exempte que les administrateurs (le SQL Editor n'a pas
-- d'auth.uid()). On le coupe le temps de l'insertion : si celle-ci échoue,
-- l'erreur annule le begin et le disable avec lui, le trigger est réarmé.
alter table public.accounts disable trigger blockwave_throttle;

insert into public.accounts (username, status, reviewed_at)
values
  ('ericzemmour_',         'approved', now()),
  ('edwige_diaz',          'approved', now()),
  ('marine_lepen',         'approved', now()),
  ('vincentfou12',         'approved', now()),
  ('auroreberge.fr',       'approved', now()),
  ('voxpopuli988',         'approved', now()),
  ('va_plus',              'approved', now()),
  ('jordanflorentin_',     'approved', now()),
  ('lucasfourcadeoffi',    'approved', now()),
  ('alice_cordier_',       'approved', now()),
  ('yona.faedda',          'approved', now()),
  ('vincent.lapierre',     'approved', now()),
  ('hugonemesisdeux',      'approved', now()),
  ('tanguyjeanphilippe',   'approved', now()),
  ('julien_odoul',         'approved', now()),
  ('collectif.nemesis',    'approved', now()),
  ('sarahknafo1',          'approved', now()),
  ('frontieresmedia',      'approved', now()),
  ('jordanbardella',       'approved', now()),
  ('cnews',                'approved', now()),
  ('mc_pao',               'approved', now()),
  ('le___carlito',         'approved', now()),
  ('impact33news',         'approved', now()),
  ('emmanuelmacron',       'approved', now()),
  ('realdonaldtrump',      'approved', now()),
  ('cyrilhanouna',         'approved', now()),
  ('b.netanyahu',          'approved', now()),
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
  ('sebastien_chenu',      'approved', now()),
  ('messiha.jean',         'approved', now()),
  ('davidlisnard',         'approved', now()),
  ('charlotte_d.ornellas', 'approved', now()),
  ('buducnostsrbijeav',    'approved', now()),
  ('laurentjacobelli',     'approved', now()),
  ('nicolasbay',           'approved', now()),
  ('rachel_khan88',        'approved', now()),
  ('erik_tegner',          'approved', now()),
  ('flaviobolsonaro',      'approved', now()),
  ('tiffany_joncour',      'approved', now()),
  ('marcdefleurian',       'approved', now()),
  ('antoinegolliot',       'approved', now()),
  ('bernhardt_th',         'approved', now())
on conflict (lower(username)) do nothing;

alter table public.accounts enable trigger blockwave_throttle;

-- Contrôle : doit renvoyer 52 (ou plus si tu as approuvé d'autres comptes).
select count(*) as comptes_approuves
from public.accounts
where status = 'approved';

commit;
