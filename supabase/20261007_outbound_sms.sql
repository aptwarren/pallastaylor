-- Outbound texts from the Guest texts tab, sent from the same Twilio number
-- that receives text-in notes. Uses the http extension because pg_net can only
-- post JSON and Twilio requires form-encoded bodies.
create extension if not exists http with schema extensions;

create table if not exists public.sms_outbox (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.hosts(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  to_number text not null,
  body text not null,
  status text not null default 'queued',   -- queued | sent | failed
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);
alter table public.sms_outbox enable row level security;
drop policy if exists sms_outbox_member on public.sms_outbox;
create policy sms_outbox_member on public.sms_outbox
  for select to authenticated
  using (public.is_host_member(host_id));

create or replace function public.send_guest_text(p_event uuid, p_to text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_host uuid; v_sid text; v_token text; v_from text;
  v_digits text; v_to text; v_id uuid; v_res extensions.http_response; v_json jsonb;
begin
  select e.host_id into v_host from public.events e where e.id = p_event;
  if auth.uid() is null or v_host is null or not public.is_host_member(v_host) then
    raise exception 'host membership required' using errcode = '42501';
  end if;
  if coalesce(trim(p_body), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Write a message first.');
  end if;
  v_digits := regexp_replace(coalesce(p_to, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 10 then v_to := '+1' || v_digits;
  elsif length(v_digits) = 11 and left(v_digits, 1) = '1' then v_to := '+' || v_digits;
  else return jsonb_build_object('ok', false, 'error', 'Enter a 10-digit US phone number.');
  end if;

  select value into v_sid from public.app_config where key = 'twilio_account_sid';
  select value into v_token from public.app_config where key = 'twilio_auth_token';
  select value into v_from from public.app_config where key = 'sms_inbound_number';
  if v_sid is null or v_token is null or v_from is null then
    return jsonb_build_object('ok', false, 'error', 'Twilio is not configured.');
  end if;

  insert into public.sms_outbox (host_id, event_id, to_number, body)
  values (v_host, p_event, v_to, p_body) returning id into v_id;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '15');
  select * into v_res from extensions.http((
    'POST',
    'https://api.twilio.com/2010-04-01/Accounts/' || v_sid || '/Messages.json',
    array[extensions.http_header('Authorization', 'Basic ' || replace(encode(convert_to(v_sid || ':' || v_token, 'UTF8'), 'base64'), E'\n', ''))],
    'application/x-www-form-urlencoded',
    'To=' || extensions.urlencode(v_to) || '&From=' || extensions.urlencode(v_from) || '&Body=' || extensions.urlencode(p_body)
  )::extensions.http_request);

  begin v_json := v_res.content::jsonb; exception when others then v_json := '{}'::jsonb; end;

  if v_res.status between 200 and 299 then
    update public.sms_outbox set status = 'sent', provider_message_id = v_json ->> 'sid' where id = v_id;
    return jsonb_build_object('ok', true, 'sid', v_json ->> 'sid');
  end if;
  update public.sms_outbox
  set status = 'failed',
      error = coalesce('Twilio ' || (v_json ->> 'code') || ': ' || (v_json ->> 'message'), 'Twilio HTTP ' || v_res.status)
  where id = v_id;
  return jsonb_build_object('ok', false, 'code', v_json ->> 'code',
    'error', coalesce('Twilio ' || (v_json ->> 'code') || ': ' || (v_json ->> 'message'), 'Twilio HTTP ' || v_res.status));
end;
$$;

revoke all on function public.send_guest_text(uuid, text, text) from public;
grant execute on function public.send_guest_text(uuid, text, text) to authenticated;
