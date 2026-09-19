/* ============================================================
   Villagers - Names & Faces
   The host's briefing book: names, faces and context for every
   guest, remembered across every event.

   Architecture: one self-contained static app. State lives in
   localStorage under "villagers.v1" - no backend, nothing leaves
   the browser. Views are rendered into <main id="app"> by a tiny
   hash router. Keep it dependency-free.
   ============================================================ */

"use strict";

/* ---------- work-in-progress gate ----------
   Client-side only. Keeps casual visitors out; NOT security.
   Change the phrase here when you share the link. */
const GATE_CODE = "villagers";

/* ---------- storage ---------- */
const STORE_KEY = "villagers.v1";

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

let store = loadStore();
if (!store) {
  store = seedStore();
  saveStore();
}

/* ---------- model ----------
   person: { id, name, role, company, email, linkedin, photoUrl,
             note, flags: {vip, dietary, plusOne}, star,
             practice: {hits, misses, last} }
   event:  { id, name, date, location, goal, guestIds: [], sample } */

function uid(prefix) {
  return prefix + "-" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function normalizeName(name) {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/* Cross-event memory: find a person we already know by email
   (strongest) or exact normalized name. */
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

/* ---------- sample data ----------
   Two small events with one overlapping guest, so cross-event
   memory and practice are visible on first open. Fictional people;
   delete with one click from the Events view. */
function seedStore() {
  const p = (name, role, company, note, flags) => ({
    id: uid("p"), name, role, company,
    email: "", linkedin: "", photoUrl: "",
    note: note || "",
    flags: Object.assign({ vip: false, dietary: false, plusOne: false }, flags || {}),
    star: false,
    practice: { hits: 0, misses: 0, last: null }
  });

  const maya = p("Maya Chen", "Partner", "Northline Ventures", "Met at the founder breakfast - asked about LP dinner formats. Loves a small room.", { vip: true });
  const priya = p("Priya Raman", "Head of Platform", "Alloy Capital", "Runs their founder events. Potential collaborator.");
  const tom = p("Tom Okafor", "Founder", "Meridian Labs", "Seed stage, dev tools. Charming, talks fast.", {});
  const elena = p("Elena Rossi", "Principal", "Northline Ventures", "Maya's colleague. Vegetarian.", { dietary: true });
  const sam = p("Sam Whitfield", "LP relations", "Harborview", "Quiet. Prefers intros over mingling.", {});
  const june = p("June Park", "Chief of Staff", "Alloy Capital", "Priya's chief of staff. Gatekeeper in the good sense.", { plusOne: true });
  const alex = p("Alex Moreau", "Angel investor", "", "Writes small early checks. Big on hospitality.", { vip: true });
  const nina = p("Nina Kowalski", "Founder", "Fable & Co", "Consumer brand, pre-seed.", {});

  const breakfast = {
    id: uid("e"), name: "Founder Breakfast (sample)", date: "2026-08-26",
    location: "West Village", goal: "Reactivate dormant founder relationships.",
    guestIds: [maya.id, tom.id, nina.id], sample: true
  };
  const salon = {
    id: uid("e"), name: "Spring Salon Dinner (sample)", date: "2026-10-02",
    location: "Tribeca", goal: "Eight seats. Mix two LPs with four founders and two platform leads; every guest should leave with one warm intro.",
    guestIds: [maya.id, priya.id, elena.id, sam.id, june.id, alex.id], sample: true
  };

  return { people: [maya, priya, tom, elena, sam, june, alex, nina], events: [salon, breakfast] };
}

/* ============================================================
   Import parsing
   Accepts CSV-ish text with a header row (name, role, company,
   email, linkedin, url) or a bare list of names, one per line.
   ============================================================ */
function parseGuestText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const splitRow = (line) => {
    // minimal CSV: respects double-quoted cells
    const cells = [];
    line.replace(/("([^"]|"")*"|[^,]*)(,|$)/g, (m, cell) => {
      cells.push(cell.replace(/^"|"$/g, "").replace(/""/g, '"').trim());
      return m;
    });
    if (cells.length && cells[cells.length - 1] === "") cells.pop();
    return cells;
  };

  const headerAliases = {
    name: ["name", "full name", "guest", "guest name", "attendee", "first last"],
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
    // No recognizable header: treat "Name, Role, Company" or just "Name".
    return { name: cells[0] || "", role: cells[1] || "", company: cells[2] || "", email: "", linkedin: "" };
  }).filter(g => g.name);
}

