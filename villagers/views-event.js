/* ============================================================
   Villagers - Event dashboard
   Tabs: Guests (per-guest intelligence) Â· Connectors Â· Digest Â·
   RSVP Â· Settings. Depends on app.js (store, db helpers, esc).
   ============================================================ */

"use strict";

/* ---------- digest line builder ----------
   One textable line per guest, in the spec's format:
   "Elena Rossi arriving 6:15 - vegetarian, ask about her Peru
   trip, avoid: her fund just passed on a deal you're close to.
   Good intro: pair her with Maya, they overlap on Northline."
   NOTE: the day-of email digest is generated in the database by
   public.build_digest_text - keep this format and that one in sync. */
function digestLine(event, person, forHtml) {
  const E = forHtml ? esc : (s) => s;
  const intel = intelFor(event, person.id);
  const bits = [];
  let head = E(person.name);
  if (intel.arriving) head += ` arriving ${fmtTimeShort(intel.arriving)}`;
  if (person.dietary) bits.push(E(person.dietary.toLowerCase()));
  if (intel.ask) bits.push(E(intel.ask));
  let line = head + (bits.length ? " - " + bits.join(", ") : "");
  if (intel.avoid) line += `, avoid: ${E(intel.avoid)}`;
  line += ".";
  if (intel.openLoop) line += ` Last time: ${E(intel.openLoop)}.`;
  const edge = edgesFor(event, person.id).find(ed => {
    const otherId = ed.aId === person.id ? ed.bId : ed.aId;
    const other = personById(otherId);
    return other && (event.rsvp[otherId] || {}).status === "yes";
  });
  if (edge) {
    const otherId = edge.aId === person.id ? edge.bId : edge.aId;
    const other = personById(otherId);
    line += ` Good intro: pair ${E(firstName(person.name))} with ${E(firstName(other.name))}, ${E(edge.basis)}.`;
  }
  return line;
}

/* ============================================================
   View: Event dashboard (tabbed)
   ============================================================ */
function renderEvent(eventId, tab) {
  const event = eventById(eventId);
  if (!event) { location.hash = "#/"; return; }
  setNav("events");
  const guests = event.guestIds.map(personById).filter(Boolean);
  const yesGuests = guests.filter(g => (event.rsvp[g.id] || {}).status === "yes");
  const tabs = [["guests", "Guests"], ["connectors", "Connectors"], ["digest", "Digest"], ["notes", "Notes"], ["rsvp", "RSVP"], ["after", "After"], ["settings", "Settings"]];

  app.innerHTML = `
    <section class="book-head">
      <div class="crumb"><a href="#/">Events</a> / ${esc(event.name.replace(/ \(sample\)$/, ""))}</div>
      <div class="book-title-row">
        <h1>${esc(event.name.replace(/ \(sample\)$/, ""))}</h1>
      </div>
      <p class="book-goal">${fmtDate(event.date)}${event.doorsTime ? " Â· doors " + fmtTime(event.doorsTime) : ""}${event.location ? " Â· " + esc(event.location) : ""}
        ${event.win ? `<br /><strong>The win:</strong> ${esc(event.win)}` : ""}</p>
      <div class="summary-strip">
        <div class="stat"><b>${guests.length}</b><span>On the list</span></div>
        <div class="stat"><b>${yesGuests.length}</b><span>Confirmed</span></div>
        <div class="stat"><b>${guests.filter(g => eventsFor(g.id).length > 1).length}</b><span>Returning</span></div>
        <div class="stat"><b>${(event.edges || []).length}</b><span>Connector tags</span></div>
      </div>
      <div class="tab-row">
        ${tabs.map(([id, label]) => `<a class="chip ${tab === id ? "active" : ""}" href="#/event/${event.id}/${id}">${label}</a>`).join("")}
      </div>
    </section>
    <section id="tab-body"></section>`;

  const body = document.getElementById("tab-body");
  if (tab === "after") renderAfterEventTab(body, event, guests);
  else if (tab === "connectors") renderConnectorsTab(body, event, guests);
  else if (tab === "digest") renderDigestTab(body, event, guests);
  else if (tab === "notes") renderNotesTab(body, event, guests);
  else if (tab === "rsvp") renderRsvpTab(body, event, guests);
  else if (tab === "settings") renderSettingsTab(body, event);
  else renderGuestsTab(body, event, guests);
  hydrateAvatars();
}

