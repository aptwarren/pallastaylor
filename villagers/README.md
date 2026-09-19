# Villagers (prototype)

Guest intelligence for hosts running high-touch investor/LP events - breakfasts,
happy hours, salon dinners. Build the guest list, get the ask / avoid list / open
loops for every attendee, and walk in ready.

**Pass phrase:** `villagers` (client-side gate only - keeps casual visitors out,
it is not security. Change `GATE_CODE` in `app.js`.)

## The three pieces

- **A - Event templates & RSVP.** Gatsby-flavored templates (Investor Breakfast,
  Happy Hour, Salon Dinner). Each event gets a guest-facing RSVP page at
  `#/rsvp/<eventId>`; the host copies the link and sends it from their own
  number/email, so guests experience it as coming from the host, not Villagers.
- **B - People.** A standing record per person across every event - role,
  company, public context, dietary, notes. Returning guests show prior event
  history ("Met before: Founder Breakfast") and open loops carry forward.
- **C - Guest intelligence & connector layer.** Per event, per guest: the ask,
  the avoid list, the open loop, arrival time. Manual connector tags ("who
  should meet whom", an edge between two guests with a credible basis). All of
  it renders into a day-of text digest (T-minus-60 before doors, configurable).

## What is real vs. stubbed

- **All data is local.** Everything lives in `localStorage` (`villagers.v2`) in
  the visitor's browser. No backend, nothing uploads, no phone/laptop sync.
- **Never commit a real guest list here.** Imports stay on the device.
- The in-product **"What's real"** view lists the exact line between prototype
  and backend: send-from-host-identity, LinkedIn/public-data auto-pull, actually
  texting the digest, automatic connector matching, and sync are all backend work.
- Practice (the v1 flashcard mode) was cut from the product spec and is gone.

## Files

- `index.html` - shell, gate, nav
- `app.js` - store, model, seed data, templates, router, events home
- `views-event.js` - event dashboard: guests, connectors, digest, RSVP, settings
- `views-pages.js` - guest-facing RSVP page, People directory, What's real
- `villagers.css` - styles (Pallas Taylor purple system)