/* Add parsed guests to an event, merging into known people.
   Returns import stats for the hint line. */
function addGuestsToEvent(event, guests) {
  const stats = { added: 0, returning: 0, missingRole: 0, duplicates: 0 };
  for (const g of guests) {
    if (!g.role) stats.missingRole++;
    const existing = findPerson(g);
    if (existing) {
      stats.returning++;
      if (event.guestIds.includes(existing.id)) { stats.duplicates++; continue; }
      // Enrich the known record with anything new.
      existing.role = existing.role || g.role;
      existing.company = existing.company || g.company;
      existing.email = existing.email || g.email;
      existing.linkedin = existing.linkedin || g.linkedin;
      event.guestIds.push(existing.id);
    } else {
      const person = {
        id: uid("p"), name: g.name.trim(), role: g.role || "", company: g.company || "",
        email: (g.email || "").trim(), linkedin: (g.linkedin || "").trim(), photoUrl: "",
        note: "", flags: { vip: false, dietary: false, plusOne: false }, star: false,
        practice: { hits: 0, misses: 0, last: null }
      };
      store.people.push(person);
      event.guestIds.push(person.id);
      stats.added++;
    }
  }
  saveStore();
  return stats;
}

/* ---------- avatars ----------
   Photo URL if one was set, otherwise a Gravatar lookup by email
   (SHA-256, supported by Gravatar), otherwise initials. */
function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("");
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
  const monogram = `<span class="avatar ${cls || ""}" data-avatar="${person.id}">${initials(person.name)}</span>`;
  return monogram;
}

/* Upgrade monogram avatars to photos where available (photoUrl, then
   Gravatar by email). Runs after each render; failures keep the monogram. */
