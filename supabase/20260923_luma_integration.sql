-- Applied 2026-09-23. Luma integration: creating an event in Villagers spins up
-- a real Luma event page through the Luma API (https://docs.luma.com).
-- The Luma API key lives in app_config (RLS on, no read policies) as
-- key='luma_api_key' and is only ever read inside these security-definer
-- functions - it never reaches the client.

alter table public.events
  add column if not exists luma_event_id text,
  add column if not exists luma_url text,
  add column if not exists luma_status text,       -- null = not tried | pending | created | failed
  add column if not exists luma_error text,
  add column if not exists luma_request_id bigint, -- pg_net id of the in-flight create call
  add column if not exists luma_created_at timestamptz;

-- Completion step, shared by the RPC and the reconcile cron: reads the pg_net
-- response for a create call, then looks up the event URL and records it.
create or replace function public.finish_luma_event(p_event_id uuid, p_req bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_status int;
  v_resp text;
  v_luma_id text;
  v_url text;
  v_req2 bigint;
  v_status2 int;
  v_resp2 text;
  i int;
begin
  select r.status_code, r.body into v_status, v_resp
  from net._http_response r where r.id = p_req;
  if v_status is null then
    return jsonb_build_object('ok', false, 'status', 'pending');
  end if;

  if v_status between 200 and 299 then
    v_luma_id := (v_resp::jsonb) ->> 'id';
  else
    update public.events
    set luma_status = 'failed',
        luma_error = 'Luma said no (HTTP ' || v_status || ')',
        updated_at = now()
    where id = p_event_id;
    return jsonb_build_object('ok', false, 'error', 'HTTP ' || v_status, 'detail', left(v_resp, 300));
  end if;

  if v_luma_id is null then
    update public.events
    set luma_status = 'failed', luma_error = 'Luma response had no event id', updated_at = now()
    where id = p_event_id;
    return jsonb_build_object('ok', false, 'error', 'no event id in Luma response');
  end if;

  select value into v_key from public.app_config where key = 'luma_api_key';

  select net.http_get(
    url := 'https://public-api.luma.com/v1/events/get?event_id=' || v_luma_id,
    headers := jsonb_build_object('x-luma-api-key', v_key),
    timeout_milliseconds := 5000
  ) into v_req2;

  v_status2 := null;
  for i in 1..12 loop
    select r.status_code, r.body into v_status2, v_resp2
    from net._http_response r where r.id = v_req2;
    exit when v_status2 is not null;
    perform pg_sleep(0.25);
  end loop;

  if v_status2 between 200 and 299 then
    v_url := (v_resp2::jsonb) ->> 'url';
  end if;

  update public.events
  set luma_event_id = v_luma_id,
      luma_url = v_url,
      luma_status = 'created',
      luma_error = case when v_url is null
                        then 'Page created - open Luma for the link'
                        else null end,
      luma_created_at = now(),
      updated_at = now()
  where id = p_event_id;

  return jsonb_build_object('ok', true, 'luma_event_id', v_luma_id, 'luma_url', v_url);
end;
$$;

-- Host-facing RPC: create the Luma page for one of the caller's events.
create or replace function public.create_luma_event(
  p_event_id uuid,
  p_timezone text default 'America/New_York'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_key text;
  v_body jsonb;
  v_req bigint;
  v_status int;
  v_resp text;
  i int;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'event not found');
  end if;
  if auth.uid() is null or not public.is_host_member(v_event.host_id) then
    raise exception 'host membership required' using errcode = '42501';
  end if;
  if coalesce(v_event.sample, false) then
    return jsonb_build_object('ok', false, 'error', 'sample events do not get Luma pages');
  end if;

  -- Idempotent: a finished page is returned, not duplicated.
  if v_event.luma_event_id is not null and v_event.luma_url is not null then
    return jsonb_build_object('ok', true, 'already', true,
                              'luma_event_id', v_event.luma_event_id,
                              'luma_url', v_event.luma_url);
  end if;

  select value into v_key from public.app_config where key = 'luma_api_key';
  if v_key is null or btrim(v_key) = '' then
    update public.events
    set luma_status = 'failed', luma_error = 'No Luma API key configured yet', updated_at = now()
    where id = p_event_id;
    return jsonb_build_object('ok', false, 'error', 'no Luma API key configured');
  end if;

  v_body := jsonb_build_object(
    'name', v_event.title,
    'start_at', to_char(v_event.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'timezone', coalesce(nullif(p_timezone, ''), 'America/New_York'),
    'tint_color', '#55236f'
  );
  if nullif(btrim(coalesce(v_event.location, '')), '') is not null then
    v_body := v_body || jsonb_build_object(
      'geo_address_json', jsonb_build_object('type', 'manual', 'address', v_event.location));
  end if;

  update public.events
  set luma_status = 'pending', luma_error = null, updated_at = now()
  where id = p_event_id;

  select net.http_post(
    url := 'https://public-api.luma.com/v1/events/create',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-luma-api-key', v_key),
    body := v_body,
    timeout_milliseconds := 5000
  ) into v_req;

  update public.events set luma_request_id = v_req where id = p_event_id;

  -- pg_net is async: poll briefly so the common case finishes inside this one
  -- call. A slow Luma response stays 'pending' and the reconcile cron below
  -- completes it in the background.
  v_status := null;
  for i in 1..16 loop
    select r.status_code into v_status from net._http_response r where r.id = v_req;
    exit when v_status is not null;
    perform pg_sleep(0.25);
  end loop;

  if v_status is null then
    return jsonb_build_object('ok', false, 'status', 'pending',
                              'error', 'Luma is taking a while - it finishes in the background');
  end if;

  return public.finish_luma_event(p_event_id, v_req);
end;
$$;

-- Background sweeper: completes create calls that outlived one RPC, and fails
-- anything Luma never answered.
create or replace function public.reconcile_luma_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id, luma_request_id from public.events
    where luma_status = 'pending' and luma_request_id is not null
      and updated_at < now() - interval '30 seconds'
  loop
    perform public.finish_luma_event(r.id, r.luma_request_id);
  end loop;

  update public.events
  set luma_status = 'failed', luma_error = 'Luma did not respond in time - try again', updated_at = now()
  where luma_status = 'pending' and updated_at < now() - interval '10 minutes';
end;
$$;

do $$
begin
  perform cron.schedule('reconcile-luma-events', '* * * * *', 'select public.reconcile_luma_events()');
exception when unique_violation then null;
end $$;

-- Only signed-in hosts may ask for a Luma page; the helper and sweeper stay internal.
revoke all on function public.create_luma_event(uuid, text) from public;
grant execute on function public.create_luma_event(uuid, text) to authenticated;
revoke all on function public.finish_luma_event(uuid, bigint) from public;
revoke all on function public.reconcile_luma_events() from public;
