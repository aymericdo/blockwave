-- ============================================================================
-- Blockwave — migration 2026-10-29 : ouverture du scope à X (Twitter)
--
-- À exécuter dans Supabase → SQL Editor → New query → Run.
-- Idempotente : peut être relancée sans effet de bord.
--
-- La contrainte de plateforme n'acceptait que 'instagram' et 'facebook' : sans
-- cette mise à jour, toute soumission ou tout ajout depuis l'extension pour
-- x.com serait rejeté par la base, quel que soit l'état de la console.
--
-- Aucun compte n'est ajouté ici : cette migration ne fait qu'autoriser la
-- nouvelle plateforme. La liste viendra par une migration d'ajout dédiée.
-- ============================================================================

begin;

-- `add constraint if not exists` n'existe pas : on remplace, ce qui reste
-- idempotent et ne dépend pas du nom donné par une exécution antérieure.
alter table public.accounts drop constraint if exists accounts_platform_check;

alter table public.accounts
  add constraint accounts_platform_check
  check (platform in ('instagram', 'facebook', 'twitter'));

select platform, count(*) as comptes
from public.accounts
group by platform
order by platform;

commit;
