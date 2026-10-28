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

insert into public.accounts (username, platform, status, reviewed_at)
values
  ('ericzemmour_',         'instagram', 'approved', now()),
  ('edwige_diaz',          'instagram', 'approved', now()),
  ('marine_lepen',         'instagram', 'approved', now()),
  ('vincentfou12',         'instagram', 'approved', now()),
  ('auroreberge.fr',       'instagram', 'approved', now()),
  ('voxpopuli988',         'instagram', 'approved', now()),
  ('va_plus',              'instagram', 'approved', now()),
  ('jordanflorentin_',     'instagram', 'approved', now()),
  ('lucasfourcadeoffi',    'instagram', 'approved', now()),
  ('alice_cordier_',       'instagram', 'approved', now()),
  ('yona.faedda',          'instagram', 'approved', now()),
  ('vincent.lapierre',     'instagram', 'approved', now()),
  ('hugonemesisdeux',      'instagram', 'approved', now()),
  ('tanguyjeanphilippe',   'instagram', 'approved', now()),
  ('julien_odoul',         'instagram', 'approved', now()),
  ('collectif.nemesis',    'instagram', 'approved', now()),
  ('sarahknafo1',          'instagram', 'approved', now()),
  ('frontieresmedia',      'instagram', 'approved', now()),
  ('jordanbardella',       'instagram', 'approved', now()),
  ('cnews',                'instagram', 'approved', now()),
  ('mc_pao',               'instagram', 'approved', now()),
  ('le___carlito',         'instagram', 'approved', now()),
  ('impact33news',         'instagram', 'approved', now()),
  ('emmanuelmacron',       'instagram', 'approved', now()),
  ('realdonaldtrump',      'instagram', 'approved', now()),
  ('cyrilhanouna',         'instagram', 'approved', now()),
  ('b.netanyahu',          'instagram', 'approved', now()),
  ('gerald_darmanin',      'instagram', 'approved', now()),
  ('giorgiameloni',        'instagram', 'approved', now()),
  ('jairmessiasbolsonaro', 'instagram', 'approved', now()),
  ('orbanviktor',          'instagram', 'approved', now()),
  ('javiermilei',          'instagram', 'approved', now()),
  ('marionmarechal_',      'instagram', 'approved', now()),
  ('bruno_retailleau',     'instagram', 'approved', now()),
  ('laurentnunezmi',       'instagram', 'approved', now()),
  ('eciotti',              'instagram', 'approved', now()),
  ('pascalpraud',          'instagram', 'approved', now()),
  ('f_philippot',          'instagram', 'approved', now()),
  ('sebastien_chenu',      'instagram', 'approved', now()),
  ('messiha.jean',         'instagram', 'approved', now()),
  ('davidlisnard',         'instagram', 'approved', now()),
  ('charlotte_d.ornellas', 'instagram', 'approved', now()),
  ('buducnostsrbijeav',    'instagram', 'approved', now()),
  ('laurentjacobelli',     'instagram', 'approved', now()),
  ('nicolasbay',           'instagram', 'approved', now()),
  ('rachel_khan88',        'instagram', 'approved', now()),
  ('erik_tegner',          'instagram', 'approved', now()),
  ('flaviobolsonaro',      'instagram', 'approved', now()),
  ('tiffany_joncour',      'instagram', 'approved', now()),
  ('marcdefleurian',       'instagram', 'approved', now()),
  ('antoinegolliot',       'instagram', 'approved', now()),
  ('bernhardt_th',         'instagram', 'approved', now())
on conflict (platform, lower(username)) do nothing;

alter table public.accounts enable trigger blockwave_throttle;

-- Contrôle : doit renvoyer 52 (ou plus si tu as approuvé d'autres comptes).
select count(*) as comptes_approuves
from public.accounts
where status = 'approved';

commit;
