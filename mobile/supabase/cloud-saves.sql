-- The game stores exactly an ID, password hash, and save. No Auth identities,
-- sessions, address fields, login history, or attempt counters.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.hns_game_saves (
  id text primary key check (id ~ '^[a-z0-9_]{3,32}$'),
  password_hash text not null,
  save bytea not null default ''::bytea check (octet_length(save)<=33554432)
);
alter table public.hns_game_saves enable row level security;
revoke all on public.hns_game_saves from public, anon, authenticated;

create or replace function public.hns_check_password(p_id text,p_password text)
returns text language plpgsql security definer set search_path = '' as $$
declare name text := lower(btrim(p_id)); stored text;
begin
  if name is null or name !~ '^[a-z0-9_]{3,32}$' or p_password is null
    or p_password !~ '^[a-f0-9]{64}$' then
    raise exception 'HNS_INVALID_CREDENTIALS' using errcode='42501';
  end if;
  select password_hash into stored from public.hns_game_saves where id=name;
  if stored is null or extensions.crypt(p_password,stored)<>stored then
    raise exception 'HNS_INVALID_CREDENTIALS' using errcode='42501';
  end if;
  return name;
end;
$$;
create or replace function public.hns_signup(p_id text,p_password text)
returns text language plpgsql security definer set search_path = '' as $$
declare name text := lower(btrim(p_id));
begin
  if name is null or name !~ '^[a-z0-9_]{3,32}$' or p_password is null
    or p_password !~ '^[a-f0-9]{64}$' then
    raise exception 'HNS_INVALID_CREDENTIALS' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(name,0));
  if exists(select 1 from public.hns_game_saves where id=name) then
    raise exception 'HNS_USERNAME_TAKEN' using errcode='23505';
  end if;
  insert into public.hns_game_saves(id,password_hash)
    values(name,extensions.crypt(p_password,extensions.gen_salt('bf',12)));
  return name;
end;
$$;
create or replace function public.hns_login(p_id text,p_password text)
returns text language plpgsql security definer set search_path = '' as $$
begin return public.hns_check_password(p_id,p_password); end;
$$;
create or replace function public.hns_read_save(p_id text,p_password text)
returns text language plpgsql security definer set search_path = '' as $$
declare owner_id text := public.hns_check_password(p_id,p_password); result text;
begin
  select encode(save,'base64') into result from public.hns_game_saves where id=owner_id;
  return result;
end;
$$;
create or replace function public.hns_write_save(p_id text,p_password text,p_data text,p_expected text)
returns void language plpgsql security definer set search_path = '' as $$
declare owner_id text := public.hns_check_password(p_id,p_password); previous bytea; incoming bytea;
begin
  if p_data is null or length(p_data)>44739244 or p_expected is null then
    raise exception 'Invalid save size or hash' using errcode='22023';
  end if;
  incoming:=decode(p_data,'base64');
  if octet_length(incoming)>33554432 then raise exception 'Save exceeds 32 MB' using errcode='22023'; end if;
  select save into previous from public.hns_game_saves where id=owner_id for update;
  if encode(sha256(previous),'hex')<>p_expected then raise exception 'HNS_SAVE_CHANGED' using errcode='P0001'; end if;
  update public.hns_game_saves set save=incoming where id=owner_id;
end;
$$;
revoke all on function public.hns_check_password(text,text) from public, anon, authenticated;
revoke all on function public.hns_signup(text,text), public.hns_login(text,text), public.hns_read_save(text,text), public.hns_write_save(text,text,text,text) from public, anon, authenticated;
grant execute on function public.hns_signup(text,text), public.hns_login(text,text), public.hns_read_save(text,text), public.hns_write_save(text,text,text,text) to anon;
-- Retire the previous, unused Auth-backed schema without losing any saves.
do $$ begin
  if to_regclass('public.hns_cloud_saves') is not null then
    if exists(select 1 from public.hns_cloud_saves) then
      raise exception 'Existing cloud saves require migration; nothing was removed';
    end if;
  end if;
end $$;
drop function if exists public.hns_read_save();
drop function if exists public.hns_write_save(text,text);
drop table if exists public.hns_cloud_saves;
commit;