/* ---------- Guests tab: per-guest intelligence ---------- */
function renderGuestsTab(body, event, guests) {
  body.innerHTML = `
    <div class="tab-intro">
      <p class="muted">The ask, the avoid list and the open loop for each guest. These feed the
        day-of digest. Role, company and context live on the standing People record - edit once,
        remembered at every future event.</p>
    </div>
    <div class="guest-grid">
      ${guests.map(g => {
        const intel = intelFor(event, g.id);
        const rsvp = rsvpFor(event, g.id);
        return `
        <div class="guest-card ${eventsFor(g.id).length > 1 ? "returning" : ""}">
          ${avatarHtml(g)}
          <div class="guest-name">${esc(g.name)}</div>
          <div class="guest-role">${esc([g.role, g.company].filter(Boolean).join(" Â· ")) || "Role TBD"}</div>
          ${rsvp ? `<div class="guest-flags"><span class="flag ${rsvp.status === "yes" ? "on" : ""}">${rsvp.status === "yes" ? "Confirmed" : esc(rsvp.status)}</span>${g.flags.vip ? '<span class="flag vip on">VIP</span>' : ""}</div>` : (g.flags.vip ? '<div class="guest-flags"><span class="flag vip on">VIP</span></div>' : "")}
          ${g.context ? `<div class="guest-context">${esc(g.context)}${g.contextSuggested ? ' <span class="suggest-chip">suggested Â· editable</span>' : ""}</div>` : ""}
          ${returningBadge(g, event.id)}
          <div class="intel-form" data-intel="${g.id}">
            <label>Arriving</label>
            <input type="time" data-f="arriving" value="${esc(intel.arriving)}" />
            <label>The ask - what does success with ${esc(firstName(g.name))} look like?</label>
            <input data-f="ask" value="${esc(intel.ask)}" placeholder="get them talking to X Â· say thank you Â· maintenance" />
            <label>Avoid - anything off-limits</label>
            <input data-f="avoid" value="${esc(intel.avoid)}" placeholder="recent layoff, a competitor in the room, a soured deal" />
            <label>Open loop from last time</label>
            <input data-f="openLoop" value="${esc(intel.openLoop)}" placeholder="said they'd send the deck Â· asked about your timeline" />
            <label>Dietary / logistics</label>
            <input data-f="dietary" value="${esc(g.dietary)}" placeholder="vegetarian, wheelchair access, plus-one" />
            <label>Host notes</label>
            <textarea data-f="note" placeholder="Anything else to remember.">${esc(g.note)}</textarea>
            <div class="intel-actions">
              <button class="button small ghost" data-remove-guest="${g.id}" type="button">Remove from event</button>
            </div>
          </div>
        </div>`;
      }).join("") || `<p class="empty-state">No guests yet. Add them below, or share the RSVP link from the RSVP tab and let guests add themselves.</p>`}
    </div>

    <div class="add-guest-panel">
      <h3>Add guests</h3>
      <div class="add-guest-grid">
        <div>
          <label for="ag-name">Name</label>
          <input id="ag-name" placeholder="Jordan Lee" />
          <label for="ag-role">Role</label>
          <input id="ag-role" placeholder="Partner" />
        </div>
        <div>
          <label for="ag-company">Company</label>
          <input id="ag-company" placeholder="Northline Ventures" />
          <label for="ag-linkedin">LinkedIn URL</label>
          <input id="ag-linkedin" placeholder="linkedin.com/in/..." />
        </div>
        <div>
          <label for="ag-email">Email</label>
          <input id="ag-email" placeholder="jordan@fund.com" />
          <label>&nbsp;</label>
          <button class="button small" id="ag-add" type="button">Add to the list</button>
        </div>
      </div>
      <div class="or-divider">or paste a list</div>
      <textarea id="ag-paste" placeholder="Names, one per line - or a CSV export with name, role, company, email, linkedin columns."></textarea>
      <button class="button ghost small" id="ag-import" type="button">Import list</button>
      <span class="muted" id="ag-result"></span>
    </div>`;

  /* autosave intel fields on change */
  body.querySelectorAll("[data-intel]").forEach(form => {
    const pid = form.dataset.intel;
    form.querySelectorAll("input[data-f], textarea[data-f]").forEach(input => {
      input.addEventListener("change", () => {
        const person = personById(pid);
        if (!person) return;
        const f = input.dataset.f;
        const value = input.value.trim();
        if (f === "dietary") { person.dietary = value; dbUpdatePersonGlobal(pid, "dietary", value); }
        else if (f === "note") { person.note = value; dbUpdatePersonGlobal(pid, "note", value); }
        else { intelFor(event, pid)[f] = value; dbUpdateIntel(event.id, pid, f, value); }
      });
    });
  });

  body.querySelectorAll("[data-remove-guest]").forEach(btn => btn.addEventListener("click", async () => {
    btn.disabled = true;
    await dbRemoveGuest(event.id, btn.dataset.removeGuest);
    await loadStoreFromDb();
    renderEvent(event.id, "guests");
  }));

  document.getElementById("ag-add").addEventListener("click", async () => {
    const g = {
      name: document.getElementById("ag-name").value.trim(),
      role: document.getElementById("ag-role").value.trim(),
      company: document.getElementById("ag-company").value.trim(),
      email: document.getElementById("ag-email").value.trim(),
      linkedin: document.getElementById("ag-linkedin").value.trim()
    };
    if (!g.name) return;
    const btn = document.getElementById("ag-add");
    btn.disabled = true; btn.textContent = "Adding...";
    await dbAddGuests(event, [g]);
    await loadStoreFromDb();
    renderEvent(event.id, "guests");
  });

  document.getElementById("ag-import").addEventListener("click", async () => {
    const guests = parseGuestText(document.getElementById("ag-paste").value);
    if (!guests.length) return;
    const btn = document.getElementById("ag-import");
    btn.disabled = true; btn.textContent = "Importing...";
    const stats = await dbAddGuests(event, guests);
    await loadStoreFromDb();
    renderEvent(event.id, "guests");
    const el = document.getElementById("ag-result");
    if (el) el.textContent = `${stats.added} new Â· ${stats.returning} returning Â· ${stats.duplicates} already on the list`;
  });
}

