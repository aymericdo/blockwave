-- ============================================================================
-- Blockwave — migration 2026-10-28 : ajout de la notion de plateforme
--
-- À exécuter dans Supabase → SQL Editor → New query → Run.
-- Idempotente : peut être relancée sans effet de bord.
--
-- Toutes les lignes existantes deviennent des comptes Instagram. L'ancien index
-- d'unicité ne portait que sur le pseudo : il empêchait le même nom d'exister
-- sur deux réseaux, il est remplacé par un index (plateforme, pseudo).
-- ============================================================================

begin;

alter table public.accounts
  add column if not exists platform text not null default 'instagram';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_platform_check') then
    alter table public.accounts
      add constraint accounts_platform_check
      check (platform in ('instagram', 'facebook'));
  end if;
end
$$;

create unique index if not exists accounts_platform_username_unique
  on public.accounts (platform, lower(username));

drop index if exists accounts_username_unique;

drop index if exists accounts_status_idx;

create index if not exists accounts_platform_status_idx
  on public.accounts (platform, status, created_at desc);

select platform, count(*) as comptes
from public.accounts
group by platform
order by platform;

commit;
