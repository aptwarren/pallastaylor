/* ============================================================
   Villagers - Event dashboard
   Tabs: Guests (per-guest intelligence) · Connectors · Digest ·
   RSVP · Settings. Depends on app.js (store, db helpers, esc).
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
  const tabs = [["guests", "Guests"], ["connectors", "Connectors"], ["digest", "Digest"], ["rsvp", "RSVP"], ["settings", "Settings"]];

  app.innerHTML = `
    <section class="book-head">
      <div class="crumb"><a href="#/">Events</a> / ${esc(event.name.replace(/ \(sample\)$/, ""))}</div>
      <div class="book-title-row">
        <h1>${esc(event.name.replace(/ \(sample\)$/, ""))}</h1>
      </div>
      <p class="book-goal">${fmtDate(event.date)}${event.doorsTime ? " · doors " + fmtTime(event.doorsTime) : ""}${event.location ? " · " + esc(event.location) : ""}
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
  if (tab === "connectors") renderConnectorsTab(body, event, guests);
  else if (tab === "digest") renderDigestTab(body, event, guests);
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
          <div class="guest-role">${esc([g.role, g.company].filter(Boolean).join(" · ")) || "Role TBD"}</div>
          ${rsvp ? `<div class="guest-flags"><span class="flag ${rsvp.status === "yes" ? "on" : ""}">${rsvp.status === "yes" ? "Confirmed" : esc(rsvp.status)}</span>${g.flags.vip ? '<span class="flag vip on">VIP</span>' : ""}</div>` : (g.flags.vip ? '<div class="guest-flags"><span class="flag vip on">VIP</span></div>' : "")}
          ${g.context ? `<div class="guest-context">${esc(g.context)}${g.contextSuggested ? ' <span class="suggest-chip">suggested · editable</span>' : ""}</div>` : ""}
          ${returningBadge(g, event.id)}
          <div class="intel-form" data-intel="${g.id}">
            <label>Arriving</label>
            <input type="time" data-f="arriving" value="${esc(intel.arriving)}" />
            <label>The ask - what does success with ${esc(firstName(g.name))} look like?</label>
            <input data-f="ask" value="${esc(intel.ask)}" placeholder="get them talking to X · say thank you · maintenance" />
            <label>Avoid - anything off-limits</label>
            <input data-f="avoid" value="${esc(intel.avoid)}" placeholder="recent layoff, a competitor in the room, a soured deal" />
            <label>Open loop from last time</label>
            <input data-f="openLoop" value="${esc(intel.openLoop)}" placeholder="said they'd send the deck · asked about your timeline" />
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
    if (el) el.textContent = `${stats.added} new · ${stats.returning} returning · ${stats.duplicates} already on the list`;
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
            <span class="edge-link">↔</span>
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
      <div class="digest-meta">Villagers · day-of digest${event.date ? " · " + fmtDate(event.date) : ""}${sendAt ? " · sends ~" + fmtTime(sendAt) : ""}</div>
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
  const entries = Object.entries(event.rsvp || {}).map(([pid, r]) => ({ person: personById(pid), r })).filter(x => x.person);
  const hostLine = event.hostName ? `from ${event.hostName}` : "from the host";
  body.innerHTML = `
    <div class="tab-intro">
      <p class="muted">Send the RSVP link by text or email <strong>${hostLine}</strong> - guests
        experience it as coming directly from you, not from Villagers. Their responses save
        straight to your guest list and land here live, on any device.</p>
      <p class="muted">Copy the link or the message and send it yourself - guests experience it as coming directly from you.</p>
    </div>
    <div class="rsvp-share">
      <label>RSVP link</label>
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
          <td>${esc([r.dietary, r.plusOne ? "plus-one" : ""].filter(Boolean).join(" · "))}</td>
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