/* ---------- Connectors tab: who should meet whom ---------- */
function renderConnectorsTab(body, event, guests) {
  const edges = event.edges || [];
  body.innerHTML = `
    <div class="tab-intro">
      <p class="muted">A warm intro from a mutual beats a cold intro from the host. Tag who should
        meet whom, and why the connection is credible - each tag is an <em>edge between two
        guests</em>, not a fact about one person. The digest surfaces these as pairings.</p>
    </div>
    <div class="edge-list">
      ${edges.map(ed => {
        const a = personById(ed.aId), b = personById(ed.bId);
        if (!a || !b) return "";
        return `
        <div class="edge-card">
          <div class="edge-pair">${avatarHtml(a, "small")}<span class="edge-name">${esc(a.name)}</span>
            <span class="edge-link">â</span>
            ${avatarHtml(b, "small")}<span class="edge-name">${esc(b.name)}</span></div>
          <div class="edge-basis">${esc(ed.basis)}</div>
          <button class="button subtle small" data-del-edge="${ed.id}" type="button">Remove</button>
        </div>`;
      }).join("") || `<p class="empty-state">No connector tags yet. Who in this room should meet who?</p>`}
    </div>
    ${guests.length >= 2 ? `
    <div class="add-guest-panel">
      <h3>Tag a pairing</h3>
      <div class="add-guest-grid">
        <div>
          <label for="edge-a">Guest</label>
          <select id="edge-a">${guests.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}</select>
        </div>
        <div>
          <label for="edge-b">Should meet</label>
          <select id="edge-b">${guests.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}</select>
        </div>
        <div>
          <label for="edge-basis">Why it's credible</label>
          <input id="edge-basis" placeholder="they overlap on Northline's last raise" />
          <label>&nbsp;</label>
          <button class="button small" id="edge-add" type="button">Add the tag</button>
        </div>
      </div>
    </div>` : `<p class="muted" style="margin-top:18px">Add at least two guests to tag pairings.</p>`}`;

  body.querySelectorAll("[data-del-edge]").forEach(btn => btn.addEventListener("click", async () => {
    btn.disabled = true;
    await dbDelEdge(btn.dataset.delEdge);
    await loadStoreFromDb();
    renderEvent(event.id, "connectors");
  }));

  const addBtn = document.getElementById("edge-add");
  if (addBtn) addBtn.addEventListener("click", async () => {
    const aId = document.getElementById("edge-a").value;
    const bId = document.getElementById("edge-b").value;
    const basis = document.getElementById("edge-basis").value.trim();
    if (!aId || !bId || aId === bId || !basis) return;
    addBtn.disabled = true;
    await dbAddEdge(event.id, aId, bId, basis);
    await loadStoreFromDb();
    renderEvent(event.id, "connectors");
  });
}

