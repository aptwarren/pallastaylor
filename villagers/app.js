/* ============================================================
   Villagers - guest intelligence for high-touch investor events
   Prototype: one self-contained static app. State lives in
   localStorage under "villagers.v2" - no backend, nothing leaves
   the browser. Views are rendered into <main id="app"> by a tiny
   hash router. Keep it dependency-free.
   ============================================================ */

"use strict";

/* ---------- work-in-progress gate ----------
   Client-side only. Keeps casual visitors out; NOT security.
   Change the phrase here when you share the link. */
const GATE_CODE = "villagers";

/* ---------- storage ---------- */
const STORE_KEY = "villagers.v2";
const LEGACY_KEY = "villagers.v1";

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupted store: reseed */ }
  return null;
}

function saveStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

/* One-time migration from the v1 prototype: carries forward only
   the host's own (non-sample) events and people, dropping the
   retired practice data. Sample-only v1 stores are replaced by the
   richer v2 sample set so every feature stays legible. */
const STORE_V = 2;

function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const old = JSON.parse(raw);
    if (!old || !Array.isArray(old.people)) return null;
    const realEvents = (old.events || []).filter(e => !e.sample);
    if (!realEvents.length) return null;
    const keepIds = new Set();
    const events = realEvents.map(e => {
      (e.guestIds || []).forEach(id => keepIds.add(id));
      return Object.assign(blankEvent(e.name), {
        id: e.id, date: e.date || "", location: e.location || "",
        win: e.goal || "", guestIds: e.guestIds || []
      });
    });
    const people = old.people.filter(p => keepIds.has(p.id)).map(p => Object.assign(blankPerson(p.name), {
      id: p.id, role: p.role || "", company: p.company || "",
      email: p.email || "", linkedin: p.linkedin || "",
      photoUrl: p.photoUrl || "", note: p.note || "",
      flags: { vip: !!(p.flags && p.flags.vip), plusOne: !!(p.flags && p.flags.plusOne) },
      dietary: (p.flags && p.flags.dietary) ? "Dietary note (carried over)" : ""
    }));
    return { v: STORE_V, people, events, seeded: false };
  } catch (e) { return null; }
}

let store = loadStore();
if (!store || store.v !== STORE_V) {
  store = migrateLegacy() || seedStore();
  saveStore();
}

/* ---------- model ----------
   person: { id, name, role, company, email, linkedin, photoUrl,
             context, contextSuggested, dietary, note,
             flags: {vip, plusOne} }
   event:  { id, name, templateId, date, doorsTime, location, win,
             hostName, digestMinutes, guestIds: [], sample,
             rsvp: { personId: {status, dietary, plusOne, note, at} },
             intel: { personId: {arriving, ask, avoid, openLoop} },
             edges: [{ id, aId, bId, basis }] } */

