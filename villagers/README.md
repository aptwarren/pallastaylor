# Villagers · Names & Faces

The host's briefing book, living at `pallastaylor.com/villagers/`. A work-in-progress
corner of the Pallas Taylor site: the public brand stays Pallas Taylor, clients get
one door.

## What it does

- **Events → briefing books.** Paste a guest list (names, or CSV with
  `name, role, company, email, linkedin` columns) and get a clean, scannable book:
  photo/monogram, role, context, flags (VIP / dietary / plus-one), must-meet stars.
- **Cross-event guest memory.** Returning guests are recognized by email or name.
  Their notes, flags, and event history carry over - the card shows "also at".
- **Practice mode.** Flashcards weighted toward the names you miss and the ones
  you have not seen lately. Face first, reveal the name, mark knew/missed.
- **Print briefing.** The print stylesheet produces a tight PDF-style sheet for
  the night of the event (browser Print → Save as PDF).
- **CSV export** of any book, including the "also at" memory.

## What is real vs. stubbed

- **All data is local.** Everything lives in `localStorage` (`villagers.v1`) in the
  visitor's browser. There is no backend; nothing uploads. That also means data does
  not sync between Arielle's phone and laptop - each device has its own memory.
- **The gate is a marker, not security.** `GATE_CODE` in `app.js` (default
  `villagers`) is a client-side check; anyone who reads the source can bypass it.
  Fine for a work-in-progress sign. If guest data ever becomes sensitive, this needs
  a real backend with auth.
- **Photos** come from an explicit photo URL or Gravatar (by guest email). There is
  no LinkedIn/AI research pipeline here - that is the paid-product question.
- **Import formats:** pasted text or `.csv`. `.xlsx` is not parsed (no dependencies
  wanted); export from the event tool as CSV first.

## Files

- `index.html` - shell, gate, nav
- `villagers.css` - design system (tokens match the main site's `styles.css`)
- `app.js` - store, parser, router, views, practice queue. Plain JS, no build step.

## Next steps when it becomes real

1. Backend + real auth (supabase/clerk-style) so memory syncs across devices.
2. AI enrichment pipeline (photo, role, news per guest) behind the book build.
3. Client accounts: each Pallas Taylor client sees only their own events.
4. Robots: page is `noindex` and intentionally absent from `sitemap.xml` - keep it
   that way while gated.