/* ---------- Digest tab: the day-of text ---------- */
function renderDigestTab(body, event, guests) {
  const attending = guests.filter(g => (event.rsvp[g.id] || {}).status === "yes");
  const pool = attending.length ? attending : guests;
  const sendAt = digestTime(event);
  const lines = pool.map(g => digestLine(event, g, true));
  const plainLines = pool.map(g => digestLine(event, g, false));
  const digestTo = (currentHost && currentHost.digest_email) || "the host's email";
  body.innerHTML = `
    <div class="tab-intro">
      <p class="muted">An hour before doors, the host gets this as an email - a few lines per guest,
        no dashboard to remember to open. Timing is configurable per event in Settings
        (currently ${event.digestMinutes || 60} minutes before doors${sendAt ? ", lands around " + fmtTime(sendAt) : ""}).</p>
      <p class="muted">The digest generates and emails itself to
        <strong>${esc(digestTo)}</strong> at the configured time.</p>
    </div>
    <div class="digest-preview">
      <div class="digest-meta">Villagers Â· day-of digest${event.date ? " Â· " + fmtDate(event.date) : ""}${sendAt ? " Â· sends ~" + fmtTime(sendAt) : ""}</div>
      <div class="digest-bubble">${lines.length ? lines.map(l => `<p>${l}</p>`).join("") : "<p>No guests yet.</p>"}</div>
      <div class="digest-actions">
        <button class="button small" id="digest-copy" type="button">Copy as text</button>
        ${!attending.length && guests.length ? `<span class="muted">No confirmed RSVPs yet - showing the full list.</span>` : ""}
      </div>
    </div>`;

  document.getElementById("digest-copy").addEventListener("click", async () => {
    const header = `Villagers digest - ${event.name}${event.date ? " - " + fmtDate(event.date) : ""}\nDoors ${fmtTime(event.doorsTime)}${event.location ? " at " + event.location : ""}\n\n`;
    const text = header + plainLines.join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      document.getElementById("digest-copy").textContent = "Copied";
    } catch (e) {
      document.getElementById("digest-copy").textContent = "Copy failed - select the text";
    }
  });
}

