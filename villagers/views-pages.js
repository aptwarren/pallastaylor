/* ============================================================
   Villagers - Guest-facing RSVP page, People directory,
   and the "What's real" prototype/backend map.
   Depends on app.js (store, helpers, esc).
   ============================================================ */

"use strict";

/* ============================================================
   View: RSVP page (what a guest sees when they open the link)
   Gatsby-flavored: quiet, serif, hosted-by line, no app chrome.
   ============================================================ */
function renderRsvpPage(eventId) {
  const event = eventById(eventId);
  if (!event) { location.hash = "#/"; return; }
  setNav("");
  const template = TEMPLATES.find(t => t.id === event.templateId) || TEMPLATES[3];
  const host = event.hostName || "";
  app.innerHTML = `
    <section class="rsvp-page">
      <div class="rsvp-card">
        <p class="eyebrow">${esc(template.id === "scratch" ? "You're invited" : template.name)}</p>
        <h1>${esc(event.name.replace(/ \(sample\)$/, ""))}</h1>
        <p class="rsvp-when">${fmtDate(event.date)}${event.doorsTime ? " · doors " + fmtTime(event.doorsTime) : ""}${event.location ? "<br />" + esc(event.location) : ""}</p>
        ${host ? `<p class="rsvp-host">Hosted by ${esc(host)}</p>` : ""}
        <form id="rsvp-form" class="rsvp-form">
          <label for="r-name">Your name</label>
          <input id="r-name" required placeholder="Full name" />
          <label for="r-email">Email</label>
          <input id="r-email" type="email" placeholder="you@fund.com" />
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
        </form>
        <div id="rsvp-done" class="rsvp-done" hidden>
          <h2>You're on<br /><em>the list.</em></h2>
          <p class="muted" id="rsvp-done-note"></p>
        </div>
        <p class="rsvp-foot">Prototype note: in the live product this page is yours to send from your own
          number or email, and responses route straight to your Villagers system. Here, responses
          save in this browser only.</p>
      </div>
    </section>`;

  document.getElementById("rsvp-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = document.getElementById("r-name").value.trim();
    if (!name) return;
    const email = document.getElementById("r-email").value.trim();
    const status = (document.querySelector('input[name="r-status"]:checked') || {}).value || "yes";
    const dietary = document.getElementById("r-dietary").value.trim();
    const plusOne = document.getElementById("r-plusone").checked;
    const note = document.getElementById("r-note").value.trim();

    let person = findPerson({ name, email });
    if (!person) {
      person = Object.assign(blankPerson(name), { email });
      store.people.push(person);
    }
    if (email && !person.email) person.email = email;
    if (dietary && !person.dietary) person.dietary = dietary;
    if (plusOne) person.flags.plusOne = true;
    if (!event.guestIds.includes(person.id)) event.guestIds.push(person.id);
    event.rsvp[person.id] = { status, dietary, plusOne, note, at: new Date().toISOString().slice(0, 10) };
    saveStore();

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
                <label>Public context ${backendNote("auto-pull needs the backend")}</label>
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

  app.querySelectorAll("[data-save-person]").forEach(btn => btn.addEventListener("click", () => {
    const p = personById(btn.dataset.savePerson);
    const row = btn.closest("[data-person-row]");
    if (!p || !row) return;
    row.querySelectorAll("[data-pf]").forEach(input => {
      const f = input.dataset.pf;
      if (f === "vip") p.flags.vip = input.checked;
      else if (f === "context") { p.context = input.value.trim(); p.contextSuggested = false; }
      else p[f] = input.value.trim();
    });
    saveStore();
    renderPeople();
  }));
  hydrateAvatars();
}

/* ============================================================
   View: What's real - prototype vs backend, plainly
   ============================================================ */
function renderReal() {
  setNav("real");
  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">What's real</p>
      <h1>Prototype vs.<br /><em>the real thing.</em></h1>
      <p class="lede">Everything here runs in this browser - no accounts, no server, nothing
        uploaded. That's deliberate: it makes the product legible end-to-end before a dollar
        goes to infrastructure. Here's the honest line between the two.</p>
    </section>
    <section class="section real-grid">
      <div class="real-col">
        <h2>Works now, in this prototype</h2>
        <ul class="real-list">
          <li><strong>Event templates.</strong> Investor Breakfast, Happy Hour, Salon Dinner - each sets the tone of the guest RSVP page and sensible defaults.</li>
          <li><strong>RSVP page.</strong> The page a guest sees, the link you'd text them, and responses that land on the guest list.</li>
          <li><strong>People.</strong> A standing record per person across every event - role, company, context, dietary, notes - with "met before" history and open loops.</li>
          <li><strong>Guest intelligence.</strong> Per event, per guest: the ask, the avoid list, the open loop, arrival time.</li>
          <li><strong>Connector tags.</strong> Manual "who should meet whom" edges with the credible basis, surfaced in the digest.</li>
          <li><strong>Day-of digest preview.</strong> The exact text the host gets, rendered and copyable, timed from doors.</li>
        </ul>
      </div>
      <div class="real-col">
        <h2>Needs the real backend</h2>
        <ul class="real-list dim">
          <li><strong>Sending from you.</strong> RSVP links and the digest going out from your own email/number, so guests never see "Villagers" - today you copy and send yourself.</li>
          <li><strong>Public-data pull.</strong> Role, company and context auto-filled from LinkedIn and public sources, shown as suggestions you can edit - today everything is typed by hand (fields are marked where suggestions will land).</li>
          <li><strong>Actually texting the digest.</strong> Delivery at T-minus-60 (or whatever you set) without you opening anything.</li>
          <li><strong>Automatic connector matching.</strong> Suggested pairings from LinkedIn mutuals, shared portfolio companies and schools. Manual tags first; this comes later.</li>
          <li><strong>Sync.</strong> Your data currently lives in this one browser. Phone and laptop don't share it yet.</li>
        </ul>
      </div>
    </section>`;
}