async function hydrateAvatars() {
  document.querySelectorAll("[data-avatar]").forEach(async (el) => {
    const person = store.people.find(p => p.id === el.dataset.avatar);
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

/* ---------- practice queue ----------
   Intelligence layer: weight guests by what you get wrong and what
   you have not seen lately, so practice time lands where it helps. */
function practiceQueue(personIds) {
  const people = personIds.map(id => store.people.find(p => p.id === id)).filter(Boolean);
  const score = (p) => {
    const pr = p.practice;
    const daysSince = pr.last ? (Date.now() - pr.last) / 86400000 : 30;
    return pr.misses * 3 - pr.hits + Math.min(daysSince, 30) * 0.2 + (pr.hits + pr.misses === 0 ? 2 : 0);
  };
  return people.slice().sort((a, b) => score(b) - score(a));
}

/* ============================================================
   Rendering helpers
   ============================================================ */
const app = document.getElementById("app");
const esc = (s) => (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDate(d) {
  if (!d) return "Date TBD";
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function setNav(active) {
  document.querySelectorAll("[data-nav]").forEach(a =>
    a.classList.toggle("active", a.dataset.nav === active));
}

function flagChips(person) {
  const defs = [["vip", "VIP"], ["dietary", "Dietary"], ["plusOne", "Plus-one"]];
  return defs.map(([k, label]) =>
    `<button class="flag ${k} ${person.flags[k] ? "on" : ""}" data-flag="${k}" data-person="${person.id}">${label}</button>`
  ).join("");
}

function memoryLine(person, currentEventId) {
  const others = eventsFor(person.id).filter(e => e.id !== currentEventId);
  if (!others.length) return "";
  const names = others.map(e => esc(e.name.replace(/ \(sample\)$/, ""))).join(", ");
  return `<div class="guest-memory">Returning guest - also at: ${names}${person.note ? "" : ""}</div>`;
}

/* ============================================================
   View: Events (home)
   ============================================================ */
function renderEvents() {
  setNav("events");
  const events = store.events.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  app.innerHTML = `
    <section class="hero">
      <div>
        <p class="eyebrow">Names &amp; Faces</p>
        <h1>Walk into the room<br />already knowing <em>everyone.</em></h1>
        <p class="lede">Villagers turns a guest list into a briefing book - who they are,
          why they matter, and what you talked about last time - then helps you practice
          until every name sticks.</p>
      </div>
      <form class="new-event" id="new-event-form">
        <p class="eyebrow">New briefing book</p>
        <h2>Start an event</h2>
        <label for="ev-name">Event name</label>
        <input id="ev-name" required placeholder="Spring Salon Dinner" />
        <label for="ev-date">Date</label>
        <input id="ev-date" type="date" />
        <label for="ev-goal">What would make it a win?</label>
        <input id="ev-goal" placeholder="Every founder leaves with one warm intro." />
        <label for="ev-guests">Guest list</label>
        <textarea id="ev-guests" placeholder="Paste names - one per line - or a CSV export with columns like name, role, company, email, linkedin."></textarea>
        <div class="or-divider">or</div>
        <input class="file-pick" id="ev-file" type="file" accept=".csv,.txt" />
        <p class="field-note">Nothing uploads. The list stays in this browser.</p>
        <button class="button" type="submit">Build the book</button>
        <div class="import-hint">Returning guests are recognized automatically - their
          notes, flags and history carry over from every past event.</div>
      </form>
    </section>
    <section class="section">
      <div class="section-head">
        <h2>Your books</h2>
        ${store.events.some(e => e.sample) ? `<button class="button subtle small" id="clear-samples">Clear sample data</button>` : ""}
      </div>
      <div class="event-list">
        ${events.length ? events.map(e => {
          const returning = e.guestIds.filter(id => eventsFor(id).length > 1).length;
          return `
          <div class="event-tile" data-open-event="${e.id}">
            <span class="tile-date">${fmtDate(e.date)}${e.sample ? ' · <span class="tile-sample">sample</span>' : ""}</span>
            <h3>${esc(e.name)}</h3>
            <span class="tile-meta">${e.guestIds.length} guest${e.guestIds.length === 1 ? "" : "s"}${e.location ? " · " + esc(e.location) : ""}</span>
            ${returning ? `<span class="tile-returning">${returning} returning guest${returning === 1 ? "" : "s"} remembered</span>` : ""}
          </div>`;
        }).join("") : `<p class="empty-state">No books yet. Paste a guest list above and Villagers builds the first one.</p>`}
      </div>
    </section>`;
}

/* ============================================================
   View: Event book
   ============================================================ */
let bookFilter = "all";
let bookSearch = "";

function renderEvent(eventId) {
  const event = store.events.find(e => e.id === eventId);
  if (!event) { location.hash = "#/"; return; }
  setNav("events");

  const guests = event.guestIds.map(id => store.people.find(p => p.id === id)).filter(Boolean);
  const returning = guests.filter(g => eventsFor(g.id).length > 1);
  const vips = guests.filter(g => g.flags.vip);
  const starred = guests.filter(g => g.star);
  const toPractice = guests.filter(g => (g.practice.misses > g.practice.hits) || (g.practice.hits + g.practice.misses) === 0);

  const filters = [["all", `All · ${guests.length}`], ["returning", `Returning · ${returning.length}`],
    ["vip", `VIP · ${vips.length}`], ["starred", `Must meet · ${starred.length}`], ["practice", `To practice · ${toPractice.length}`]];
  if (!filters.some(([k]) => k === bookFilter)) bookFilter = "all";

  let visible = guests;
  if (bookFilter === "returning") visible = returning;
  if (bookFilter === "vip") visible = vips;
  if (bookFilter === "starred") visible = starred;
  if (bookFilter === "practice") visible = toPractice;
  if (bookSearch) {
    const q = bookSearch.toLowerCase();
    visible = visible.filter(g => [g.name, g.role, g.company, g.note].join(" ").toLowerCase().includes(q));
  }
  // Must-meet first, then VIPs, then alphabetical.
  visible = visible.slice().sort((a, b) =>
    (b.star - a.star) || (b.flags.vip - a.flags.vip) || a.name.localeCompare(b.name));

  app.innerHTML = `
    <section class="book-head">
      <p class="crumb"><a href="#/">All books</a> / ${esc(event.name)}</p>
      <div class="book-title-row">
        <div>
          <p class="eyebrow">${fmtDate(event.date)}${event.location ? " · " + esc(event.location) : ""}</p>
          <h1>${esc(event.name)}</h1>
        </div>
        <div class="book-actions">
          <a class="button small" href="#/practice?event=${event.id}">Practice names</a>
          <button class="button ghost small" id="print-book-btn">Print briefing</button>
          <button class="button subtle small" id="export-csv">Export CSV</button>
          <button class="button subtle small" id="delete-event">Delete</button>
        </div>
      </div>
      ${event.goal ? `<p class="book-goal"><strong>The win:</strong> ${esc(event.goal)}</p>` : ""}
      <div class="summary-strip">
        <div class="stat"><b>${guests.length}</b><span>Guests</span></div>
        <div class="stat"><b>${returning.length}</b><span>Returning</span></div>
        <div class="stat"><b>${vips.length}</b><span>VIPs</span></div>
        <div class="stat"><b>${starred.length}</b><span>Must meet</span></div>
        <div class="stat"><b>${toPractice.length}</b><span>To practice</span></div>
      </div>
    </section>
    <div class="book-toolbar">
      ${filters.map(([k, label]) => `<button class="chip ${bookFilter === k ? "active" : ""}" data-filter="${k}">${label}</button>`).join("")}
      <div class="search-box"><input id="book-search" placeholder="Search names, companies, notes" value="${esc(bookSearch)}" /></div>
    </div>
    <div class="guest-grid">
      ${visible.length ? visible.map(g => `
        <article class="guest-card ${eventsFor(g.id).length > 1 ? "returning" : ""}">
          <button class="star ${g.star ? "on" : ""}" data-star="${g.id}" title="Must meet">★</button>
          ${avatarHtml(g)}
          <div>
            <div class="guest-name">${esc(g.name)}</div>
            <div class="guest-role">${esc([g.role, g.company].filter(Boolean).join(" · ")) || "&nbsp;"}</div>
          </div>
          <div></div>
          ${memoryLine(g, event.id)}
          <input class="guest-note-input" data-note="${g.id}" placeholder="Context, talking points, what to remember…" value="${esc(g.note)}" />
          <div class="guest-flags">${flagChips(g)}</div>
          <div class="guest-links">
            ${g.linkedin ? `<a href="${esc(g.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>` : ""}
            ${g.email ? `<a href="mailto:${esc(g.email)}">Email</a>` : ""}
          </div>
        </article>`).join("")
      : `<p class="empty-state">Nobody matches this view yet.</p>`}
    </div>
    <div class="add-guest-panel">
      <p class="eyebrow">Add guests</p>
      <h3>Paste more names</h3>
      <p class="muted" style="font-size:13px;margin:8px 0 0">Late RSVPs, plus-ones, the list you forgot. Returning guests merge automatically.</p>
      <textarea id="add-guests-text" placeholder="Name, Role, Company - one per line"></textarea>
      <button class="button small" id="add-guests-btn" style="margin-top:16px">Add to this event</button>
      <span id="add-guests-status" class="field-note"></span>
    </div>`;

  hydrateAvatars();
}

/* ---------- CSV export ---------- */
function exportEventCsv(event) {
  const rows = [["name", "role", "company", "email", "linkedin", "vip", "dietary", "plus_one", "starred", "note", "also_at"]];
  for (const id of event.guestIds) {
    const g = store.people.find(p => p.id === id);
    if (!g) continue;
    const also = eventsFor(g.id).filter(e => e.id !== event.id).map(e => e.name).join("; ");
    rows.push([g.name, g.role, g.company, g.email, g.linkedin,
      g.flags.vip ? "yes" : "", g.flags.dietary ? "yes" : "", g.flags.plusOne ? "yes" : "",
      g.star ? "yes" : "", g.note, also]);
  }
  const csv = rows.map(r => r.map(c => `"${String(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = event.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-briefing.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- print briefing ---------- */
function printEventBook(event) {
  const guests = event.guestIds.map(id => store.people.find(p => p.id === id)).filter(Boolean)
    .sort((a, b) => (b.star - a.star) || (b.flags.vip - a.flags.vip) || a.name.localeCompare(b.name));
  let el = document.getElementById("print-book");
  if (!el) {
    el = document.createElement("div");
    el.id = "print-book";
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <h1>${esc(event.name)}</h1>
    <div class="print-meta">${fmtDate(event.date)}${event.location ? " · " + esc(event.location) : ""} · ${guests.length} guests · Villagers briefing</div>
    ${event.goal ? `<div class="print-goal">The win: ${esc(event.goal)}</div>` : ""}
    ${guests.map(g => {
      const others = eventsFor(g.id).filter(e => e.id !== event.id).map(e => e.name).join(", ");
      const flags = [g.flags.vip && "VIP", g.flags.dietary && "Dietary", g.flags.plusOne && "Plus-one", g.star && "Must meet"].filter(Boolean).join(" · ");
      return `<div class="print-guest">
        ${avatarHtml(g)}
        <div>
          <div class="p-name">${esc(g.name)}</div>
          <div class="p-line">${esc([g.role, g.company].filter(Boolean).join(" · "))}</div>
          ${flags ? `<div class="p-flags">${flags}</div>` : ""}
          ${others ? `<div class="p-note">Also at: ${esc(others)}</div>` : ""}
          ${g.note ? `<div class="p-note">${esc(g.note)}</div>` : ""}
        </div>
      </div>`;
    }).join("")}`;
  hydrateAvatars();
  setTimeout(() => window.print(), 300);
}

/* ============================================================
   View: Practice
   ============================================================ */
let practiceState = null;

function startPractice(eventId) {
  const event = eventId ? store.events.find(e => e.id === eventId) : null;
  const ids = event ? event.guestIds : store.people.map(p => p.id);
  const queue = practiceQueue(ids);
  practiceState = { event, queue, index: 0, hits: 0, misses: 0, missedNames: [], revealed: false };
  renderPractice();
}

function renderPractice() {
  setNav("practice");
  const st = practiceState;

  if (!st || !st.queue.length) {
    app.innerHTML = `
      <section class="practice-wrap">
        <p class="eyebrow">Practice</p>
        <h2>Nothing to practice yet</h2>
        <p class="muted" style="margin-top:14px;line-height:1.7">Add an event with a guest list first -
          then this mode drills the names you get wrong until they stick.</p>
        <p style="margin-top:26px"><a class="button" href="#/">Build a book</a></p>
      </section>`;
    return;
  }

  if (st.index >= st.queue.length) {
    app.innerHTML = `
      <section class="practice-wrap">
        <p class="eyebrow">Session complete</p>
        <h2>${st.hits} of ${st.queue.length} remembered</h2>
        ${st.missedNames.length ? `
          <p class="muted" style="margin-top:10px">These are the ones to look at once more tonight:</p>
          <ul class="weak-list">${st.missedNames.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : `
          <p class="muted" style="margin-top:10px">Clean sweep. Walk in confident.</p>`}
        <div class="practice-buttons" style="justify-content:center">
          <button class="button" id="practice-again">Run it again</button>
          ${st.event ? `<a class="button ghost" href="#/event/${st.event.id}">Back to the book</a>` : `<a class="button ghost" href="#/">All books</a>`}
        </div>
      </section>`;
    return;
  }

  const person = st.queue[st.index];
  const hint = [person.role, person.company].filter(Boolean).join(" · ");
  const others = eventsFor(person.id).filter(e => !st.event || e.id !== st.event.id);

  app.innerHTML = `
    <section class="practice-wrap">
      <p class="eyebrow">Practice${st.event ? " · " + esc(st.event.name) : ""}</p>
      <p class="practice-progress">Card ${st.index + 1} of ${st.queue.length} · hardest first</p>
      <div class="practice-card">
        ${avatarHtml(person)}
        <p class="practice-hint">${esc(hint) || "No role on file"}${others.length ? `<br><span style="color:var(--violet);font-size:13px">You have met before: ${esc(others.map(e => e.name.replace(/ \(sample\)$/, "")).join(", "))}</span>` : ""}</p>
        ${person.note && st.revealed ? `<p class="practice-hint">${esc(person.note)}</p>` : ""}
        ${st.revealed
          ? `<div class="practice-answer">${esc(person.name)}</div>
             <div class="practice-buttons">
               <button class="button ghost" id="practice-miss">Missed it</button>
               <button class="button" id="practice-hit">Knew it</button>
             </div>`
          : `<div class="practice-answer" style="color:var(--lilac)">Who is this?</div>
             <div class="practice-buttons"><button class="button" id="practice-reveal">Reveal the name</button></div>`}
      </div>
    </section>`;
  hydrateAvatars();
}

/* ============================================================
   View: People (cross-event memory)
   ============================================================ */
function renderPeople() {
  setNav("people");
  const people = store.people.slice().sort((a, b) => a.name.localeCompare(b.name));
  app.innerHTML = `
    <section class="book-head">
      <p class="eyebrow" style="padding-top:48px">Guest memory</p>
      <h1>Everyone, <em>remembered.</em></h1>
      <p class="book-goal">Every person you have ever hosted, with their history across events.
        This is the layer no spreadsheet gives you back.</p>
    </section>
    <table class="people-table">
      <thead><tr><th>Name</th><th>Role</th><th>Note</th><th>Events</th><th>Practice</th></tr></thead>
      <tbody>
        ${people.map(p => {
          const evs = eventsFor(p.id);
          const pr = p.practice;
          const prLabel = pr.hits + pr.misses === 0 ? "not yet" :
            pr.misses > pr.hits ? "shaky" : "solid";
          return `<tr>
            <td class="p-name">${esc(p.name)}${p.flags.vip ? ' <span class="flag vip on" style="cursor:default">VIP</span>' : ""}</td>
            <td class="muted">${esc([p.role, p.company].filter(Boolean).join(" · "))}</td>
            <td class="p-note">${esc(p.note)}</td>
            <td class="p-events">${evs.map(e => esc(e.name.replace(/ \(sample\)$/, ""))).join("<br>")}</td>
            <td class="muted">${prLabel}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

/* ============================================================
   Router
   ============================================================ */
function route() {
  bookSearch = "";
  const hash = location.hash || "#/";
  const [path, query] = hash.slice(2).split("?");
  const params = new URLSearchParams(query || "");

  if (path === "" ) renderEvents();
  else if (path.startsWith("event/")) renderEvent(path.slice(6));
  else if (path === "people") renderPeople();
  else if (path === "practice") {
    if (!practiceState || params.get("event")) startPractice(params.get("event"));
    else renderPractice();
  }
  else renderEvents();
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);

/* ============================================================
   Events (delegated)
   ============================================================ */
document.addEventListener("submit", (ev) => {
  if (ev.target.id !== "new-event-form") return;
  ev.preventDefault();
  const name = document.getElementById("ev-name").value.trim();
  if (!name) return;
  const event = {
    id: uid("e"),
    name,
    date: document.getElementById("ev-date").value || "",
    location: "",
    goal: document.getElementById("ev-goal").value.trim(),
    guestIds: [], sample: false
  };
  store.events.push(event);
  const finish = () => {
    const stats = addGuestsToEvent(event, parseGuestText(document.getElementById("ev-guests").value));
    saveStore();
    location.hash = "#/event/" + event.id;
    if (stats.returning) setTimeout(() =>
      alert(`${stats.returning} returning guest${stats.returning === 1 ? "" : "s"} recognized - their history carried over.`), 250);
  };
  const file = document.getElementById("ev-file").files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => { document.getElementById("ev-guests").value = reader.result; finish(); };
    reader.readAsText(file);
  } else finish();
});

document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-open-event],[data-filter],[data-star],[data-flag],#add-guests-btn,#export-csv,#print-book-btn,#delete-event,#practice-reveal,#practice-hit,#practice-miss,#practice-again,#clear-samples");
  if (!t) return;

  if (t.dataset.openEvent) { location.hash = "#/event/" + t.dataset.openEvent; return; }
  if (t.dataset.filter) { bookFilter = t.dataset.filter; renderEvent(location.hash.split("/").pop().split("?")[0]); return; }
  if (t.dataset.star) {
    const p = store.people.find(x => x.id === t.dataset.star);
    p.star = !p.star; saveStore(); renderEvent(currentEventId()); return;
  }
  if (t.dataset.flag) {
    const p = store.people.find(x => x.id === t.dataset.person);
    p.flags[t.dataset.flag] = !p.flags[t.dataset.flag]; saveStore();
    t.classList.toggle("on", p.flags[t.dataset.flag]); return;
  }
  if (t.id === "add-guests-btn") {
    const event = store.events.find(e => e.id === currentEventId());
    const stats = addGuestsToEvent(event, parseGuestText(document.getElementById("add-guests-text").value));
    document.getElementById("add-guests-status").textContent =
      ` ${stats.added} new, ${stats.returning} returning${stats.duplicates ? ", " + stats.duplicates + " already on the list" : ""}.`;
    renderEvent(event.id); return;
  }
  if (t.id === "export-csv") { exportEventCsv(store.events.find(e => e.id === currentEventId())); return; }
  if (t.id === "print-book-btn") { printEventBook(store.events.find(e => e.id === currentEventId())); return; }
  if (t.id === "delete-event") {
    const event = store.events.find(e => e.id === currentEventId());
    if (confirm(`Delete "${event.name}"? Guest memory for other events is kept.`)) {
      store.events = store.events.filter(e => e.id !== event.id);
      saveStore(); location.hash = "#/";
    }
    return;
  }
  if (t.id === "clear-samples") {
    const sampleIds = new Set(store.events.filter(e => e.sample).map(e => e.id));
    store.events = store.events.filter(e => !e.sample);
    store.people = store.people.filter(p => eventsFor(p.id).length > 0);
    saveStore(); renderEvents(); return;
  }
  if (t.id === "practice-reveal") { practiceState.revealed = true; renderPractice(); return; }
  if (t.id === "practice-hit" || t.id === "practice-miss") {
    const person = practiceState.queue[practiceState.index];
    const hit = t.id === "practice-hit";
    person.practice[hit ? "hits" : "misses"]++;
    person.practice.last = Date.now();
    if (hit) practiceState.hits++; else { practiceState.misses++; practiceState.missedNames.push(person.name); }
    practiceState.index++;
    practiceState.revealed = false;
    saveStore(); renderPractice(); return;
  }
  if (t.id === "practice-again") { startPractice(practiceState.event ? practiceState.event.id : null); return; }
});

/* Notes save on blur/enter, not every keystroke. */
document.addEventListener("change", (ev) => {
  if (ev.target.matches("[data-note]")) {
    const p = store.people.find(x => x.id === ev.target.dataset.note);
    p.note = ev.target.value.trim(); saveStore();
  }
  if (ev.target.id === "book-search") return;
});

document.addEventListener("input", (ev) => {
  if (ev.target.id === "book-search") {
    bookSearch = ev.target.value;
    const id = currentEventId();
    if (id) renderEvent(id);
    const box = document.getElementById("book-search");
    box.focus(); box.setSelectionRange(box.value.length, box.value.length);
  }
});

function currentEventId() {
  const m = (location.hash || "").match(/#\/event\/([^?]+)/);
  return m ? m[1] : null;
}

/* ============================================================
   Gate
   ============================================================ */
(function initGate() {
  const gate = document.getElementById("gate");
  if (sessionStorage.getItem("villagers.gate") === "ok") return;
  gate.hidden = false;
  const attempt = () => {
    const ok = document.getElementById("gate-input").value.trim().toLowerCase() === GATE_CODE;
    if (ok) { sessionStorage.setItem("villagers.gate", "ok"); gate.hidden = true; }
    else document.getElementById("gate-error").hidden = false;
  };
  document.getElementById("gate-button").addEventListener("click", attempt);
  document.getElementById("gate-input").addEventListener("keydown", (e) => { if (e.key === "Enter") attempt(); });
})();

route();
