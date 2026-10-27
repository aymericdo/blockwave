-- ============================================================================
-- Blockwave — schéma Supabase
--
-- À exécuter dans Supabase → SQL Editor → New query → Run.
-- Le script est idempotent : tu peux le relancer sans casser l'existant.
--
-- Modèle de sécurité
--   anon           peut INSÉRER des lignes, mais uniquement en status 'pending'
--                  et ne peut LIRE que les lignes 'approved'
--   authenticated  idem, sauf s'il est dans public.admins (via is_admin())
--   admins         illisible en direct (RLS active, aucune politique) ;
--                  interrogée uniquement par is_admin() en SECURITY DEFINER
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Table des comptes
-- ----------------------------------------------------------------------------
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  username    text not null,
  status      text not null default 'pending',
  reason      text,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null
);

-- Contraintes ajoutées séparément pour rester idempotent.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_status_check') then
    alter table public.accounts
      add constraint accounts_status_check
      check (status in ('pending', 'approved', 'rejected'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'accounts_username_format') then
    alter table public.accounts
      add constraint accounts_username_format
      check (username ~ '^[A-Za-z0-9._]{1,30}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'accounts_reason_length') then
    alter table public.accounts
      add constraint accounts_reason_length
      check (reason is null or char_length(reason) <= 280);
  end if;
end
$$;

-- Unicité insensible à la casse : "@Marine_Lepen" et "marine_lepen" sont le
-- même compte. C'est aussi ce qui protège des doublons de soumission.
create unique index if not exists accounts_username_unique
  on public.accounts (lower(username));

create index if not exists accounts_status_idx
  on public.accounts (status, created_at desc);

-- ----------------------------------------------------------------------------
-- 2. Liste des administrateurs
-- ----------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Aucune politique n'est créée : la table est totalement inaccessible en direct,
-- y compris pour un utilisateur connecté. On passe uniquement par is_admin().
revoke all on public.admins from anon, authenticated;

-- SECURITY DEFINER : s'exécute avec les droits du propriétaire, donc la RLS
-- de public.admins ne s'applique pas ici. Le `search_path` figé évite les
-- attaques par détournement de schéma.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. RLS sur accounts
-- ----------------------------------------------------------------------------
alter table public.accounts enable row level security;

grant select, insert, update, delete on public.accounts to anon, authenticated;

-- Lecture : un visiteur ne voit que les comptes approuvés.
drop policy if exists accounts_read_approved on public.accounts;
create policy accounts_read_approved on public.accounts
  for select to anon, authenticated
  using (status = 'approved' or public.is_admin());

-- Soumission : impossible de s'auto-approuver. Même en forgeant la requête
-- POST, le `with check` refuse tout status différent de 'pending'.
drop policy if exists accounts_submit on public.accounts;
create policy accounts_submit on public.accounts
  for insert to anon, authenticated
  with check (
    status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
  );

drop policy if exists accounts_admin_update on public.accounts;
create policy accounts_admin_update on public.accounts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists accounts_admin_delete on public.accounts;
create policy accounts_admin_delete on public.accounts
  for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 4. Garde-fou anti-spam
--    Plafond global : au-delà de 40 soumissions sur une heure, tout est refusé.
--    Volontairement global (et non par IP) car Supabase ne l'expose pas au SQL.
-- ----------------------------------------------------------------------------
create or replace function public.blockwave_throttle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*) from public.accounts
    where created_at > now() - interval '1 hour'
  ) >= 40 then
    raise exception 'Trop de soumissions récentes, réessaie plus tard.';
  end if;
  return new;
end;
$$;

drop trigger if exists blockwave_throttle on public.accounts;
create trigger blockwave_throttle
  before insert on public.accounts
  for each row execute function public.blockwave_throttle();

-- ----------------------------------------------------------------------------
-- 5. Liste de départ (les 6 comptes déjà en dur dans l'extension)
-- ----------------------------------------------------------------------------
insert into public.accounts (username, status, reviewed_at)
values
  ('jordanbardella',     'approved', now()),
  ('marine_lepen',       'approved', now()),
  ('edwige_diaz',        'approved', now()),
  ('ericzemmour_',       'approved', now()),
  ('sarahknafo1',        'approved', now()),
  ('tanguyjeanphilippe', 'approved', now())
on conflict (lower(username)) do nothing;

-- ----------------------------------------------------------------------------
-- 6. Toi, administrateur
--
-- ⚠️ À faire APRÈS t'être connecté une première fois à web/admin.html
--    (le clic sur le lien magique crée la ligne dans auth.users).
--    Décommente, remplace l'e-mail, puis exécute.
-- ----------------------------------------------------------------------------
-- insert into public.admins (user_id, email)
-- select id, email from auth.users where email = 'toi@exemple.com'
-- on conflict (user_id) do nothing;
