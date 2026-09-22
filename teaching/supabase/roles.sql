-- Teaching roles upgrade. Existing project: run this file only in Supabase SQL Editor.
-- Fresh project: run schema.sql first.
begin;

-- CONFIGURATION: change only this email for your deployment.
-- Use an existing public.admins email. An existing global admin is kept on reruns.
set local teaching.global_admin_email = 'bplaku@epoka.edu.al';

-- No edits needed below. Existing course data, public reads, Google sign-in and
-- timetable policies stay intact. The setting above lasts only for this transaction.

create schema if not exists teaching_private;
revoke all on schema teaching_private from public, anon, authenticated;

create table if not exists public.teaching_accounts (
  email text primary key check (email = lower(btrim(email))),
  name text not null default '',
  google_name_anchor text not null default '',
  role text not null check (role in ('global_admin','admin','lecturer','student','disabled'))
);
-- Keep the first verified Google name for professor matching; display names may change.
alter table public.teaching_accounts add column if not exists google_name_anchor text not null default '';
create table if not exists public.teaching_assignments (
  email text not null references public.teaching_accounts(email) on delete cascade,
  sheet_name text not null,
  is_archive boolean not null default false,
  primary key (email, sheet_name, is_archive)
);
create table if not exists teaching_private.professor_bindings (
  email text not null,
  sheet_name text not null,
  is_archive boolean not null,
  professor_key text not null,
  name_row_uid text not null references public.course_rows(row_uid) on update cascade on delete cascade,
  primary key (email, sheet_name, is_archive, professor_key),
  foreign key (email, sheet_name, is_archive)
    references public.teaching_assignments(email, sheet_name, is_archive) on update cascade on delete cascade
);
alter table public.teaching_accounts enable row level security;
alter table public.teaching_assignments enable row level security;
alter table teaching_private.professor_bindings enable row level security;
revoke all on public.teaching_accounts, public.teaching_assignments from public, anon, authenticated;
revoke all on all tables in schema teaching_private from public, anon, authenticated;
-- The old allowlist remains SQL-managed for the separate timetable application.
revoke insert, update, delete, truncate on public.admins from public, anon, authenticated;

insert into public.teaching_accounts(email, name, role)
select lower(btrim(email)), '', 'admin' from public.admins
on conflict (email) do nothing;
-- Only bootstrap an EXISTING administrator; never give a visitor a claim-owner endpoint.
update public.teaching_accounts set role = 'global_admin'
where email = lower(btrim(current_setting('teaching.global_admin_email')))
  and exists (select 1 from public.admins
    where lower(btrim(email)) = lower(btrim(current_setting('teaching.global_admin_email'))))
  and not exists (select 1 from public.teaching_accounts where role = 'global_admin');
do $$ begin
  if not exists (select 1 from public.teaching_accounts where role = 'global_admin') then
    raise exception 'Set teaching.global_admin_email at the top of roles.sql to an existing public.admins email before running this upgrade';
  end if;
end $$;

create or replace function public.teaching_role() returns text
language sql stable security definer set search_path = '' as $$
  select a.role from public.teaching_accounts a
  join auth.users u on lower(u.email) = a.email
  where u.id = auth.uid() and u.email_confirmed_at is not null
$$;
revoke all on function public.teaching_role() from public, anon;
grant execute on function public.teaching_role() to authenticated;

create or replace function teaching_private.email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
$$;
create or replace function teaching_private.normal_name(p_name text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
    regexp_replace(lower(btrim(coalesce(p_name, ''))),
      '^((professor|prof|dr|assoc|asst|assist|assistant|associate|acad|msc|m\.sc|phd|ph\.d|mr|mrs|ms)[.[:space:]]+)+', '', 'i'),
    '[[:space:]]+', ' ', 'g'))
$$;
-- Only trust the provider record attached to the same verified sign-in email.
-- raw_user_meta_data and names submitted by a browser are not identity evidence.
create or replace function teaching_private.google_name(p_email text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(i.identity_data->>'full_name'), ''),
    nullif(btrim(i.identity_data->>'name'), ''), '')
  from auth.users u join auth.identities i on i.user_id = u.id
  where lower(btrim(u.email)) = lower(btrim(p_email)) and u.email_confirmed_at is not null
    and i.provider = 'google' and lower(btrim(i.identity_data->>'email')) = lower(btrim(u.email))
  order by i.created_at, i.id limit 1
