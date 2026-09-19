/* ============================================================
   Villagers - Guest-facing RSVP page and People directory.
   Depends on app.js (store, helpers, esc). The RSVP page is the
   one public view: it talks to the database through the anonymous
   RSVP RPCs and never touches the host's sign-in.
   ============================================================ */

"use strict";

/* ============================================================
   View: RSVP page (what a guest sees when they open the link)
   Gatsby-flavored: quiet, serif, hosted-by line, no app chrome.
   The URL carries the event's public RSVP token.
   ============================================================ */
async function renderRsvpPage(token) {
  setNav("");
  app.innerHTML = `<section class="rsvp-page"><div class="rsvp-card"><p class="eyebrow">You're invited</p><p class="muted">Loading your invitation...</p></div></section>`;

  const { data, error } = await sb.rpc("get_rsvp_event", { token });
  const event = data && data[0];
  if (error || !event) {
    app.innerHTML = `
      <section class="rsvp-page"><div class="rsvp-card">
        <p class="eyebrow">You're invited</p>
        <h1>This link<br /><em>doesn't open.</em></h1>
        <p class="muted">The invitation link looks off - ask the host to send it again.</p>
      </div></section>`;
    return;
  }

  const template = TEMPLATES.find(t => t.id === event.template_id) || TEMPLATES[3];
  const host = event.host_name || "";
  const tz = event.timezone || "America/New_York";
  app.innerHTML = `
    <section class="rsvp-page">
      <div class="rsvp-card">
        <p class="eyebrow">${esc(template.id === "scratch" ? "You're invited" : template.name)}</p>
        <h1>${esc(event.title)}</h1>
        <p class="rsvp-when">${fmtTsDate(event.starts_at, tz)}${event.starts_at ? " · doors " + fmtTsTime(event.starts_at, tz) : ""}${event.location ? "<br />" + esc(event.location) : ""}</p>
        ${host ? `<p class="rsvp-host">Hosted by ${esc(host)}</p>` : ""}
        <form id="rsvp-form" class="rsvp-form">
          <label for="r-name">Your name</label>
          <input id="r-name" required placeholder="Full name" />
          <label for="r-email">Email</label>
          <input id="r-email" type="email" required placeholder="you@fund.com" />
          <label>Can you make it?</label>
          <div class="rsvp-choices">
            <label class="rsvp-choice"><input type="radio" name="r-status" value="yes" checked /> <span>I'll be there</span></label>
            <label class="rsvp-choice"><input type="radio" name="r-status" value="maybe" /> <span>Maybe</span></label>
            <label class="rsvp-choice"><input type="radio" name="r-status" value="no" /> <span>Regrets</span></label>
          </div>
          <label for="r-dietary">Dietary notes</label>
          <input id="r-dietary" placeholder="Vegetarian, allergies, anything the kitchen should know" />
          <label class="rsvp-plusone"><input id="r-plusone" type="checkbox" /> <span>I'm bringing a plus-one</span></label>
          <label for="r-note">Anything for ${host ? esc(firstName(host)) : "the host"}?</label>
          <textarea id="r-note" placeholder="Running late, bringing a colleague, a question..."></textarea>
          <button class="button" type="submit">Send RSVP</button>
          <p class="gate-error" id="rsvp-error" hidden>Something didn't go through - try once more, or text the host.</p>
        </form>
        <div id="rsvp-done" class="rsvp-done" hidden>
          <h2>You're on<br /><em>the list.</em></h2>
          <p class="muted" id="rsvp-done-note"></p>
        </div>
        <p class="rsvp-foot">Your reply goes straight to ${host ? esc(firstName(host)) + "'s" : "the host's"} Villagers
          system - it lands on the event guest list the moment you send it.</p>
      </div>
    </section>`;

  document.getElementById("rsvp-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = document.getElementById("r-name").value.trim();
    const email = document.getElementById("r-email").value.trim();
    if (!name || !email) return;
    const status = (document.querySelector('input[name="r-status"]:checked') || {}).value || "yes";
    const dietary = document.getElementById("r-dietary").value.trim();
    const plusOne = document.getElementById("r-plusone").checked;
    const note = document.getElementById("r-note").value.trim();

    const btn = ev.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Sending...";
    const { error: submitError } = await sb.rpc("submit_rsvp", {
      token, guest_name: name, guest_email: email, status,
      dietary: dietary || null, plus_one: plusOne ? "yes" : null, note: note || null
    });
    if (submitError) {
      console.error(submitError);
      btn.disabled = false; btn.textContent = "Send RSVP";
      document.getElementById("rsvp-error").hidden = false;
      return;
    }

    document.getElementById("rsvp-form").hidden = true;
    const done = document.getElementById("rsvp-done");
    done.hidden = false;
    document.getElementById("rsvp-done-note").textContent =
      status === "yes" ? `${host || "The host"} has your RSVP${dietary ? " and your dietary note" : ""}. See you at doors.` :
      status === "maybe" ? "Marked as maybe - the host will check in closer to the date." :
      "You'll be missed - the host knows.";
  });
}