/* ---------- RSVP tab: the link and the responses ---------- */
function renderRsvpTab(body, event, guests) {
  const link = location.origin + location.pathname + "#/rsvp/" + event.rsvpToken;
  const lumaBlock = event.sample ? "" : `
    <div class="rsvp-share luma-share">
      <label>Luma event page</label>
      ${event.lumaUrl ? `
      <div class="rsvp-link-row">
        <input id="luma-link" readonly value="${esc(event.lumaUrl)}" />
        <button class="button small" id="luma-copy" type="button">Copy</button>
        <a class="button small ghost" href="${esc(event.lumaUrl)}" target="_blank" rel="noopener">Open in Luma</a>
      </div>
      <p class="muted">The public page Luma hosts for this event - share that link with guests. Villagers keeps the intelligence and the digest on top.</p>`
      : event.lumaStatus === "pending" ? `
      <p class="muted">Creating the Luma page - it lands here in a few seconds. Reload the tab to check.</p>`
      : `
      ${event.lumaStatus === "failed" ? `<p class="muted">The Luma page didn't get created${event.lumaError ? " - " + esc(event.lumaError) : ""}.</p>` : `<p class="muted">No Luma page for this event yet.</p>`}
      <button class="button small" id="luma-create" type="button">${event.lumaStatus === "failed" ? "Try again" : "Create the Luma page"}</button>`}
    </div>`;
  const entries = Object.entries(event.rsvp || {}).map(([pid, r]) => ({ person: personById(pid), r })).filter(x => x.person);
  const hostLine = event.hostName ? `from ${event.hostName}` : "from the host";
  body.innerHTML = `
    <div class="tab-intro">
      <p class="muted">Send the RSVP link by text or email <strong>${hostLine}</strong> - guests
        experience it as coming directly from you, not from Villagers. Their responses save
        straight to your guest list and land here live, on any device.</p>
      <p class="muted">Copy the link or the message below and send it from your own number or email.</p>
    </div>
    ${lumaBlock}
    <div class="rsvp-share">
      <label>Villagers RSVP link</label>
      <div class="rsvp-link-row">
        <input id="rsvp-link" readonly value="${esc(link)}" />
        <button class="button small" id="rsvp-copy" type="button">Copy</button>
        <a class="button small ghost" href="#/rsvp/${event.rsvpToken}">Preview the guest page</a>
      </div>
      <label>Message the host sends</label>
      <div class="invite-preview" id="invite-preview">${esc(`You're invited - ${event.name.replace(/ \(sample\)$/, "")}, ${fmtDate(event.date)}${event.location ? " at " + event.location : ""}. Doors ${fmtTime(event.doorsTime)}. Can you make it? RSVP here: `)}<span class="muted">[link]</span></div>
      <button class="button small ghost" id="invite-copy" type="button">Copy message + link</button>
    </div>
    <div class="section-head" style="margin-top:44px"><h2>Responses</h2></div>
    ${entries.length ? `
    <table class="people-table">
      <thead><tr><th>Guest</th><th>Status</th><th>Dietary / plus-one</th><th>Note</th></tr></thead>
      <tbody>
        ${entries.map(({ person, r }) => `
        <tr>
          <td class="p-name">${esc(person.name)}</td>
          <td>${r.status === "yes" ? "Coming" : r.status === "no" ? "Regrets" : "Maybe"}</td>
          <td>${esc([r.dietary, r.plusOne ? "plus-one" : ""].filter(Boolean).join(" Â· "))}</td>
          <td class="p-note">${esc(r.note || "")}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<p class="empty-state">No responses yet. Share the link and they'll land here.</p>`}`;

  document.getElementById("rsvp-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); document.getElementById("rsvp-copy").textContent = "Copied"; } catch (e) {}
  });
  document.getElementById("invite-copy").addEventListener("click", async () => {
    const msg = `You're invited - ${event.name.replace(/ \(sample\)$/, "")}, ${fmtDate(event.date)}${event.location ? " at " + event.location : ""}. Doors ${fmtTime(event.doorsTime)}. Can you make it? RSVP here: ${link}`;
    try { await navigator.clipboard.writeText(msg); document.getElementById("invite-copy").textContent = "Copied"; } catch (e) {}
  });
  const lumaCopy = document.getElementById("luma-copy");
  if (lumaCopy) lumaCopy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(event.lumaUrl); lumaCopy.textContent = "Copied"; } catch (e) {}
  });
  const lumaCreate = document.getElementById("luma-create");
  if (lumaCreate) lumaCreate.addEventListener("click", async () => {
    lumaCreate.disabled = true; lumaCreate.textContent = "Creating...";
    await dbCreateLumaEvent(event.id);
    await loadStoreFromDb();
    renderEvent(event.id, "rsvp");
  });
}

/* ---------- Settings tab ---------- */
function renderSettingsTab(body, event) {
  body.innerHTML = `
    <form class="settings-form" id="settings-form">
      <div class="new-event-grid">
        <div>
          <label for="s-name">Event name</label>
          <input id="s-name" value="${esc(event.name)}" />
          <label for="s-date">Date</label>
          <input id="s-date" type="date" value="${esc(event.date)}" />
          <label for="s-doors">Doors at</label>
          <input id="s-doors" type="time" value="${esc(event.doorsTime)}" />
        </div>
        <div>
          <label for="s-location">Location</label>
          <input id="s-location" value="${esc(event.location)}" />
          <label for="s-host">Host name (guests see this)</label>
          <input id="s-host" value="${esc(event.hostName)}" placeholder="Arielle" />
          <label for="s-digest">Digest lead time (minutes before doors)</label>
          <input id="s-digest" type="number" min="0" max="720" step="5" value="${event.digestMinutes || 60}" />
        </div>
      </div>
      <label for="s-win">The win</label>
      <input id="s-win" value="${esc(event.win)}" />
      <button class="button" type="submit">Save settings</button>
      <button class="button subtle" id="delete-event" type="button">Delete this event</button>
    </form>`;

  document.getElementById("settings-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = {
      name: document.getElementById("s-name").value.trim() || event.name,
      date: document.getElementById("s-date").value,
      doorsTime: document.getElementById("s-doors").value,
      location: document.getElementById("s-location").value.trim(),
      hostName: document.getElementById("s-host").value.trim(),
      win: document.getElementById("s-win").value.trim(),
      digestMinutes: Math.max(0, parseInt(document.getElementById("s-digest").value, 10) || 60)
    };
    const btn = ev.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Saving...";
    await dbSaveEventSettings(event, f);
    await loadStoreFromDb();
    renderEvent(event.id, "settings");
  });

  document.getElementById("delete-event").addEventListener("click", async () => {
    if (!confirm("Delete this event? People records stay in your directory.")) return;
    await dbDeleteEvent(event.id);
    await loadStoreFromDb();
    location.hash = "#/";
  });
}