function uid(prefix) {
  return prefix + "-" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function blankPerson(name) {
  return {
    id: uid("p"), name: name || "", role: "", company: "", email: "",
    linkedin: "", photoUrl: "", context: "", contextSuggested: false,
    dietary: "", note: "", flags: { vip: false, plusOne: false }
  };
}

function blankEvent(name) {
  return {
    id: uid("e"), name: name || "", templateId: "scratch", date: "",
    doorsTime: "18:00", location: "", win: "", hostName: "",
    digestMinutes: 60, guestIds: [], sample: false,
    rsvp: {}, intel: {}, edges: []
  };
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

/* ---------- event templates ----------
   Gatsby-flavored starting points: each sets the tone of the guest
   RSVP page and sensible defaults for the host. */
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

/* ---------- sample data ----------
   Fictional people and events so every screen is legible on first
   open, including the digest example from the product spec.
   Clear them with one click from the Events view. */
function seedStore() {
  const maya = Object.assign(blankPerson("Maya Chen"), {
    role: "Partner", company: "Northline Ventures",
    context: "Leads consumer investments at Northline. Writes the firm's LP letter.",
    contextSuggested: true, flags: { vip: true, plusOne: false }
  });
  const elena = Object.assign(blankPerson("Elena Rossi"), {
    role: "Principal", company: "Northline Ventures",
    context: "Maya's colleague at Northline. Just back from a month in Peru.",
    contextSuggested: true, dietary: "Vegetarian", flags: { vip: false, plusOne: false }
  });
  const priya = Object.assign(blankPerson("Priya Raman"), {
    role: "Head of Platform", company: "Alloy Capital",
    context: "Runs founder programming at Alloy. Potential collaborator on events.",
    contextSuggested: true
  });
  const tom = Object.assign(blankPerson("Tom Okafor"), {
    role: "Founder", company: "Meridian Labs",
    context: "Seed-stage dev tools. Charming, talks fast."
  });
  const sam = Object.assign(blankPerson("Sam Whitfield"), {
    role: "LP Relations", company: "Harborview",
    context: "Quiet. Prefers intros over mingling."
  });
  const june = Object.assign(blankPerson("June Park"), {
    role: "Chief of Staff", company: "Alloy Capital",
    context: "Priya's chief of staff. Gatekeeper in the good sense.",
    flags: { vip: false, plusOne: true }
  });
  const alex = Object.assign(blankPerson("Alex Moreau"), {
    role: "Angel Investor", company: "",
    context: "Writes small early checks. Big on hospitality.",
    flags: { vip: true, plusOne: false }
  });
  const nina = Object.assign(blankPerson("Nina Kowalski"), {
    role: "Founder", company: "Fable & Co",
    context: "Consumer brand, pre-seed."
  });

  const breakfast = Object.assign(blankEvent("Founder Breakfast (sample)"), {
    templateId: "breakfast", date: "2026-08-26", doorsTime: "08:30",
    location: "West Village", win: "Reactivate dormant founder relationships.",
    guestIds: [maya.id, tom.id, nina.id], sample: true
  });
  breakfast.intel[maya.id] = { arriving: "08:30", ask: "Thank her for the LP dinner intro.", avoid: "", openLoop: "She asked about LP dinner formats." };
  breakfast.rsvp[maya.id] = { status: "yes", at: "2026-08-20" };
  breakfast.rsvp[tom.id] = { status: "yes", at: "2026-08-21" };

  const salon = Object.assign(blankEvent("Fall Salon Dinner (sample)"), {
    templateId: "salon", date: "2026-10-02", doorsTime: "18:15",
    location: "Tribeca", digestMinutes: 60, hostName: "Arielle",
    win: "Eight seats. Mix two LPs with four founders and two platform leads; every guest leaves with one warm intro.",
    guestIds: [maya.id, priya.id, elena.id, sam.id, june.id, alex.id], sample: true
  });
  salon.intel[elena.id] = {
    arriving: "18:15",
    ask: "ask about her Peru trip",
    avoid: "her fund just passed on a deal you're close to",
    openLoop: "she said she'd send the Northline deck"
  };
  salon.intel[maya.id] = {
    arriving: "18:10",
    ask: "say thank you - she vouched for you with two LPs",
    avoid: "",
    openLoop: "she asked about your Series B timeline"
  };
  salon.intel[priya.id] = {
    arriving: "",
    ask: "pure relationship maintenance",
    avoid: "Alloy's layoffs last month",
    openLoop: ""
  };
  salon.intel[sam.id] = { arriving: "18:20", ask: "get him talking to Tom", avoid: "", openLoop: "" };
  salon.rsvp[elena.id] = { status: "yes", dietary: "Vegetarian", at: "2026-09-25" };
  salon.rsvp[maya.id] = { status: "yes", at: "2026-09-24" };
  salon.rsvp[priya.id] = { status: "yes", at: "2026-09-26" };
  salon.rsvp[sam.id] = { status: "yes", at: "2026-09-27" };
  salon.rsvp[june.id] = { status: "maybe", at: "2026-09-28" };
  salon.edges = [
    { id: uid("x"), aId: elena.id, bId: maya.id, basis: "they overlap on Northline" },
    { id: uid("x"), aId: sam.id, bId: alex.id, basis: "Sam asked for a warm intro to active angels" }
  ];

  return { v: STORE_V, people: [maya, elena, priya, tom, sam, june, alex, nina], events: [salon, breakfast], seeded: true };
}

function clearSamples() {
  const sampleEventIds = new Set(store.events.filter(e => e.sample).map(e => e.id));
  store.events = store.events.filter(e => !e.sample);
  store.people = store.people.filter(p => eventsFor(p.id).length > 0);
  store.seeded = false;
  saveStore();
}

/* ---------- CSV-ish import ----------
   Header row (name, role, company, email, linkedin) or bare names. */
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

function addGuestsToEvent(event, guests) {
  const stats = { added: 0, returning: 0, duplicates: 0 };
  for (const g of guests) {
    const existing = findPerson(g);
    if (existing) {
      if (event.guestIds.includes(existing.id)) { stats.duplicates++; continue; }
      stats.returning++;
      existing.role = existing.role || g.role;
      existing.company = existing.company || g.company;
      existing.email = existing.email || g.email;
      existing.linkedin = existing.linkedin || g.linkedin;
      event.guestIds.push(existing.id);
    } else {
      const person = Object.assign(blankPerson(g.name.trim()), {
        role: g.role || "", company: g.company || "",
        email: (g.email || "").trim(), linkedin: (g.linkedin || "").trim()
      });
      store.people.push(person);
      event.guestIds.push(person.id);
      stats.added++;
    }
  }
  saveStore();
  return stats;
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

function backendNote(text) {
  return `<span class="backend-note" title="Needs the real backend">${esc(text)}</span>`;
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
        loops for each guest, and texts you the digest an hour before doors.</p>
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
        <p class="field-note">Nothing uploads. The list stays in this browser. Never paste a real list into the repo itself.</p>
        <button class="button" type="submit">Create the event</button>
      </form>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Your events</h2>
        ${store.seeded ? `<button class="button subtle small" id="clear-samples">Clear sample data</button>` : ""}
      </div>
      <div class="event-list">
        ${events.length ? events.map(e => {
          const returning = e.guestIds.filter(id => eventsFor(id).length > 1).length;
          const yesCount = Object.values(e.rsvp || {}).filter(r => r.status === "yes").length;
          return `
          <div class="event-tile" data-open-event="${e.id}">
            <span class="tile-date">${fmtDate(e.date)}${e.sample ? ' · <span class="tile-sample">sample</span>' : ""}</span>
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

  document.getElementById("new-event-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = pendingTemplate || TEMPLATES[3];
    const event = Object.assign(blankEvent(document.getElementById("ev-name").value.trim()), {
      templateId: t.id,
      date: document.getElementById("ev-date").value,
      doorsTime: document.getElementById("ev-doors").value || t.defaults.doorsTime,
      location: document.getElementById("ev-location").value.trim(),
      hostName: document.getElementById("ev-host").value.trim(),
      win: document.getElementById("ev-win").value.trim(),
      digestMinutes: t.defaults.digestMinutes
    });
    store.events.push(event);
    const pasted = parseGuestText(document.getElementById("ev-guests").value);
    if (pasted.length) addGuestsToEvent(event, pasted);
    saveStore();
    location.hash = "#/event/" + event.id;
  });

  const clearBtn = document.getElementById("clear-samples");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    clearSamples();
    renderEvents();
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
  if (parts[0] === "event" && parts[1]) return renderEvent(parts[1], parts[2] || "guests");
  if (parts[0] === "rsvp" && parts[1]) return renderRsvpPage(parts[1]);
  if (parts[0] === "people") return renderPeople();
  if (parts[0] === "real") return renderReal();
  return renderEvents();
}

function boot() {
  const gate = document.getElementById("gate");
  const input = document.getElementById("gate-input");
  const button = document.getElementById("gate-button");
  const error = document.getElementById("gate-error");
  const unlocked = sessionStorage.getItem("villagers.gate") === "1";
  if (unlocked) {
    gate.remove();
  } else {
    gate.hidden = false;
    input.focus();
    const tryCode = () => {
      if (input.value.trim().toLowerCase() === GATE_CODE) {
        sessionStorage.setItem("villagers.gate", "1");
        gate.remove();
        route();
      } else {
        error.hidden = false;
        input.value = "";
        input.focus();
      }
    };
    button.addEventListener("click", tryCode);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryCode(); });
    return;
  }
  route();
}

window.addEventListener("hashchange", route);
