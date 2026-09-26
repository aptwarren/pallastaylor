-- Applied 2026-09-26. Text-in event notes ("take notes by text"): hosts and
-- their reps text notes to a dedicated inbound number during an event;
-- Villagers matches each note to the host, the event happening now, and the
-- guest it is about, and opens a follow-up. Inbound arrives via a pg_cron
-- poller against the provider API (no edge functions, same pattern as Luma).

-- Who may text notes in for each host (the host's own cell, plus reps).
create table if not exists public.host_texters (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.hosts(id) on delete cascade,
  phone text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (host_id, phone)
);
alter table public.host_texters enable row level security;
drop policy if exists host_texters_member on public.host_texters;
create policy host_texters_member on public.host_texters
  for all to authenticated
  using (public.is_host_member(host_id))
  with check (public.is_host_member(host_id));

-- Every inbound text, matched or not.
create table if not exists public.event_notes (
  id uuid primary key default gen_random_uuid(),
  host_id uuid references public.hosts(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  texter_id uuid references public.host_texters(id) on delete set null,
  from_number text not null,
  body text not null,
  provider text not null default 'twilio',
  provider_message_id text unique,
  match_state text not null default 'unmatched',  -- matched | ambiguous | unmatched | no_event | unknown_sender
  match_candidates jsonb,
  reply_status text,           -- null | pending | sent | skipped | failed
  reply_body text,
  reply_error text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.event_notes enable row level security;
drop policy if exists event_notes_member on public.event_notes;
create policy event_notes_member on public.event_notes
  for all to authenticated
  using (host_id is not null and public.is_host_member(host_id))
  with check (host_id is not null and public.is_host_member(host_id));

-- Follow-ups opened from notes.
create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.hosts(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  note_id uuid references public.event_notes(id) on delete set null,
  summary text not null,
  status text not null default 'open',   -- open | done
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.follow_ups enable row level security;
drop policy if exists follow_ups_member on public.follow_ups;
create policy follow_ups_member on public.follow_ups
  for all to authenticated
  using (public.is_host_member(host_id))
  with check (public.is_host_member(host_id));

create or replace function public.norm_phone10(p text) returns text
language sql immutable as $$
  select right(regexp_replace(coalesce(p,''), '\D', '', 'g'), 10)
$$;

-- Ingest one inbound text. Idempotent on provider_message_id. Matches sender
-- to a host texter, the event happening today in the host's timezone, and the
-- guest named in the body; a matched note opens a follow-up. The reply text
-- is queued (reply_status='pending') and sent by the poller.
create or replace function public.ingest_inbound_sms(
  p_to text, p_from text, p_body text,
  p_provider text default 'twilio', p_provider_id text default null,
  p_sent_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_texter public.host_texters%rowtype;
  v_event public.events%rowtype;
  v_note_id uuid;
  v_state text;
  v_person_name text;
  v_matches int := 0;
  v_candidates jsonb := '[]'::jsonb;
  v_reply text;
  v_body text := left(coalesce(p_body, ''), 1000);
  p record;
  v_first text; v_last text;
begin
  if p_provider_id is not null
     and exists (select 1 from public.event_notes where provider_message_id = p_provider_id) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if nullif(btrim(v_body), '') is null then
    return jsonb_build_object('ok', false, 'error', 'empty body');
  end if;

  select * into v_texter from public.host_texters
   where public.norm_phone10(phone) = public.norm_phone10(p_from)
   limit 1;

  if not found then
    insert into public.event_notes (host_id, from_number, body, provider, provider_message_id, match_state, received_at, reply_status)
    values (null, p_from, v_body, p_provider, p_provider_id, 'unknown_sender', coalesce(p_sent_at, now()), 'skipped');
    return jsonb_build_object('ok', true, 'state', 'unknown_sender');
  end if;

  -- Event today in the host's timezone; prefer one already underway.
  select e.* into v_event
  from public.events e
  join public.hosts h on h.id = e.host_id
  where e.host_id = v_texter.host_id
    and (e.starts_at at time zone coalesce(h.timezone, 'America/New_York'))::date
        = (coalesce(p_sent_at, now()) at time zone coalesce(h.timezone, 'America/New_York'))::date
  order by (e.starts_at <= coalesce(p_sent_at, now())) desc,
           abs(extract(epoch from (e.starts_at - coalesce(p_sent_at, now())))) asc
  limit 1;

  -- Match a guest named in the body (full name, or first+last, else a unique first name).
  if v_event.id is not null then
    for p in
      select pe.id, pe.full_name
      from public.event_guests eg
      join public.people pe on pe.id = eg.person_id
      where eg.event_id = v_event.id
    loop
      v_first := lower(split_part(btrim(p.full_name), ' ', 1));
      v_last := lower(split_part(btrim(p.full_name), ' ', -1));
      if position(lower(btrim(p.full_name)) in lower(v_body)) > 0
         or (length(v_first) > 2 and length(v_last) > 2 and v_first <> v_last
             and position(v_first in lower(v_body)) > 0
             and position(v_last in lower(v_body)) > 0) then
        v_matches := v_matches + 1;
        v_candidates := v_candidates || jsonb_build_object('person_id', p.id, 'name', p.full_name);
      end if;
    end loop;

    if v_matches = 0 then
      for p in
        select pe.id, pe.full_name
        from public.event_guests eg
        join public.people pe on pe.id = eg.person_id
        where eg.event_id = v_event.id
      loop
        v_first := lower(split_part(btrim(p.full_name), ' ', 1));
        if length(v_first) > 2 and position(v_first in lower(v_body)) > 0 then
          v_matches := v_matches + 1;
          v_candidates := v_candidates || jsonb_build_object('person_id', p.id, 'name', p.full_name);
        end if;
      end loop;
    end if;
  end if;

  if v_event.id is null then
    v_state := 'no_event';
    v_reply := 'Villagers: got it - no event today, so it is saved to your notes.';
  elsif v_matches = 1 then
    v_state := 'matched';
    v_person_name := v_candidates->0->>'name';
    v_reply := 'Villagers: logged for ' || v_person_name || ' at ' || v_event.title || '. Follow-up created.';
  elsif v_matches > 1 then
    v_state := 'ambiguous';
    v_reply := 'Villagers: got it - not sure who that is about. Pick the person in the app and it will file there.';
  else
    v_state := 'unmatched';
    v_reply := 'Villagers: saved to ' || v_event.title || '. Name a guest in the text and it files to them automatically.';
  end if;

  insert into public.event_notes (host_id, event_id, person_id, texter_id, from_number, body, provider,
                                  provider_message_id, match_state, match_candidates, received_at,
                                  reply_status, reply_body)
  values (v_texter.host_id, v_event.id,
          case when v_state = 'matched' then (v_candidates->0->>'person_id')::uuid end,
          v_texter.id, p_from, v_body, p_provider, p_provider_id, v_state,
          case when v_matches > 1 then v_candidates end,
          coalesce(p_sent_at, now()), 'pending', v_reply)
  returning id into v_note_id;

  if v_state = 'matched' then
    insert into public.follow_ups (host_id, event_id, person_id, note_id, summary)
    values (v_texter.host_id, v_event.id, (v_candidates->0->>'person_id')::uuid, v_note_id, v_body);
  end if;

  return jsonb_build_object('ok', true, 'state', v_state, 'note_id', v_note_id,
                            'event_id', v_event.id, 'matches', v_matches);
end;
$$;

-- Host-facing: assign an unmatched/ambiguous note to a guest; opens the follow-up.
create or replace function public.resolve_note_match(p_note_id uuid, p_person_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note public.event_notes%rowtype;
  v_name text;
begin
  select * into v_note from public.event_notes where id = p_note_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'note not found');
  end if;
  if auth.uid() is null or v_note.host_id is null or not public.is_host_member(v_note.host_id) then
    raise exception 'host membership required' using errcode = '42501';
  end if;

  update public.event_notes
  set person_id = p_person_id, match_state = 'matched', match_candidates = null
  where id = p_note_id;

  insert into public.follow_ups (host_id, event_id, person_id, note_id, summary)
  values (v_note.host_id, v_note.event_id, p_person_id, p_note_id, v_note.body);

  select full_name into v_name from public.people where id = p_person_id;
  return jsonb_build_object('ok', true, 'name', v_name);
end;
$$;

-- Poller: pull inbound texts from the provider, ingest, then send queued replies.
create or replace function public.process_sms_notes() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid text; v_token text; v_number text;
  v_req bigint; v_status int; v_resp text;
  i int;
  m jsonb;
  r record;
  v_ts timestamptz;
begin
  select value into v_sid from public.app_config where key = 'twilio_account_sid';
  select value into v_token from public.app_config where key = 'twilio_auth_token';
  select value into v_number from public.app_config where key = 'sms_inbound_number';
  if v_sid is null or v_token is null or v_number is null then
    return;
  end if;

  select net.http_get(
    url := 'https://api.twilio.com/2010-04-01/Accounts/' || v_sid ||
           '/Messages.json?To=' || replace(v_number, '+', '%2B') || '&PageSize=50',
    headers := jsonb_build_object('Authorization', 'Basic ' || encode(convert_to(v_sid || ':' || v_token, 'UTF8'), 'base64')),
    timeout_milliseconds := 8000
  ) into v_req;

  v_status := null;
  for i in 1..24 loop
    select x.status_code, x.content into v_status, v_resp from net._http_response x where x.id = v_req;
    exit when v_status is not null;
    perform pg_sleep(0.25);
  end loop;

  if v_status between 200 and 299 then
    for m in select * from jsonb_array_elements((v_resp::jsonb) -> 'messages') loop
      if m ->> 'direction' = 'inbound' then
        begin
          v_ts := (m ->> 'date_sent')::timestamptz;
        exception when others then
          v_ts := now();
        end;
        perform public.ingest_inbound_sms(m ->> 'to', m ->> 'from', m ->> 'body', 'twilio', m ->> 'sid', v_ts);
      end if;
    end loop;
  end if;

  -- Replies: pg_net can only POST JSON, Twilio requires form-encoded, so
  -- reply sending needs an edge function. Mark queued replies skipped for now.
  update public.event_notes
  set reply_status = 'skipped',
      reply_error = 'reply sending requires a Supabase edge function (pg_net posts JSON; Twilio requires form-encoded)'
  where reply_status = 'pending';

end;
$$;

do $$
begin
  perform cron.schedule('villagers-sms-notes', '* * * * *', 'select public.process_sms_notes()');
exception when unique_violation then null;
end $$;

revoke all on function public.ingest_inbound_sms(text, text, text, text, text, timestamptz) from public;
revoke all on function public.resolve_note_match(uuid, uuid) from public;
grant execute on function public.resolve_note_match(uuid, uuid) to authenticated;
revoke all on function public.process_sms_notes() from public;

-- The host's own cell is the first texter.
insert into public.host_texters (host_id, phone, label)
values ('304a66c4-91ac-4283-bdd6-1d980add590d', '+15165749969', 'Arielle')
on conflict (host_id, phone) do nothing;
create or replace function public.get_notes_number() returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_num text;
begin
  select hm.host_id into v_host from public.host_members hm where hm.user_id = auth.uid() limit 1;
  if v_host is null then
    raise exception 'host membership required' using errcode = '42501';
  end if;
  select value into v_num from public.app_config where key = 'sms_inbound_number';
  return v_num;
end;
$$;

revoke all on function public.get_notes_number() from public;
grant execute on function public.get_notes_number() to authenticated;