/* ---------- Notes tab: take notes by text ----------
   Hosts and their reps text notes to the dedicated number during the
   event; the database matches each note to the guest it names and opens
   a follow-up (see supabase/20260926_text_in_notes.sql). */
let notesNumberCache = null;
async function loadNotesNumber() {
  if (notesNumberCache !== null) return notesNumberCache;
  const { data, error } = await sb.rpc("get_notes_number");
  notesNumberCache = error ? "" : (data || "");
  return notesNumberCache;
}

function noteCardHtml(n, guests) {
  const person = n.person_id ? personById(n.person_id) : null;
  const when = fmtTsTime(n.received_at);
  const chip = n.match_state === "matched"
    ? `<span class="flag on">Filed to ${esc(person ? person.name : "")}</span>`
    : n.match_state === "ambiguous"
      ? `<span class="flag">Which guest?</span>`
      : `<span class="flag">Not filed yet</span>`;
  return `
    <div class="guest-card note-card">
      <div class="note-meta"><span>${esc(texterLabel(n))} Â· ${esc(when)}</span>${chip}</div>
      <div class="note-body">${esc(n.body)}</div>
      ${n.match_state !== "matched" ? `
        <div class="note-assign">
          <select data-assign-for="${n.id}">
            <option value="">File to a guest...</option>
            ${guests.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}
          </select>
        </div>` : ""}
    </div>`;
}

function followUpRowHtml(f) {
  const person = f.person_id ? personById(f.person_id) : null;
  return `<div class="texter-row"><span><strong>${esc(person ? person.name : "Guest")}</strong> - ${esc(f.summary)}</span><button class="button small" data-fup-done="${f.id}" type="button">Mark done</button></div>`;
}

function renderNotesTab(body, event, guests) {
  const notes = notesFor(event.id);
  const fups = followUpsFor(event.id);
  const open = fups.filter(f => f.status !== "done");
  const doneCount = fups.length - open.length;
  const texters = store.texters || [];
  body.innerHTML = `
    <div class="tab-intro">
      <p class="muted">Take notes by text. During the event, text anything to your Villagers number -
        it lands here, matched to the right guest, with a follow-up opened. No app to open, no form to fill.</p>
      <p class="notes-number-line">Your notes number: <strong id="notes-number">loading...</strong></p>
    </div>
    <section class="after-section">
      <div class="section-head"><div><h2>Notes from the room</h2><p class="muted">Newest first. Anything that did not name a guest waits for you to file it.</p></div></div>
      <div class="notes-feed">
        ${notes.map(n => noteCardHtml(n, guests)).join("") || '<p class="empty-state">Nothing texted in yet for this event. Text the number above once the room opens.</p>'}
      </div>
    </section>
    <section class="after-section">
      <div class="section-head"><div><h2>Follow-ups from texts</h2><p class="muted">Opened automatically when a note names a guest.</p></div></div>
      ${open.map(followUpRowHtml).join("") || '<p class="empty-state">Matched notes open follow-ups here.</p>'}
      ${doneCount ? `<p class="muted">${doneCount} done</p>` : ""}
    </section>
    <section class="after-section">
      <div class="section-head"><div><h2>Who can text in</h2><p class="muted">Notes are accepted from these numbers only.</p></div></div>
      <div class="texter-list">
        ${texters.map(t => `<div class="texter-row"><span>${esc(t.label || "")}${t.label ? " Â· " : ""}${esc(t.phone)}</span><button class="button small ghost" data-rm-texter="${t.id}" type="button">Remove</button></div>`).join("") || '<p class="empty-state">No numbers yet.</p>'}
      </div>
      <form id="add-texter" class="texter-add">
        <input id="texter-label" placeholder="Name (e.g. Lauren)" />
        <input id="texter-phone" placeholder="+1 phone number" />
        <button class="button small" type="submit">Add texter</button>
      </form>
    </section>`;

  body.querySelectorAll("[data-rm-texter]").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Stop accepting notes from this number?")) return;
    btn.disabled = true;
    await dbRemoveTexter(btn.dataset.rmTexter);
    await loadStoreFromDb(); renderEvent(event.id, "notes");
  }));
  const tf = document.getElementById("add-texter");
  if (tf) tf.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const phone = document.getElementById("texter-phone").value.trim();
    if (!phone) return;
    const btn = tf.querySelector("button[type=submit]");
    btn.disabled = true;
    const res = await dbAddTexter(phone, document.getElementById("texter-label").value);
    if (!res.ok) { btn.disabled = false; btn.textContent = res.error || "Try again"; return; }
    await loadStoreFromDb(); renderEvent(event.id, "notes");
  });
  body.querySelectorAll("[data-assign-for]").forEach(sel => sel.addEventListener("change", async () => {
    if (!sel.value) return;
    sel.disabled = true;
    await dbResolveNote(sel.dataset.assignFor, sel.value);
    await loadStoreFromDb(); renderEvent(event.id, "notes");
  }));
  body.querySelectorAll("[data-fup-done]").forEach(btn => btn.addEventListener("click", async () => {
    btn.disabled = true;
    await dbSetFollowUpDone(btn.dataset.fupDone, true);
    await loadStoreFromDb(); renderEvent(event.id, "notes");
  }));
  loadNotesNumber().then(num => {
    const el = document.getElementById("notes-number");
    if (el) el.textContent = num || "not live yet - coming with the carrier registration";
  });
}