$$;

create or replace function teaching_private.sync_google_names(p_email text default null) returns void
language sql security definer set search_path = '' as $$
  update public.teaching_accounts a set name = names.google_name,
    google_name_anchor = case when a.google_name_anchor = '' then names.google_name else a.google_name_anchor end
  from (select email, coalesce(teaching_private.google_name(email), '') as google_name
    from public.teaching_accounts where p_email is null or email = p_email) names
  where a.email = names.email and (a.name is distinct from names.google_name
    or (a.google_name_anchor = '' and names.google_name <> ''))
$$;

-- Replace old manually entered names without resetting existing professor bindings.
select teaching_private.sync_google_names();

-- The public parser replaces JavaScript whitespace with underscores in metadata keys.
-- Include its Unicode whitespace set so e.g. "holiday startdate" cannot bypass Dates.
create or replace function teaching_private.meta_key(p_key text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(translate(coalesce(p_key, ''),
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',
    repeat(' ', 25))), ' +', '_', 'g'))
$$;
-- Match the first verified Google name, not a later profile rename.
create or replace function teaching_private.bind_professors() returns void
language plpgsql security definer set search_path = '' as $$
declare account_name text;
begin
  if public.teaching_role() is distinct from 'lecturer' then return; end if;
  select teaching_private.normal_name(a.google_name_anchor) into account_name
    from public.teaching_accounts a where a.email = teaching_private.email() and a.name <> '';
  if coalesce(account_name, '') = '' then return; end if;
  insert into teaching_private.professor_bindings(email, sheet_name, is_archive, professor_key, name_row_uid)
  select a.email, r.sheet_name, r.is_archive, r.b, r.row_uid
    from public.teaching_assignments a join public.course_rows r
      on r.sheet_name = a.sheet_name and r.is_archive = a.is_archive
    where a.email = teaching_private.email() and r.type = 'metadata'
      and r.b ~ '^professor[1-9][0-9]*$'
      and teaching_private.normal_name(r.c) = account_name
      -- Ambiguous duplicate names require an administrator to fix the roster.
      and (select count(*) from public.course_rows p
        where p.sheet_name = r.sheet_name and p.is_archive = r.is_archive
          and p.type = 'metadata' and p.b ~ '^professor[1-9][0-9]*$'
          and teaching_private.normal_name(p.c) = account_name) = 1
      and not exists (select 1 from teaching_private.professor_bindings b
        where b.email = a.email and b.sheet_name = a.sheet_name and b.is_archive = a.is_archive)
  on conflict do nothing;
end $$;

create or replace function public.teaching_access() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  -- Serialize permission changes, saves and automatic professor binding.
  lock table public.teaching_accounts in share row exclusive mode;
  if teaching_private.email() is not null then
    perform teaching_private.sync_google_names(teaching_private.email());
  end if;
  perform teaching_private.bind_professors();
  select jsonb_build_object('email', a.email, 'name', a.name, 'role', a.role,
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('sheet_name', s.sheet_name, 'is_archive', s.is_archive))
      from public.teaching_assignments s where s.email = a.email), '[]'::jsonb),
    'professor_keys', coalesce((select jsonb_agg(jsonb_build_object('sheet_name', p.sheet_name,
      'is_archive', p.is_archive, 'key', p.professor_key)) from teaching_private.professor_bindings p
      where p.email = a.email), '[]'::jsonb)) into result
    from public.teaching_accounts a where a.email = teaching_private.email() and a.role <> 'disabled';
  return result;
end $$;

-- Preserve public SELECT. Direct browser DML remains available ONLY to full admins,
-- including cached versions of the old editor. Restrictive policies close any older
-- permissive write policy as well. Limited roles must use the checked RPC below.
alter table public.course_rows enable row level security;
drop policy if exists admin_crud on public.course_rows;
create policy admin_crud on public.course_rows for all to authenticated
  using (public.teaching_role() in ('global_admin','admin'))
  with check (public.teaching_role() in ('global_admin','admin'));
