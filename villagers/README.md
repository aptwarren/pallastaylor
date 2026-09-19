# Villagers

Guest intelligence for hosts running high-touch investor/LP events - breakfasts,
happy hours, salon dinners. Build the guest list, get the ask / avoid list / open
loops for every attendee, and walk in ready.

**Pass phrase:** `villagers` (signs the host in through Supabase Auth. It is one
shared phrase for now, not per-user accounts - rotate it by changing the host
user's password in Supabase if it ever leaks beyond intent.)

## The three pieces

- **A - Event templates & RSVP.** Gatsby-flavored templates (Investor Breakfast,
  Happy Hour, Salon Dinner). Each event gets a guest-facing RSVP page at
  `#/rsvp/<token>`; the host copies the link and sends it from their own
  number/email, so guests experience it as coming from the host, not Villagers.
  Guest responses write straight to the database and appear on the host's guest
  list in real time.
- **B - People.** A standing record per person across every event - role,
  company, public context, dietary, notes. Returning guests show prior event
  history ("Met before: Founder Breakfast") and open loops carry forward.
- **C - Guest intelligence & connector layer.** Per event, per guest: the ask,
  the avoid list, the open loop, arrival time. Manual connector tags ("who
  should meet whom", an edge between two guests with a credible basis). All of
  it renders into a day-of digest (T-minus-60 before doors, configurable) that
  a database worker generates and emails to the host automatically.

## Backend

- **Supabase (free tier)** - Postgres with row-level security. Tables: `hosts`,
  `host_members`, `people` (canonical, platform-wide), `host_people`
  (per-host private data), `events`, `event_guests` (RSVP + per-event
  intelligence), `connectors`, `digest_deliveries`.
- **Schema is multi-host by design**: canonical People can accumulate
  platform-wide enrichment while each host's notes stay private to them.
- **Public RSVP**: `get_rsvp_event` / `submit_rsvp` RPCs, granted to anonymous
  callers, keyed by the event's `rsvp_public_token`.
- **Digest worker**: `pg_cron` runs `process_due_digests()` every minute; due
  rows in `digest_deliveries` are rendered by `build_digest_text()` and emailed
  via `pg_net` through the email provider's API (key lives in the `app_config`
  table, which has RLS enabled and no read policies).
- The front end talks to Supabase with the public anon key in `config.js` -
  safe to commit because every table is behind RLS; the host signs in with the
  pass phrase (Supabase Auth), guests only ever reach the RSVP RPCs.

## What is real vs. stubbed

(2026-09-19: the in-app "What's real" page and all prototype/backend scaffolding
copy were removed from the client-facing app - this README is now the one place
that line is drawn.)

- **Real:** persistence + phone/laptop sync, live RSVP routing, the digest
  emailing itself at T-60, the full People/intelligence/connector layer.
- **Still ahead:** sending from the host's own email domain (needs a DNS
  verification step), SMS digest delivery (paid provider - deliberately not
  bought), LinkedIn/public-data auto-pull, automatic connector matching,
  per-host accounts.
- **Never commit a real guest list here.** Guest data lives in the database,
  not the repo.
- Practice (the v1 flashcard mode) was cut from the product spec and is gone.

## Files

- `index.html` - shell, gate, nav
- `config.js` - Supabase URL + public anon key
- `app.js` - store mirror, db layer, model, templates, router, events home
- `views-event.js` - event dashboard: guests, connectors, digest, RSVP, settings
- `views-pages.js` - guest-facing RSVP page, People directory
- `villagers.css` - styles (Pallas Taylor purple system)
