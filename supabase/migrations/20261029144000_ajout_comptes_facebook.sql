-- ============================================================================
-- Blockwave — migration 2026-10-29 : 43 comptes Facebook ajoutés d'un coup
--
-- À exécuter dans Supabase → SQL Editor → New query → Run.
--
-- Idempotente : les comptes déjà présents sont ignorés, quel que soit leur
-- statut (un compte rejeté n'est donc pas réhabilité par cette migration).
-- La liste ne contient que des comptes Facebook : le même pseudo peut déjà
-- exister en Instagram sans que cela crée de conflit, l'unicité portant sur le
-- couple (plateforme, pseudo).
--
-- Certaines entrées sont des identifiants numériques de Page (profils dont le
-- nom d'utilisateur n'est pas exposé). Ils sont acceptés par la contrainte
-- accounts_username_format, qui autorise les chiffres.
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

insert into public.accounts (username, platform, status, reviewed_at)
values
  ('100087171534178',         'facebook',  'approved', now()),
  ('61550124326143',          'facebook',  'approved', now()),
  ('61583955686477',          'facebook',  'approved', now()),
  ('bassem.officiel',         'facebook',  'approved', now()),
  ('bfmtv',                   'facebook',  'approved', now()),
  ('brunoretailleau',         'facebook',  'approved', now()),
  ('carolineparmentier6209',  'facebook',  'approved', now()),
  ('causeur',                 'facebook',  'approved', now()),
  ('charlesalloncle',         'facebook',  'approved', now()),
  ('charlottedornellas',      'facebook',  'approved', now()),
  ('cnewsofficiel',           'facebook',  'approved', now()),
  ('cyrilhanounaofficiel',    'facebook',  'approved', now()),
  ('eugeniebastiefigaro',     'facebook',  'approved', now()),
  ('europe1',                 'facebook',  'approved', now()),
  ('fdesouche',               'facebook',  'approved', now()),
  ('florentinjordan',         'facebook',  'approved', now()),
  ('franckferrandofficiel',   'facebook',  'approved', now()),
  ('frontieresmedia',         'facebook',  'approved', now()),
  ('geoffroylejeuneva',       'facebook',  'approved', now()),
  ('glbouchez',               'facebook',  'approved', now()),
  ('jordanbardella',          'facebook',  'approved', now()),
  ('jrochedy',                'facebook',  'approved', now()),
  ('lejdd',                   'facebook',  'approved', now()),
  ('les.republicains.fr',     'facebook',  'approved', now()),
  ('marinelepen',             'facebook',  'approved', now()),
  ('marionmarechaloff',       'facebook',  'approved', now()),
  ('mathieu.bockcote.7',      'facebook',  'approved', now()),
  ('matthieu.valet59',        'facebook',  'approved', now()),
  ('messihajean',             'facebook',  'approved', now()),
  ('obertone.laurent',        'facebook',  'approved', now()),
  ('odouljulien',             'facebook',  'approved', now()),
  ('patriotsep',              'facebook',  'approved', now()),
  ('patriotseu',              'facebook',  'approved', now()),
  ('radiocourtoisie',         'facebook',  'approved', now()),
  ('raptorvswild',            'facebook',  'approved', now()),
  ('rassemblementnational',   'facebook',  'approved', now()),
  ('reconquete2022',          'facebook',  'approved', now()),
  ('tanguyfr',                'facebook',  'approved', now()),
  ('tbt9w9',                  'facebook',  'approved', now()),
  ('valeursactuelles.page',   'facebook',  'approved', now()),
  ('vincentlapierre',         'facebook',  'approved', now()),
  ('yoanngillet30',           'facebook',  'approved', now()),
  ('zemmoureric',             'facebook',  'approved', now())
on conflict (platform, lower(username)) do nothing;

alter table public.accounts enable trigger blockwave_throttle;

-- Contrôle : combien de comptes approuvés par plateforme après migration.
select platform, count(*) as comptes_approuves
from public.accounts
where status = 'approved'
group by platform
order by platform;

commit;