drop policy if exists teaching_insert_guard on public.course_rows;
create policy teaching_insert_guard on public.course_rows as restrictive for insert to authenticated
  with check (public.teaching_role() in ('global_admin','admin'));
drop policy if exists teaching_update_guard on public.course_rows;
create policy teaching_update_guard on public.course_rows as restrictive for update to authenticated
  using (public.teaching_role() in ('global_admin','admin'))
  with check (public.teaching_role() in ('global_admin','admin'));
drop policy if exists teaching_delete_guard on public.course_rows;
create policy teaching_delete_guard on public.course_rows as restrictive for delete to authenticated
  using (public.teaching_role() in ('global_admin','admin'));
revoke insert, update, delete, truncate on public.course_rows from anon, public;
revoke truncate on public.course_rows from authenticated;

create or replace function teaching_private.can_edit(p_row public.course_rows) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare r text := public.teaching_role(); k text := teaching_private.meta_key(p_row.b);
begin
  if r in ('global_admin','admin') then return true; end if;
  if r is null or r not in ('lecturer','student') or not exists (
    select 1 from public.teaching_assignments a where a.email = teaching_private.email()
      and a.sheet_name = p_row.sheet_name and a.is_archive = p_row.is_archive
  ) then return false; end if;
  if p_row.type in ('module','material','funfact','project','project_file',
    'project_description','project_group','group_file','announcement') then return true; end if;
  if r = 'student' then return false; end if;
  if p_row.type = 'button' then return true; end if;
  if p_row.type <> 'metadata' then return false; end if;
  if k in ('code','title','year','semester','level','type','credits',
    'startdate','enddate','holidayweeks','holiday_startdate','holiday_start_date','holidaystartdate','holiday_start') then return false; end if;
  if k like 'professor%' then
    return exists (select 1 from teaching_private.professor_bindings b
      join public.course_rows n on n.row_uid = b.name_row_uid
      where b.email = teaching_private.email() and b.sheet_name = p_row.sheet_name
        and b.is_archive = p_row.is_archive and n.type = 'metadata' and n.b = b.professor_key
        and (p_row.b = b.professor_key or p_row.b = b.professor_key || '_link' or p_row.b = b.professor_key || '_photo'));
  end if;
  return true;
end $$;