/* ============================================================
   View: People - the standing directory across every event
   ============================================================ */
function renderPeople() {
  setNav("people");
  const people = store.people.slice().sort((a, b) => a.name.localeCompare(b.name));
  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">People</p>
      <h1>Everyone you've<br /><em>ever hosted.</em></h1>
      <p class="lede">One standing record per person - not a one-off list per event. History,
        open loops and notes carry forward, so a returning guest feels remembered.</p>
    </section>
    <section class="section">
      ${people.length ? people.map(p => {
        const evts = eventsFor(p.id);
        const loops = evts.map(e => ({ e, intel: e.intel[p.id] })).filter(x => x.intel && x.intel.openLoop);
        return `
        <div class="person-row" data-person-row="${p.id}">
          <div class="person-main">
            ${avatarHtml(p)}
            <div class="person-id">
              <span class="p-name">${esc(p.name)}</span>
              ${p.flags.vip ? '<span class="flag vip on">VIP</span>' : ""}
              <span class="p-role">${esc([p.role, p.company].filter(Boolean).join(" · ")) || "Role TBD"}</span>
              ${p.context ? `<span class="p-context">${esc(p.context)}${p.contextSuggested ? ' <span class="suggest-chip">suggested · editable</span>' : ""}</span>` : ""}
            </div>
          </div>
          <div class="person-history">
            ${evts.length ? evts.map(e => `<a class="history-chip" href="#/event/${e.id}">${esc(e.name.replace(/ \(sample\)$/, ""))}</a>`).join("") : '<span class="muted">No events yet</span>'}
          </div>
          ${loops.length ? `<div class="person-loops">${loops.map(x => `<span class="loop-line">Open loop · ${esc(x.e.name.replace(/ \(sample\)$/, ""))}: ${esc(x.intel.openLoop)}</span>`).join("")}</div>` : ""}
          <details class="person-edit">
            <summary>Edit record</summary>
            <div class="add-guest-grid">
              <div>
                <label>Role</label><input data-pf="role" value="${esc(p.role)}" />
                <label>Company</label><input data-pf="company" value="${esc(p.company)}" />
                <label>Dietary / logistics</label><input data-pf="dietary" value="${esc(p.dietary)}" />
              </div>
              <div>
                <label>Email</label><input data-pf="email" value="${esc(p.email)}" />
                <label>LinkedIn URL</label><input data-pf="linkedin" value="${esc(p.linkedin)}" />
                <label>Public context</label>
                <input data-pf="context" value="${esc(p.context)}" placeholder="What public data would say about this person" />
              </div>
              <div>
                <label>Host notes</label><textarea data-pf="note">${esc(p.note)}</textarea>
                <label class="rsvp-plusone"><input data-pf="vip" type="checkbox" ${p.flags.vip ? "checked" : ""} /> <span>VIP</span></label>
                <button class="button small" data-save-person="${p.id}" type="button">Save</button>
              </div>
            </div>
          </details>
        </div>`;
      }).join("") : `<p class="empty-state">Nobody here yet. Add guests to an event and their records land here permanently.</p>`}
    </section>`;

  app.querySelectorAll("[data-save-person]").forEach(btn => btn.addEventListener("click", async () => {
    const p = personById(btn.dataset.savePerson);
    const row = btn.closest("[data-person-row]");
    if (!p || !row) return;
    btn.disabled = true; btn.textContent = "Saving...";
    const writes = [];
    row.querySelectorAll("[data-pf]").forEach(input => {
      const f = input.dataset.pf;
      if (f === "vip") { p.flags.vip = input.checked; writes.push(dbUpdatePersonGlobal(p.id, "vip", input.checked)); }
      else if (f === "context") { p.context = input.value.trim(); p.contextSuggested = false; writes.push(dbUpdatePersonGlobal(p.id, "context", p.context)); }
      else { p[f] = input.value.trim(); writes.push(dbUpdatePersonGlobal(p.id, f, p[f])); }
    });
    await Promise.all(writes);
    await loadStoreFromDb();
    renderPeople();
  }));
  hydrateAvatars();
}