/* ---------- After tab: debrief, intro follow-through, proof ---------- */
function introDraft(event, edge) {
  const a = personById(edge.aId), b = personById(edge.bId);
  if (!a || !b) return "";
  const host = event.hostName || (currentHost && currentHost.name) || "";
  const basis = edge.basis.replace(/[.]+$/, "");
  const reason = basis ? basis.charAt(0).toUpperCase() + basis.slice(1) : "I think you two should know each other";
  return `Hi ${firstName(a.name)} and ${firstName(b.name)} - I wanted to connect you after ${event.name}. ${reason}. I think you two should know each other, so I'll leave it with you from here.${host ? `\n\n${host}` : ""}`;
}

function renderAfterEventTab(body, event, guests) {
  const done = !!event.debriefedAt;
  const edges = event.edges || [];
  const sent = edges.filter(e => e.introSentAt).length;
  const followUps = edges.reduce((n, e) => n + (e.followUpCount || 0), 0);
  body.innerHTML = `
    <div class="after-hero">
      <div><p class="eyebrow">After the room</p><h2>Turn a good night into what happens next.</h2>
      <p class="muted">Close the loop while the details are fresh. Villagers carries each open thread into the next guest brief and keeps the introductions moving.</p></div>
      <div class="impact-mini"><strong>${sent}</strong><span>intros made</span><strong>${followUps}</strong><span>follow-ups logged</span></div>
    </div>
    <section class="after-section ${done ? "is-complete" : ""}">
      <div class="section-kicker">01 Â· Debrief</div>
      <div class="section-head"><div><h2>${done ? "Debrief closed" : "Did the win happen?"}</h2><p class="muted">Two minutes now makes the next event smarter.</p></div>${done ? '<span class="status-pill done">Closed</span>' : '<span class="status-pill">Open</span>'}</div>
      <div class="debrief-grid">
        <div class="debrief-card">
          <label>Did the event deliver the win?</label>
          <div class="win-choice">
            <label><input type="radio" name="did-win" value="true" ${event.debriefWin === true ? "checked" : ""} ${done ? "disabled" : ""}/> Yes</label>
            <label><input type="radio" name="did-win" value="false" ${event.debriefWin === false ? "checked" : ""} ${done ? "disabled" : ""}/> Not yet</label>
          </div>
          <label>What changed in the room?</label>
          <textarea id="debrief-notes" rows="4" ${done ? "disabled" : ""} placeholder="The signal, surprise or next move worth remembering">${esc(event.debriefNotes || "")}</textarea>
        </div>
        <div class="debrief-card guest-loops">
          <label>What got left open?</label>
          <p class="field-help">Anything you enter becomes this person's live open loop and appears the next time they're on a guest list.</p>
          ${guests.map(g => `<div class="loop-input"><span>${esc(g.name)}</span><input data-loop-person="${g.id}" value="${esc((intelFor(event,g.id).debriefOpenLoop || g.currentOpenLoop || ""))}" ${done ? "disabled" : ""} placeholder="Owed an intro, deck, answer or follow-up" /></div>`).join("") || '<p class="empty-state">Add guests before closing the debrief.</p>'}
        </div>
      </div>
      ${!done ? '<button class="button" id="close-debrief" type="button">Close the debrief</button>' : `<p class="closed-note">Closed ${fmtTsDate(event.debriefedAt)}. These open loops now travel with each person.</p>`}
    </section>
    <section class="after-section">
      <div class="section-kicker">02 Â· Intro follow-through</div>
      <div class="section-head"><div><h2>Make the room keep working.</h2><p class="muted">Each connector tag becomes a ready-to-send introduction with the credible reason already named.</p></div></div>
      <div class="intro-stack">
        ${edges.map(edge => {
          const a=personById(edge.aId), b=personById(edge.bId), draft=edge.introMessage || introDraft(event,edge);
          if(!a || !b) return "";
          return `<article class="intro-card ${edge.introSentAt ? "sent" : ""}" data-edge="${edge.id}">
            <div class="intro-top"><div><div class="intro-pair">${esc(a.name)} <span>â</span> ${esc(b.name)}</div><p>${esc(edge.basis)}</p></div>${edge.introSentAt ? '<span class="status-pill done">Sent</span>' : '<span class="status-pill">Ready</span>'}</div>
            <textarea class="intro-draft" rows="5" ${edge.introSentAt ? "disabled" : ""}>${esc(draft)}</textarea>
            <div class="intro-actions">
              <button class="button small ghost" data-copy-intro="${edge.id}" type="button">Copy as text</button>
              ${!edge.introSentAt ? `<button class="button small" data-mark-intro="${edge.id}" type="button">Mark sent</button>` : `<button class="button small ghost" data-followup="${edge.id}" type="button">${edge.followUpCount ? "Add another follow-up" : "Log a follow-up meeting"}</button><span class="follow-count">${edge.followUpCount || 0} logged</span>`}
            </div>
          </article>`;
        }).join("") || '<p class="empty-state">Connector pairings will appear here as ready-to-send introductions.</p>'}
      </div>
      <div class="section-kicker">03 Â· Texted notes</div>
      <div class="section-head"><div><h2>What the room told you.</h2><p class="muted">Everything texted in during the event, and the follow-ups it opened.</p></div></div>
      <div class="notes-feed">
        ${notesFor(event.id).map(n => noteCardHtml(n, guests)).join("") || '<p class="empty-state">No notes were texted in during this event.</p>'}
      </div>
      ${followUpsFor(event.id).length ? '<div class="texter-list">' + followUpsFor(event.id).filter(f => f.status !== "done").map(followUpRowHtml).join("") + "</div>" : ""}
    </section>`;

  const close = document.getElementById("close-debrief");
  if (close) close.addEventListener("click", async () => {
    const picked = body.querySelector('input[name="did-win"]:checked');
    if (!picked) { close.textContent = "Choose yes or not yet"; return; }
    const loops = {}; body.querySelectorAll("[data-loop-person]").forEach(i => loops[i.dataset.loopPerson] = i.value);
    close.disabled = true; close.textContent = "Closing...";
    await dbSaveDebrief(event, picked.value === "true", document.getElementById("debrief-notes").value, loops);
    await loadStoreFromDb(); renderEvent(event.id, "after");
  });
  body.querySelectorAll("[data-copy-intro]").forEach(btn => btn.addEventListener("click", async () => {
    const card=btn.closest(".intro-card"), text=card.querySelector(".intro-draft").value;
    await navigator.clipboard.writeText(text); btn.textContent="Copied";
  }));
  body.querySelectorAll("[data-mark-intro]").forEach(btn => btn.addEventListener("click", async () => {
    const card=btn.closest(".intro-card"), text=card.querySelector(".intro-draft").value;
    btn.disabled=true; await dbMarkIntroSent(btn.dataset.markIntro,text); await loadStoreFromDb(); renderEvent(event.id,"after");
  }));
  body.querySelectorAll("[data-followup]").forEach(btn => btn.addEventListener("click", async () => {
    const edge=event.edges.find(e=>e.id===btn.dataset.followup); btn.disabled=true;
    await dbLogFollowUp(edge.id,(edge.followUpCount||0)+1); await loadStoreFromDb(); renderEvent(event.id,"after");
  }));
  body.querySelectorAll("[data-fup-done]").forEach(btn => btn.addEventListener("click", async () => {
    btn.disabled = true;
    await dbSetFollowUpDone(btn.dataset.fupDone, true);
    await loadStoreFromDb(); renderEvent(event.id, "after");
  }));
  body.querySelectorAll("[data-assign-for]").forEach(sel => sel.addEventListener("change", async () => {
    if (!sel.value) return;
    sel.disabled = true;
    await dbResolveNote(sel.dataset.assignFor, sel.value);
    await loadStoreFromDb(); renderEvent(event.id, "after");
  }));
}
