-- Villagers v3 workspace (2026-10-07)
-- Outcome numbers for the Recap tab, and a per-host conversation starter on People records.
-- Existing row-level-security policies on events and host_people already cover these columns.

alter table public.events
  add column if not exists attended_count int,
  add column if not exists target_total int,
  add column if not exists targets_advanced int,
  add column if not exists founder_meetings int,
  add column if not exists cost_usd numeric;

alter table public.host_people
  add column if not exists conversation_starter text;
