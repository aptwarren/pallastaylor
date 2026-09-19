/* ============================================================
   Villagers - guest intelligence for high-touch investor events
   v3: real backend. State lives in Supabase (Postgres + RLS);
   this app keeps an in-memory mirror ("store") for rendering and
   reloads it after every mutation. Views render into
   <main id="app"> via a tiny hash router.
   ============================================================ */

"use strict";

/* ---------- store (in-memory mirror of the database) ---------- */
let store = { people: [], events: [] };
let currentHost = null;
let storeLoaded = false;

/* ---------- time helpers (host timezone) ---------- */
function hostTz() { return (currentHost && currentHost.timezone) || "America/New_York"; }

function zonedToUtcIso(dateStr, timeStr, tz) {
  const t = timeStr || "18:00";
  const utcGuess = Date.parse(dateStr + "T" + t + ":00Z");
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = {};
  fmt.formatToParts(new Date(utcGuess)).forEach(p => { parts[p.type] = p.value; });
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return new Date(utcGuess - (asUtc - utcGuess)).toISOString();
}

function splitStartsAt(iso, tz) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const doorsTime = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { date, doorsTime };
}

function fmtTsDate(iso, tz) {
  if (!iso) return "Date TBD";
  return new Date(iso).toLocaleDateString(undefined, { timeZone: tz || hostTz(), weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

function fmtTsTime(iso, tz) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { timeZone: tz || hostTz(), hour: "numeric", minute: "2-digit" });
}

/* ---------- load: database -> store ---------- */
async function loadStoreFromDb() {
  const { data: hosts, error: hErr } = await sb.from("hosts").select("*").limit(1);
  if (hErr || !hosts || !hosts.length) { console.error("host load", hErr); return false; }
  currentHost = hosts[0];
  const [ppl, hp, evs, guests, edges] = await Promise.all([
    sb.from("people").select("*"),
    sb.from("host_people").select("*").eq("host_id", currentHost.id),
    sb.from("events").select("*").order("starts_at", { ascending: false }),
    sb.from("event_guests").select("*"),
    sb.from("connectors").select("*")
  ]);
  const overlay = {};
  (hp.data || []).forEach(r => { overlay[r.person_id] = r; });
  store.people = (ppl.data || []).map(p => {
    const o = overlay[p.id] || {};
    return {
      id: p.id, name: p.full_name, role: p.role || "", company: p.company || "",
      email: p.email || "", linkedin: p.linkedin || "", photoUrl: "",
      context: p.public_context || "", contextSuggested: !!p.context_suggested,
      dietary: o.dietary || "", note: o.private_notes || "",
      currentOpenLoop: o.current_open_loop || "",
      flags: { vip: !!o.vip, plusOne: false }
    };
  });
  const tz = hostTz();
  store.events = (evs.data || []).map(e => {
    const when = splitStartsAt(e.starts_at, tz);
    return {
      id: e.id, name: e.title, templateId: e.template_id || "scratch",
      date: when.date, doorsTime: when.doorsTime, startsAt: e.starts_at,
      location: e.location || "", win: e.win || "",
      hostName: e.host_name || currentHost.name || "",
      digestMinutes: e.digest_lead_minutes, sample: !!e.sample,
      rsvpToken: e.rsvp_public_token,
      debriefWin: e.debrief_win, debriefNotes: e.debrief_notes || "", debriefedAt: e.debriefed_at,
      guestIds: [], rsvp: {}, intel: {}, edges: []
    };
  });
  const evById = {};
  store.events.forEach(e => { evById[e.id] = e; });
  (guests.data || []).forEach(g => {
    const ev = evById[g.event_id];
    if (!ev) return;
    ev.guestIds.push(g.person_id);
    ev.intel[g.person_id] = {
      arriving: g.arrival_time || "", ask: g.ask || "",
      avoid: g.avoid || "", openLoop: g.open_loop || (personById(g.person_id) || {}).currentOpenLoop || "",
      debriefOpenLoop: g.debrief_open_loop || ""
    };
    if (g.responded_at) {
      ev.rsvp[g.person_id] = {
        status: g.rsvp_status, dietary: g.dietary || "",
        plusOne: !!g.plus_one, note: g.guest_note || "", at: g.responded_at
      };
    }
  });
  (edges.data || []).forEach(ed => {
    const ev = evById[ed.event_id];
    if (!ev) return;
    ev.edges.push({ id: ed.id, aId: ed.person_a_id, bId: ed.person_b_id, basis: ed.basis });
  });
  storeLoaded = true;
  return true;
}

/* ---------- mutations: database first, then reload ---------- */
async function dbInsertPerson(g) {
  /* Canonical person creation is host-scoped in the database RPC. */
  const { data, error } = await sb.rpc("create_host_person", {
    p_host_id: currentHost.id,
    p_full_name: g.name.trim(),
    p_email: (g.email || "").trim().toLowerCase() || null,
    p_role: g.role || null,
    p_company: g.company || null,
    p_linkedin: g.linkedin || null
  });
  if (error) { console.error("person create", error); return null; }
  return data;
}

async function dbAddGuests(event, guests) {
  const stats = { added: 0, returning: 0, duplicates: 0 };
  for (const g of guests) {
    const existing = findPerson(g);
    if (existing) {
      if (event.guestIds.includes(existing.id)) { stats.duplicates++; continue; }
      stats.returning++;
      const patch = {};
      if (!existing.role && g.role) patch.role = g.role;
      if (!existing.company && g.company) patch.company = g.company;
      if (!existing.email && g.email) patch.email = g.email.trim().toLowerCase();
      if (!existing.linkedin && g.linkedin) patch.linkedin = g.linkedin.trim();
      if (Object.keys(patch).length) await sb.from("people").update(patch).eq("id", existing.id);
      await sb.from("event_guests").insert({ event_id: event.id, person_id: existing.id });
    } else {
      const pid = await dbInsertPerson(g);
      if (!pid) continue;
      await sb.from("event_guests").insert({ event_id: event.id, person_id: pid });
      stats.added++;
    }
  }
  return stats;
}

async function dbCreateEvent(fields) {
  const starts_at = zonedToUtcIso(fields.date || new Date().toISOString().slice(0, 10), fields.doorsTime, hostTz());
  const { data, error } = await sb.from("events").insert({
    host_id: currentHost.id, title: fields.name, template_id: fields.templateId,
    starts_at, location: fields.location || null, win: fields.win || null,
    host_name: fields.hostName || currentHost.name,
    digest_lead_minutes: fields.digestMinutes || 60
  }).select("id").single();
  if (error) { console.error("event insert", error); return null; }
  return data.id;
}

async function dbSaveEventSettings(event, f) {
  const starts_at = zonedToUtcIso(f.date, f.doorsTime, hostTz());
  await sb.from("events").update({
    title: f.name, starts_at, location: f.location || null,
    host_name: f.hostName || null, win: f.win || null,
    digest_lead_minutes: f.digestMinutes
  }).eq("id", event.id);
}

async function dbDeleteEvent(eventId) {
  await sb.from("events").delete().eq("id", eventId);
}

async function dbRemoveGuest(eventId, personId) {
  await sb.from("connectors").delete().eq("event_id", eventId).or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`);
  await sb.from("event_guests").delete().eq("event_id", eventId).eq("person_id", personId);
}

async function dbUpdateIntel(eventId, personId, field, value) {
  const col = { arriving: "arrival_time", ask: "ask", avoid: "avoid", openLoop: "open_loop" }[field];
  if (!col) return;
  await sb.from("event_guests").update({ [col]: value || null }).eq("event_id", eventId).eq("person_id", personId);
}

async function dbUpdatePersonGlobal(personId, field, value) {
  if (field === "dietary") {
    await sb.from("host_people").update({ dietary: value || null }).eq("host_id", currentHost.id).eq("person_id", personId);
  } else if (field === "note") {
    await sb.from("host_people").update({ private_notes: value || null }).eq("host_id", currentHost.id).eq("person_id", personId);
  } else if (field === "vip") {
    await sb.from("host_people").update({ vip: !!value }).eq("host_id", currentHost.id).eq("person_id", personId);
  } else {
    const col = { role: "role", company: "company", email: "email", linkedin: "linkedin", context: "public_context" }[field];
    if (!col) return;
    const patch = { [col]: value || null };
    if (field === "context") patch.context_suggested = false;
    if (field === "email" && value) patch.email = value.trim().toLowerCase();
    await sb.from("people").update(patch).eq("id", personId);
  }
}

async function dbAddEdge(eventId, aId, bId, basis) {
  await sb.from("connectors").insert({ event_id: eventId, person_a_id: aId, person_b_id: bId, basis });
}

async function dbDelEdge(id) {
  await sb.from("connectors").delete().eq("id", id);
}

async function dbSaveDebrief(event, didWin, notes, guestLoops) {
  for (const [personId, value] of Object.entries(guestLoops)) {
    const loop = (value || "").trim();
    await sb.from("event_guests").update({ debrief_open_loop: loop || null })
      .eq("event_id", event.id).eq("person_id", personId);
    await sb.from("host_people").update({ current_open_loop: loop || null })
      .eq("host_id", currentHost.id).eq("person_id", personId);
  }
  await sb.from("events").update({
    debrief_win: didWin, debrief_notes: (notes || "").trim() || null,
    debriefed_at: new Date().toISOString()
  }).eq("id", event.id);
}

async function dbMarkIntroSent(edgeId, message) {
  await sb.from("connectors").update({
    intro_sent_at: new Date().toISOString(), intro_message: message
  }).eq("id", edgeId);
}

async function dbLogFollowUp(edgeId, count) {
  await sb.from("connectors").update({
    follow_up_count: count, follow_up_logged_at: new Date().toISOString()
  }).eq("id", edgeId);
}

async function dbClearSamples() {
  await sb.from("events").delete().eq("sample", true);
  /* Drop host_people rows for people no longer on any event, so the
     directory matches what the events actually reference. */
  const { data: remaining } = await sb.from("event_guests").select("person_id");
  const keep = new Set((remaining || []).map(r => r.person_id));
  const { data: hpRows } = await sb.from("host_people").select("person_id").eq("host_id", currentHost.id);
  const drop = (hpRows || []).map(r => r.person_id).filter(pid => !keep.has(pid));
  for (const pid of drop) {
    await sb.from("host_people").delete().eq("host_id", currentHost.id).eq("person_id", pid);
  }
}


/* ---------- model helpers (operate on the mirror) ---------- */
function uid(prefix) {
  return prefix + "-" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function normalizeName(name) {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function personById(id) { return store.people.find(p => p.id === id) || null; }
function eventById(id) { return store.events.find(e => e.id === id) || null; }

/* Cross-event memory: find a known person by email (strongest) or
   exact normalized name. */
function findPerson(candidate) {
  const email = (candidate.email || "").trim().toLowerCase();
  const name = normalizeName(candidate.name);
  return store.people.find(p =>
    (email && p.email && p.email.toLowerCase() === email) ||
    (name && normalizeName(p.name) === name)
  ) || null;
}

function eventsFor(personId) {
  return store.events.filter(e => e.guestIds.includes(personId));
}

function intelFor(event, personId) {
  if (!event.intel[personId]) event.intel[personId] = { arriving: "", ask: "", avoid: "", openLoop: "" };
  return event.intel[personId];
}

function rsvpFor(event, personId) {
  return event.rsvp[personId] || null;
}

function firstName(name) { return (name || "").trim().split(/\s+/)[0] || ""; }

/* Connector edges involving a guest inside one event. */
function edgesFor(event, personId) {
  return (event.edges || []).filter(ed => ed.aId === personId || ed.bId === personId);
}

/* ---------- event templates ---------- */
const TEMPLATES = [
  {
    id: "breakfast",
    name: "Investor Breakfast",
    tag: "Morning · seated · 8-10",
    blurb: "Coffee, one long table, everyone out by 10. Quiet room, direct conversations.",
    defaults: { doorsTime: "08:30", digestMinutes: 60, win: "Every founder leaves with one warm intro." }
  },
  {
    id: "happyhour",
    name: "Happy Hour",
    tag: "Evening · standing · 15-30",
    blurb: "Drinks and a loose room. The host works the edges; pairings do the heavy lifting.",
    defaults: { doorsTime: "17:30", digestMinutes: 45, win: "Two portfolio intros and one LP relationship moved forward." }
  },
  {
    id: "salon",
    name: "Salon Dinner",
    tag: "Evening · seated · 8-12",
    blurb: "A set table, a seating plan, one conversation. The highest-touch format.",
    defaults: { doorsTime: "18:15", digestMinutes: 60, win: "Every guest leaves with one warm intro." }
  },
  {
    id: "scratch",
    name: "Start from scratch",
    tag: "Blank canvas",
    blurb: "No preset - name it, set the doors, write the win.",
    defaults: { doorsTime: "18:00", digestMinutes: 60, win: "" }
  }
];

/* ---------- CSV-ish import ---------- */
function parseGuestText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const splitRow = (line) => {
    const cells = [];
    line.replace(/("([^"]|"")*"|[^,]*)(,|$)/g, (m, cell) => {
      cells.push(cell.replace(/^"|"$/g, "").replace(/""/g, '"').trim());
      return m;
    });
    if (cells.length && cells[cells.length - 1] === "") cells.pop();
    return cells;
  };
  const headerAliases = {
    name: ["name", "full name", "guest", "guest name", "attendee"],
    role: ["role", "title", "job title", "position"],
    company: ["company", "org", "organization", "employer", "firm"],
    email: ["email", "e-mail", "email address"],
    linkedin: ["linkedin", "linkedin url", "linkedin profile", "profile"]
  };
  const firstCells = splitRow(lines[0]).map(c => c.toLowerCase());
  let colMap = null;
  for (const [field, aliases] of Object.entries(headerAliases)) {
    const idx = firstCells.findIndex(c => aliases.includes(c));
    if (idx !== -1) (colMap = colMap || {})[field] = idx;
  }
  const rows = colMap && colMap.name !== undefined ? lines.slice(1) : lines;
  return rows.map(line => {
    const cells = splitRow(line);
    if (colMap && colMap.name !== undefined) {
      return {
        name: cells[colMap.name] || "",
        role: colMap.role !== undefined ? cells[colMap.role] || "" : "",
        company: colMap.company !== undefined ? cells[colMap.company] || "" : "",
        email: colMap.email !== undefined ? cells[colMap.email] || "" : "",
        linkedin: colMap.linkedin !== undefined ? cells[colMap.linkedin] || "" : ""
      };
    }
    return { name: cells[0] || "", role: cells[1] || "", company: cells[2] || "", email: "", linkedin: "" };
  }).filter(g => g.name);
}

/* ---------- avatars ---------- */
function initials(name) {
  return (name || "").trim().split(/\s+/).slice(0, 2).map(w => (w[0] || "").toUpperCase()).join("") || "?";
}

async function gravatarUrl(email) {
  try {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(email.trim().toLowerCase()))))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    return "https://www.gravatar.com/avatar/" + hash + "?s=256&d=404";
  } catch (e) { return null; }
}

function avatarHtml(person, cls) {
  return `<span class="avatar ${cls || ""}" data-avatar="${person.id}">${initials(person.name)}</span>`;
}

async function hydrateAvatars() {
  document.querySelectorAll("[data-avatar]").forEach(async (el) => {
    const person = personById(el.dataset.avatar);
    if (!person) return;
    const url = person.photoUrl || (person.email ? await gravatarUrl(person.email) : null);
    if (!url || el.dataset.hydrated) return;
    el.dataset.hydrated = "1";
    const img = new Image();
    img.onload = () => { el.innerHTML = ""; el.appendChild(img); };
    img.src = url;
    img.alt = person.name;
  });
}

/* ============================================================
   Rendering helpers
   ============================================================ */
const app = document.getElementById("app");
const esc = (s) => (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDate(d) {
  if (!d) return "Date TBD";
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtTimeShort(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hr}:${String(m).padStart(2, "0")}${ampm}` : `${hr}${ampm}`;
}

/* When the digest lands: doors time minus the configured lead. */
function digestTime(event) {
  if (!event.doorsTime) return "";
  const [h, m] = event.doorsTime.split(":").map(Number);
  const total = h * 60 + m - (event.digestMinutes || 60);
  const hh = ((Math.floor(total / 60) % 24) + 24) % 24;
  const mm = ((total % 60) + 60) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function setNav(active) {
  document.querySelectorAll("[data-nav]").forEach(a =>
    a.classList.toggle("active", a.dataset.nav === active));
}

function returningBadge(person, currentEventId) {
  const others = eventsFor(person.id).filter(e => e.id !== currentEventId);
  if (!others.length) return "";
  const names = others.map(e => esc(e.name.replace(/ \(sample\)$/, ""))).join(", ");
  return `<div class="guest-memory">Met before: ${names}</div>`;
}

/* ============================================================
   View: Events (home)
   ============================================================ */
function renderEvents() {
  setNav("events");
  const events = store.events.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">Villagers · by Pallas Taylor</p>
      <h1>Know the room<br />before you're <em>in it.</em></h1>
      <p class="lede">Guest list in, intelligence out. Villagers keeps a standing record of
        everyone you've ever hosted, arms you with the ask, the avoid list and the open
        loops for each guest, and emails you the digest an hour before doors.</p>
    </section>

    <section class="section" id="new">
      <div class="section-head"><h2>Start an event</h2></div>
      <div class="template-grid">
        ${TEMPLATES.map(t => `
          <button class="template-card" data-template="${t.id}" type="button">
            <span class="template-tag">${esc(t.tag)}</span>
            <h3>${esc(t.name)}</h3>
            <p>${esc(t.blurb)}</p>
            <span class="template-go">Use this template →</span>
          </button>`).join("")}
      </div>
      <form class="new-event" id="new-event-form" hidden>
        <p class="eyebrow" id="ne-eyebrow">New event</p>
        <div class="new-event-grid">
          <div>
            <label for="ev-name">Event name</label>
            <input id="ev-name" required placeholder="Fall Salon Dinner" />
            <label for="ev-date">Date</label>
            <input id="ev-date" type="date" />
            <label for="ev-doors">Doors at</label>
            <input id="ev-doors" type="time" value="18:00" />
          </div>
          <div>
            <label for="ev-location">Location</label>
            <input id="ev-location" placeholder="Tribeca" />
            <label for="ev-host">Host name (guests see this)</label>
            <input id="ev-host" placeholder="Arielle" />
            <label for="ev-win">The win - what does success look like?</label>
            <input id="ev-win" placeholder="Every guest leaves with one warm intro." />
          </div>
        </div>
        <label for="ev-guests">Guest list (optional - paste now, import later)</label>
        <textarea id="ev-guests" placeholder="Names, one per line - or a CSV with columns like name, role, company, email, linkedin."></textarea>
        <p class="field-note">The list saves securely and syncs across your phone and laptop.</p>
        <button class="button" type="submit">Create the event</button>
      </form>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Your events</h2>
        
      </div>
      <div class="event-list">
        ${events.length ? events.map(e => {
          const returning = e.guestIds.filter(id => eventsFor(id).length > 1).length;
          const yesCount = Object.values(e.rsvp || {}).filter(r => r.status === "yes").length;
          return `
          <div class="event-tile" data-open-event="${e.id}">
            <span class="tile-date">${fmtDate(e.date)}</span>
            <h3>${esc(e.name)}</h3>
            <span class="tile-meta">${e.guestIds.length} guest${e.guestIds.length === 1 ? "" : "s"}${yesCount ? " · " + yesCount + " confirmed" : ""}${e.location ? " · " + esc(e.location) : ""}</span>
            ${returning ? `<span class="tile-returning">${returning} returning guest${returning === 1 ? "" : "s"} remembered</span>` : ""}
          </div>`;
        }).join("") : `<p class="empty-state">No events yet. Pick a template above and Villagers sets up the rest.</p>`}
      </div>
    </section>`;

  let pendingTemplate = null;
  document.querySelectorAll("[data-template]").forEach(btn => btn.addEventListener("click", () => {
    pendingTemplate = TEMPLATES.find(t => t.id === btn.dataset.template);
    const form = document.getElementById("new-event-form");
    form.hidden = false;
    document.getElementById("ne-eyebrow").textContent = "New event · " + pendingTemplate.name;
    document.getElementById("ev-doors").value = pendingTemplate.defaults.doorsTime;
    document.getElementById("ev-win").value = pendingTemplate.defaults.win;
    document.getElementById("ev-name").focus();
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }));

  document.getElementById("new-event-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const t = pendingTemplate || TEMPLATES[3];
    const fields = {
      name: document.getElementById("ev-name").value.trim(),
      templateId: t.id,
      date: document.getElementById("ev-date").value,
      doorsTime: document.getElementById("ev-doors").value || t.defaults.doorsTime,
      location: document.getElementById("ev-location").value.trim(),
      hostName: document.getElementById("ev-host").value.trim(),
      win: document.getElementById("ev-win").value.trim(),
      digestMinutes: t.defaults.digestMinutes
    };
    if (!fields.name) return;
    const btn = ev.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Creating...";
    const eventId = await dbCreateEvent(fields);
    if (eventId) {
      const pasted = parseGuestText(document.getElementById("ev-guests").value);
      if (pasted.length) await dbAddGuests({ id: eventId, guestIds: [] }, pasted);
      await loadStoreFromDb();
      location.hash = "#/event/" + eventId;
    } else {
      btn.disabled = false; btn.textContent = "Create the event";
    }
  });

  document.querySelectorAll("[data-open-event]").forEach(tile => tile.addEventListener("click", () => {
    location.hash = "#/event/" + tile.dataset.openEvent;
  }));
}

/* ============================================================
   Router + boot
   ============================================================ */
function route() {
  const hash = location.hash || "#/";
  const parts = hash.replace(/^#\//, "").split("/");
  window.scrollTo(0, 0);
  if (parts[0] === "rsvp" && parts[1]) return renderRsvpPage(parts[1]);
  if (!storeLoaded) { location.hash = "#/"; return; }
  if (parts[0] === "event" && parts[1]) return renderEvent(parts[1], parts[2] || "guests");
  if (parts[0] === "people") return renderPeople();
  if (parts[0] === "after") return renderAfter();
  return renderEvents();
}

/* Live updates: when an RSVP lands (guest side writes straight to
   the database), reload the mirror and re-render - unless the host
   is mid-edit in a field. */
function subscribeRealtime() {
  sb.channel("event-guest-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "event_guests" }, async () => {
      /* A signed-in host previewing the guest RSVP page stays put -
         the re-render would wipe the guest's confirmation state. */
      if ((location.hash || "").startsWith("#/rsvp/")) return;
      await loadStoreFromDb();
      const active = document.activeElement;
      const editing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
      if (!editing) route();
    })
    .subscribe();
}

async function enterRoom() {
  const gate = document.getElementById("gate");
  if (gate) gate.remove();
  app.innerHTML = `<section class="hero"><p class="lede">Opening the room...</p></section>`;
  const ok = await loadStoreFromDb();
  if (!ok) {
    app.innerHTML = `<section class="hero"><p class="lede">Could not open your Villagers room. Refresh to try again.</p></section>`;
    return;
  }
  subscribeRealtime();
  route();
}

function boot() {
  const hash = location.hash || "#/";
  /* Guest RSVP pages are public: no pass phrase, no sign-in. */
  if (hash.startsWith("#/rsvp/")) {
    const gate = document.getElementById("gate");
    if (gate) gate.remove();
    route();
    return;
  }
  const gate = document.getElementById("gate");
  const input = document.getElementById("gate-input");
  const button = document.getElementById("gate-button");
  const error = document.getElementById("gate-error");
  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) { enterRoom(); return; }
    gate.hidden = false;
    input.focus();
    const requestLink = async () => {
      button.disabled = true;
      error.hidden = true;
      const email = input.value.trim().toLowerCase();
      const redirectTo = location.origin + location.pathname;
      const { error: signInError } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false }
      });
      button.disabled = false;
      if (!signInError) {
        input.disabled = true;
        button.hidden = true;
        document.querySelector(".gate-note").textContent = "Check your email for your private sign-in link.";
      } else {
        error.textContent = "That email does not have host access.";
        error.hidden = false;
        input.focus();
      }
    };
    button.addEventListener("click", requestLink);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") requestLink(); });
  });
}

window.addEventListener("hashchange", route);