create or replace function public.teaching_save_rows(p_upserts jsonb default '[]', p_delete_uids text[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare incoming public.course_rows; previous public.course_rows; uid text; role_name text;
begin
  lock table public.teaching_accounts in share row exclusive mode;
  lock table public.course_rows in share row exclusive mode;
  role_name := public.teaching_role();
  if role_name is null or role_name = 'disabled' then raise exception 'Access denied' using errcode = '42501'; end if;
  if p_upserts is null or jsonb_typeof(p_upserts) <> 'array' or p_delete_uids is null then
    raise exception 'Invalid save payload'; end if;
  -- Validate the entire batch BEFORE any writes (including professor name changes).
  for incoming in select * from jsonb_populate_recordset(null::public.course_rows, p_upserts) loop
    if incoming.row_uid is null or incoming.sheet_name is null or btrim(incoming.sheet_name) = ''
      or incoming.type is null or incoming.is_archive is null or incoming.row_index is null then
      raise exception 'Incomplete course row'; end if;
    if not teaching_private.can_edit(incoming) then raise exception 'This course field is read-only' using errcode = '42501'; end if;
    select * into previous from public.course_rows where row_uid = incoming.row_uid;
    if found then
      if not teaching_private.can_edit(previous) then raise exception 'Existing row is read-only' using errcode = '42501'; end if;
      -- Course moves use a separate atomic operation. Metadata keys and row types cannot
      -- be repurposed by a limited role to smuggle a protected record into an editable tab.
      if previous.sheet_name <> incoming.sheet_name or previous.is_archive <> incoming.is_archive
        or (role_name not in ('global_admin','admin') and
          (previous.type <> incoming.type or (previous.type = 'metadata' and previous.b is distinct from incoming.b))) then
        raise exception 'Cannot move or repurpose this row' using errcode = '42501'; end if;
    elsif role_name not in ('global_admin','admin') then
      if not exists (select 1 from public.course_rows c where c.sheet_name = incoming.sheet_name
        and c.is_archive = incoming.is_archive and c.type = 'metadata') then
        raise exception 'Only admins can create courses' using errcode = '42501'; end if;
      if incoming.type = 'metadata' and exists (select 1 from public.course_rows c
        where c.sheet_name = incoming.sheet_name and c.is_archive = incoming.is_archive
          and c.type = 'metadata' and teaching_private.meta_key(c.b) = teaching_private.meta_key(incoming.b)
          and not (c.row_uid = any(p_delete_uids))) then
        raise exception 'Metadata key already exists'; end if;
    end if;
    if role_name = 'lecturer' and incoming.type = 'metadata' and incoming.b ~ '^professor[1-9][0-9]*$'
      and coalesce(btrim(incoming.c), '') = '' then raise exception 'Professor name is required'; end if;
  end loop;
  foreach uid in array p_delete_uids loop
    select * into previous from public.course_rows where row_uid = uid;
    if not found then raise exception 'Row no longer exists; reload before saving'; end if;
    if not teaching_private.can_edit(previous) or (role_name = 'lecturer' and previous.type = 'metadata'
      and previous.b ~ '^professor[1-9][0-9]*$') then
      raise exception 'Cannot delete this row' using errcode = '42501'; end if;
  end loop;
  if (select count(*) <> count(distinct r->>'row_uid') from jsonb_array_elements(p_upserts) r) then
    raise exception 'Duplicate row IDs'; end if;
  if exists (select 1 from jsonb_array_elements(p_upserts) r where r->>'type' = 'metadata'
    group by r->>'sheet_name', r->>'is_archive', teaching_private.meta_key(r->>'b') having count(*) > 1) then
    raise exception 'Duplicate metadata keys'; end if;
  delete from public.course_rows where row_uid = any(p_delete_uids)
    and row_uid not in (select r->>'row_uid' from jsonb_array_elements(p_upserts) r);
  insert into public.course_rows select * from jsonb_populate_recordset(null::public.course_rows, p_upserts)
  on conflict (row_uid) do update set row_index = excluded.row_index, type = excluded.type,
    b = excluded.b, c = excluded.c, d = excluded.d, e = excluded.e, f = excluded.f,
    g = excluded.g, h = excluded.h, i = excluded.i, j = excluded.j;
end $$;

create or replace function public.teaching_create_course(p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare course_name text; archived boolean;
begin
  lock table public.teaching_accounts in share row exclusive mode;
  lock table public.course_rows in share row exclusive mode;
  if coalesce(public.teaching_role(), '') not in ('global_admin','admin') then
    raise exception 'Only admins can create courses' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Course metadata is required'; end if;
  course_name := p_rows->0->>'sheet_name';
  archived := (p_rows->0->>'is_archive')::boolean;
  if exists (select 1 from public.course_rows where sheet_name = course_name and is_archive = archived) then
    raise exception 'This course already exists'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where r->>'sheet_name' is distinct from course_name
    or (r->>'is_archive')::boolean is distinct from archived or r->>'type' is distinct from 'metadata') then
    raise exception 'Invalid course metadata'; end if;
  perform public.teaching_save_rows(p_rows, '{}');
end $$;

-- An administrator replacing a professor invalidates the old automatic ownership.
-- A lecturer editing their own name keeps their existing verified binding.
create or replace function teaching_private.reset_professor_binding() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.type = 'metadata' and old.b ~ '^professor[1-9][0-9]*$'
    and (old.c is distinct from new.c or old.b is distinct from new.b or old.type is distinct from new.type)
    and public.teaching_role() is distinct from 'lecturer' then
    delete from teaching_private.professor_bindings where name_row_uid = old.row_uid;
  end if;
  return new;
end $$;
drop trigger if exists teaching_professor_changed on public.course_rows;
create trigger teaching_professor_changed after update on public.course_rows
  for each row execute function teaching_private.reset_professor_binding();

create or replace function public.teaching_move_course(p_name text, p_new_name text, p_from_archive boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare role_name text; semester_name text; academic_year text; years text[]; archive_name text; suffix text;
begin
  lock table public.teaching_accounts in share row exclusive mode;
  lock table public.course_rows in share row exclusive mode;
  role_name := public.teaching_role();
  if role_name is null or not (role_name in ('global_admin','admin') or
    (role_name = 'lecturer' and p_from_archive = false and exists (
      select 1 from public.teaching_assignments a where a.email = teaching_private.email()
        and a.sheet_name = p_name and a.is_archive = false))) then
    raise exception 'Cannot archive or restore this course' using errcode = '42501'; end if;
  if p_from_archive is null or coalesce(btrim(p_new_name), '') = '' then raise exception 'Invalid destination'; end if;
  if not exists (select 1 from public.course_rows where sheet_name = p_name and is_archive = p_from_archive) then
    raise exception 'Course no longer exists'; end if;
  if role_name = 'lecturer' then
    select substring(c from '^[[:space:]]*(Fall|Spring|Summer)') into semester_name
      from public.course_rows where sheet_name = p_name and is_archive = false and type = 'metadata' and b = 'semester'
      order by row_index desc limit 1;
    select c into academic_year from public.course_rows
      where sheet_name = p_name and is_archive = false and type = 'metadata' and b = 'year'
      order by row_index desc limit 1;
    archive_name := p_name;
    if semester_name is not null then
      suffix := '_' || semester_name;
      years := regexp_match(coalesce(academic_year, ''), '([0-9]{4})[^0-9]*([0-9]{4})?');
      if years is not null then
        suffix := suffix || lpad(((years[1]::integer) % 100)::text, 2, '0')
          || lpad(((coalesce(years[2]::integer, years[1]::integer + 1)) % 100)::text, 2, '0');
      end if;
      archive_name := regexp_replace(p_name, '_(Fall|Spring|Summer)([0-9]{4})?$', '') || suffix;
    end if;
    if p_new_name is distinct from archive_name then
      raise exception 'Lecturers can archive a course, but cannot rename it' using errcode = '42501'; end if;
  end if;
  if exists (select 1 from public.course_rows where sheet_name = p_new_name and is_archive = not p_from_archive) then
    raise exception 'A course already exists at the destination'; end if;
  -- Fresh IDs avoid collisions with later offerings reusing the original course name.
  update public.course_rows set sheet_name = p_new_name, is_archive = not p_from_archive,
    row_uid = 'course:' || gen_random_uuid()::text where sheet_name = p_name and is_archive = p_from_archive;
  update public.teaching_assignments set sheet_name = p_new_name, is_archive = not p_from_archive
    where sheet_name = p_name and is_archive = p_from_archive;
end $$;

create or replace function public.teaching_delete_course(p_name text, p_archive boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  lock table public.teaching_accounts in share row exclusive mode;
  lock table public.course_rows in share row exclusive mode;
  if coalesce(public.teaching_role(), '') not in ('global_admin','admin') then
    raise exception 'Only admins can delete courses' using errcode = '42501'; end if;
  if not exists (select 1 from public.course_rows where sheet_name = p_name and is_archive = p_archive) then
    raise exception 'Course no longer exists'; end if;
  delete from public.course_rows where sheet_name = p_name and is_archive = p_archive;
  delete from public.teaching_assignments where sheet_name = p_name and is_archive = p_archive;
end $$;

create or replace function public.teaching_list_accounts() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  lock table public.teaching_accounts in share row exclusive mode;
  if public.teaching_role() is distinct from 'global_admin' then
    raise exception 'Only the global admin can manage access' using errcode = '42501'; end if;
  perform teaching_private.sync_google_names();
  return coalesce((select jsonb_agg(jsonb_build_object('email', a.email, 'name', a.name, 'role', a.role,
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('sheet_name', s.sheet_name, 'is_archive', s.is_archive))
      from public.teaching_assignments s where s.email = a.email), '[]'::jsonb)) order by
      case a.role when 'global_admin' then 0 when 'admin' then 0 when 'lecturer' then 1 when 'student' then 2 else 3 end,
      lower(coalesce(nullif(a.name, ''), a.email)), a.email)
    from public.teaching_accounts a where a.role <> 'disabled'), '[]'::jsonb);
end $$;

create or replace function public.teaching_set_account(p_email text, p_name text, p_role text, p_assignments jsonb default '[]')
returns void language plpgsql security definer set search_path = '' as $$
declare target_email text := lower(btrim(p_email)); account_name text; assignment jsonb;
begin
  lock table public.teaching_accounts in share row exclusive mode;
  if public.teaching_role() is distinct from 'global_admin' then
    raise exception 'Only the global admin can manage access' using errcode = '42501'; end if;
  if target_email is null or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_role is null or p_role not in ('admin','lecturer','student')
    or p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then raise exception 'Invalid account details'; end if;
  if exists (select 1 from public.teaching_accounts where email = target_email and role = 'global_admin') then
    raise exception 'The global administrator cannot be changed here'; end if;
  for assignment in select * from jsonb_array_elements(p_assignments) loop
    if not exists (select 1 from public.course_rows c where c.sheet_name = assignment->>'sheet_name'
      and c.is_archive = (assignment->>'is_archive')::boolean and c.type = 'metadata') then
      raise exception 'An assigned course no longer exists'; end if;
  end loop;
  -- Retain ownership for unchanged lecturer assignments; reset on role changes.
  if exists (select 1 from public.teaching_accounts where email = target_email and role <> p_role) then
    delete from teaching_private.professor_bindings where email = target_email;
  end if;
  -- p_name is kept for compatibility with existing callers, but never trusted.
  -- Accounts can be assigned before their first Google sign-in.
  account_name := coalesce(teaching_private.google_name(target_email), '');
  insert into public.teaching_accounts(email, name, google_name_anchor, role)
    values (target_email, account_name, account_name, p_role)
    on conflict (email) do update set name = excluded.name, role = excluded.role,
      google_name_anchor = case when teaching_accounts.google_name_anchor = ''
        then excluded.google_name_anchor else teaching_accounts.google_name_anchor end;
  delete from public.teaching_assignments a where a.email = target_email and not exists (
    select 1 from jsonb_array_elements(p_assignments) v where v->>'sheet_name' = a.sheet_name
      and (v->>'is_archive')::boolean = a.is_archive);
  insert into public.teaching_assignments(email, sheet_name, is_archive)
    select target_email, v->>'sheet_name', (v->>'is_archive')::boolean from jsonb_array_elements(p_assignments) v
    on conflict do nothing;
end $$;

create or replace function public.teaching_remove_account(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  lock table public.teaching_accounts in share row exclusive mode;
  if public.teaching_role() is distinct from 'global_admin' then
    raise exception 'Only the global admin can manage access' using errcode = '42501'; end if;
  if exists (select 1 from public.teaching_accounts where email = lower(btrim(p_email)) and role = 'global_admin') then
    raise exception 'The global administrator cannot be removed'; end if;
  -- Tombstone prevents a rerun of the migration from resurrecting legacy admin access.
  update public.teaching_accounts set role = 'disabled' where email = lower(btrim(p_email));
  delete from public.teaching_assignments where email = lower(btrim(p_email));
end $$;

revoke all on all functions in schema teaching_private from public, anon, authenticated;
revoke all on function public.teaching_access(), public.teaching_save_rows(jsonb,text[]), public.teaching_create_course(jsonb),
  public.teaching_move_course(text,text,boolean), public.teaching_delete_course(text,boolean),
  public.teaching_list_accounts(), public.teaching_set_account(text,text,text,jsonb),
  public.teaching_remove_account(text) from public, anon;
grant execute on function public.teaching_access(), public.teaching_save_rows(jsonb,text[]), public.teaching_create_course(jsonb),
  public.teaching_move_course(text,text,boolean), public.teaching_delete_course(text,boolean),
  public.teaching_list_accounts(), public.teaching_set_account(text,text,text,jsonb),
  public.teaching_remove_account(text) to authenticated;
notify pgrst, 'reload schema';
commit;
