-- Applied 2026-09-19. Idempotent hardening for individual-host auth.
-- Give Arielle's individual auth account access to the existing sole host.
insert into public.host_members (host_id, user_id)
select hm.host_id, 'c636cecb-89dd-406e-8928-f18f8855d953'::uuid
from public.host_members hm
where hm.user_id = '79fa9c24-e76b-4901-ab1d-a74e0ff67f54'::uuid
on conflict do nothing;

-- Retire the published shared login: remove its membership and rotate its password.
delete from public.host_members
where user_id = '79fa9c24-e76b-4901-ab1d-a74e0ff67f54'::uuid;
update auth.users
set encrypted_password = crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf')),
    updated_at = now()
where id = '79fa9c24-e76b-4901-ab1d-a74e0ff67f54'::uuid;

-- Canonical-person creation is allowed only through this membership-checked RPC.
create or replace function public.create_host_person(
  p_host_id uuid,
  p_full_name text,
  p_email text default null,
  p_role text default null,
  p_company text default null,
  p_linkedin text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person_id uuid;
begin
  if auth.uid() is null or not public.is_host_member(p_host_id) then
    raise exception 'host membership required' using errcode = '42501';
  end if;
  if nullif(btrim(p_full_name), '') is null then
    raise exception 'full name required' using errcode = '22023';
  end if;

  if nullif(lower(btrim(p_email)), '') is not null then
    insert into public.people (email, full_name, role, company, linkedin)
    values (lower(btrim(p_email)), btrim(p_full_name), nullif(btrim(p_role), ''), nullif(btrim(p_company), ''), nullif(btrim(p_linkedin), ''))
    on conflict (email) do update set
      full_name = coalesce(nullif(public.people.full_name, ''), excluded.full_name),
      role = coalesce(public.people.role, excluded.role),
      company = coalesce(public.people.company, excluded.company),
      linkedin = coalesce(public.people.linkedin, excluded.linkedin)
    returning id into v_person_id;
  else
    insert into public.people (full_name, role, company, linkedin)
    values (btrim(p_full_name), nullif(btrim(p_role), ''), nullif(btrim(p_company), ''), nullif(btrim(p_linkedin), ''))
    returning id into v_person_id;
  end if;

  insert into public.host_people (host_id, person_id)
  values (p_host_id, v_person_id)
  on conflict (host_id, person_id) do nothing;
  return v_person_id;
end;
$$;

revoke all on function public.create_host_person(uuid,text,text,text,text,text) from public;
grant execute on function public.create_host_person(uuid,text,text,text,text,text) to authenticated;
revoke insert on table public.people from authenticated;
