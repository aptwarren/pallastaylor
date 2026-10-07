/* ============================================================
   Villagers v3 workspace (from the approved UX concept v3).
   Loaded after the v2 views: it overrides route, setNav and renderEvent,
   and adds the workspace shell, the Invite / Guest texts / Digest / Recap
   views and the outcome numbers. Roles:
     Platform team  - full workspace (this app, signed in)
     Host of record - team view + the day-of digest
     Guests         - texts only (RSVP page + text threads)
   ============================================================ */
"use strict";

const V3 = { sel: {}, extraLoaded: false };
const DOT = " &middot; ";

/* ---------- extra data: outcome numbers + conversation starter ---------- */
const _loadStoreV2 = loadStoreFromDb;
loadStoreFromDb = async function () {
  const ok = await _loadStoreV2();
  if (!ok) return ok;
  try {
    const [evx, hpx] = await Promise.all([
      sb.from("events").select("id,attended_count,target_total,targets_advanced,founder_meetings,cost_usd"),
      sb.from("host_people").select("person_id,conversation_starter").eq("host_id", currentHost.id)
    ]);
    if (!evx.error) (evx.data || []).forEach(r => {
      const e = eventById(r.id); if (!e) return;
      e.attended = r.attended_count; e.targetTotal = r.target_total; e.targetsAdvanced = r.targets_advanced;
      e.founderMeetings = r.founder_meetings; e.costUsd = r.cost_usd;
    });
    if (!hpx.error) (hpx.data || []).forEach(r => {
      const p = personById(r.person_id); if (p) p.starter = r.conversation_starter || "";
    });
    V3.extraLoaded = !evx.error;
  } catch (e) { console.error("v3 extras", e); }
  return ok;
};

async function v3SaveOutcomes(event, f) {
  const { error } = await sb.from("events").update({
    attended_count: f.attended, target_total: f.targetTotal, targets_advanced: f.targetsAdvanced,
    founder_meetings: f.founderMeetings, cost_usd: f.costUsd
  }).eq("id", event.id);
  if (error) console.error("outcomes save", error);
  return !error;
}

/* ---------- small helpers ---------- */
const plainName = (e) => (e.name || "").replace(/ \(sample\)$/, "");
function hostOf(event) { return (event && event.hostName) || (currentHost && currentHost.name) || "The host"; }
function clientOf() { return (currentHost && currentHost.name) || "Client"; }
function phaseOf(event) {
  const s = new Date(event.startsAt).getTime(), now = Date.now(), H = 3600e3;
  if (!s || now < s - 6 * H) return "Before the event";
  if (now < s + 8 * H) return "Day of";
  if (now < s + 30 * 24 * H) return "30-day recap";
  return "Past event";
}
function rsvpLabel(r) {
  if (!r) return "Pending";
  return r.status === "yes" ? "Confirmed" : r.status === "no" ? "Regrets" : r.status === "maybe" ? "Maybe" : r.status;
}
function rsvpLink(event) { return location.origin + location.pathname + "#/rsvp/" + event.rsvpToken; }
function roleLine(p) { return [p.role, p.company].filter(Boolean).join(" at ") || "Role TBD"; }
function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
function numOrNull(v) { const n = parseFloat(String(v).replace(/[$,]/g, "")); return isFinite(n) ? n : null; }

function annotate(action, goal, support, scope) {
  return `
  <div class="v3-annot">
    <div><h4>User action</h4><p>${action}</p></div>
    <div><h4>User goal</h4><p>${goal}</p></div>
    <div><h4>Villagers support</h4><p>${support}</p></div>
  </div>
  <div class="v3-scope"><b>Product scope</b><span>${scope}</span></div>`;
}

function phoneHtml(title, sub, bubbles, noteText) {
  return `
  <div class="v3-phone">
    <div class="v3-phone-bar"><span>9:41</span><span class="v3-phone-icons">&bull;&bull;&bull;</span></div>
    <div class="v3-phone-head"><b>${title}</b><small>${sub}</small></div>
    <div class="v3-phone-body">
      <div class="v3-phone-note">${noteText || "Illustrative conversation"}</div>
      ${bubbles.map(b => `<div class="v3-bub ${b.side}">${b.html}</div>`).join("")}
    </div>
    <div class="v3-phone-input">Text message &uarr;</div>
  </div>`;
}

/* ---------- workspace shell (sidebar) ---------- */
function ensureShell() {
  if (document.getElementById("ws-side")) return;
  const aside = document.createElement("aside");
  aside.id = "ws-side"; aside.className = "ws-side";
  const main = document.getElementById("app");
  const wrap = document.createElement("div");
  wrap.className = "ws-wrap";
  main.parentNode.insertBefore(wrap, main);
  wrap.appendChild(aside); wrap.appendChild(main);
}

function renderSide(active, event) {
  const side = document.getElementById("ws-side"); if (!side) return;
  const host = event ? hostOf(event) : ((store.events[0] && store.events[0].hostName) || clientOf());
  side.innerHTML = `
    <a class="ws-brand" href="#/">Villagers</a>
    <div class="ws-label">Workspace</div>
    <nav class="ws-nav">
      <a href="#/" data-nav="events" class="${active === "events" ? "active" : ""}">Events</a>
      <a href="#/people" data-nav="people" class="${active === "people" ? "active" : ""}">People</a>
      <a href="#/after" data-nav="after" class="${active === "after" ? "active" : ""}">Outcomes</a>
    </nav>
    <div class="ws-panel"><h5>Platform team</h5>
      <p>Full workspace</p><p>Client: ${esc(clientOf())}</p><p>Host of record: ${esc(host)}</p></div>
    <div class="ws-panel"><h5>Client / billing</h5>
      <p>${esc(clientOf())}</p><p>Paying GP: ${esc(host)}</p><p>Terms to agree</p><p>No price set</p></div>
    <div class="ws-panel"><h5>Access</h5>
      <p>Platform: workspace</p><p>Host + team: team view + digest</p><p>Guests: texts only</p></div>
    <button class="ws-out" id="ws-signout" type="button">Sign out</button>`;
  const so = document.getElementById("ws-signout");
  if (so) so.addEventListener("click", async () => { await sb.auth.signOut(); location.hash = "#/"; location.reload(); });
}

setNav = function (active) {
  ensureShell();
  const on = active !== "";
  document.body.classList.toggle("ws-on", on);
  if (on) renderSide(active, window.__v3Event || null);
};

/* ---------- router (default tab is Invite) ---------- */
route = function () {
  const hash = location.hash || "#/";
  const parts = hash.replace(/^#\//, "").split("/");
  window.scrollTo(0, 0);
  window.__v3Event = null;
  if (parts[0] === "rsvp" && parts[1]) return renderRsvpPage(parts[1]);
  if (!storeLoaded) { location.hash = "#/"; return; }
  if (parts[0] === "event" && parts[1]) return renderEvent(parts[1], parts[2] || "invite");
  if (parts[0] === "people") return renderPeople();
  if (parts[0] === "after") return renderAfter();
  return renderEvents();
};

/* ---------- event workspace ---------- */
const V3_TABS = [["overview", "Overview"], ["invite", "Invite"], ["guests", "Guests"], ["texts", "Guest texts"], ["intros", "Intros"], ["digest", "Digest"], ["recap", "Recap"]];
const V3_LEGACY = { connectors: "intros", notes: "digest", rsvp: "invite", after: "recap", settings: "overview" };

renderEvent = function (eventId, tab) {
  const event = eventById(eventId);
  if (!event) { location.hash = "#/"; return; }
  tab = V3_LEGACY[tab] || tab || "invite";
  if (!V3_TABS.some(t => t[0] === tab)) tab = "invite";
  window.__v3Event = event;
  setNav("events");
  const guests = event.guestIds.map(personById).filter(Boolean);
  const title = plainName(event);
  app.innerHTML = `
    <section class="v3-head">
      <div class="v3-crumb"><a href="#/">Events</a> / ${esc(title)}</div>
      <div class="v3-title-row">
        <div><h1 class="v3-h1">${esc(title)}</h1>
          <p class="v3-sub">${esc(fmtDate(event.date))}${event.doorsTime ? " &middot; doors " + esc(fmtTime(event.doorsTime)) : ""}${event.location ? " &middot; " + esc(event.location) : ""}</p></div>
        <span class="v3-phase">${phaseOf(event)}</span>
      </div>
      <nav class="v3-tabs">${V3_TABS.map(([id, label]) => `<a class="${tab === id ? "active" : ""}" href="#/event/${event.id}/${id}">${label}</a>`).join("")}</nav>
      <div class="v3-goal"><span class="v3-goal-tag">Event goal</span>
        <b>${event.win ? esc(event.win) : "Set the goal before inviting"}</b>
        <small>Chosen before inviting${DOT}<a href="#/event/${event.id}/overview">change</a></small></div>
    </section>
    <section id="tab-body" class="v3-body"></section>`;
  const body = document.getElementById("tab-body");
  ({ overview: v3Overview, invite: v3Invite, guests: v3Guests, texts: v3Texts, intros: v3Intros, digest: v3Digest, recap: v3Recap })[tab](body, event, guests);
  hydrateAvatars();
};

/* ----- Overview: summary, one record across events, settings ----- */
function v3Overview(body, event, guests) {
  const yes = guests.filter(g => (event.rsvp[g.id] || {}).status === "yes").length;
  const returning = guests.filter(g => eventsFor(g.id).length > 1).length;
  body.innerHTML = `
    <div class="v3-stats">
      <div><b>${guests.length}</b><span>On the list</span></div>
      <div><b>${yes}</b><span>Confirmed</span></div>
      <div><b>${returning}</b><span>Returning</span></div>
      <div><b>${(event.edges || []).length}</b><span>Intro paths</span></div>
    </div>
    ${v3Flow(event, guests)}
    <div class="v3-card"><h3>Event settings</h3><div id="v3-settings"></div></div>
    ${annotate("Platform team sets the goal, the timing and the host of record before anything goes out.",
      "Run one event against one stated goal.", "One event record: goal, guest list, invitation, digest and recap in the same place.",
      "First-test MVP: guest list &rarr; invite/RSVP &rarr; reviewed intelligence &rarr; day-of digest.")}`;
  renderSettingsTab(document.getElementById("v3-settings"), event);
}

function v3Flow(event, guests) {
  const next = (() => {
    const withHist = guests.find(g => eventsFor(g.id).length > 1);
    return withHist ? `${esc(withHist.name)}'s event history, interests and completed or open follow-ups inform the next brief.` : "Each guest's event history, interests and open follow-ups carry into the next brief.";
  })();
  return `
    <div class="v3-flow">
      <div>
        <h3>One record, across events</h3>
        <div class="v3-flow-row"><b>Before / Prepare the room</b><span>Guest list &rarr; host invitation &rarr; intake &rarr; reviewed profiles</span></div>
        <div class="v3-flow-row"><b>During / Make the connection</b><span>Digest &rarr; warm intro &rarr; deliberate text-in note</span></div>
        <div class="v3-flow-row"><b>After / Prove and follow through</b><span>Person + team recap &rarr; CRM handoff &rarr; outcome scorecard</span></div>
      </div>
      <div>
        <div class="v3-card tight"><h4>Next event / People record</h4><p>${next}</p></div>
        <div class="v3-future"><b>Future vision / Guest-list curation</b>
          <p>Villagers suggests who belongs in the next room from relationship history and the host's goal.</p>
          <small>Long-term direction, not the first-test MVP.</small></div>
      </div>
    </div>`;
}

/* ----- Invite: send-as, goal-linked guest list, people record ----- */
function v3Invite(body, event, guests) {
  const host = hostOf(event);
  const fromEmail = (currentHost && currentHost.digest_email) || "";
  if (!V3.sel[event.id] || !guests.some(g => g.id === V3.sel[event.id])) V3.sel[event.id] = guests[0] ? guests[0].id : null;
  body.innerHTML = `
    <div class="v3-cols">
      <div class="v3-col">
        <div class="v3-card">
          <h3>Invite page + send-as</h3>
          <div class="v3-rowline"><span class="v3-tint">${esc(host)}-owned invitation</span><span class="v3-chip">Host identity</span></div>
          <div class="v3-field">From: ${esc(host)}${fromEmail ? " &middot; " + esc(fromEmail) : ""}</div>
          <div class="v3-field">${esc(plainName(event))}${event.doorsTime ? " &middot; doors " + esc(fmtTime(event.doorsTime)) : ""}${event.location ? " &middot; " + esc(event.location) : ""}</div>
          <p class="v3-note">Custom RSVP page: event details, schedule, host, dietary needs. It goes out from ${esc(host)}'s own number or email, so guests see the host, not Villagers.</p>
          <div class="v3-actions">
            <a class="v3-btn ghost" id="v3-preview" href="${esc(rsvpLink(event))}" target="_blank" rel="noopener">Preview RSVP page</a>
            <button class="v3-btn dark" id="v3-review" type="button">Review invitation</button>
          </div>
          <div id="v3-review-box" hidden></div>
        </div>
        <div class="v3-card">
          <div class="v3-rowline"><h3>Guest list + goal-linked intelligence</h3><span class="v3-chip">${guests.length} guest${guests.length === 1 ? "" : "s"}</span></div>
          <p class="v3-note">Import a spreadsheet or LinkedIn profiles on the <a href="#/event/${event.id}/guests">Guests</a> tab.</p>
          <table class="v3-table">
            <thead><tr><th>Guest / RSVP</th><th>Why this person</th><th>Professional context</th></tr></thead>
            <tbody>${guests.map(g => `
              <tr class="${V3.sel[event.id] === g.id ? "sel" : ""}" data-pick="${g.id}">
                <td><b>${esc(g.name)}</b><br><small>${rsvpLabel(event.rsvp[g.id])}</small></td>
                <td><input class="v3-why" data-why="${g.id}" value="${esc(intelFor(event, g.id).ask)}" placeholder="Why this person, for the goal" /></td>
                <td>${esc(roleLine(g))}</td>
              </tr>`).join("") || `<tr><td colspan="3" class="muted">No guests yet. Add them on the Guests tab.</td></tr>`}</tbody>
          </table>
          <p class="v3-foot">One event record replaces the spreadsheet + research handoff.</p>
        </div>
        <details class="v3-card"><summary><h3 style="display:inline">Link, Luma page and responses</h3></summary><div id="v3-rsvp"></div></details>
      </div>
      <div class="v3-col"><div id="v3-record"></div></div>
    </div>
    ${annotate(`Platform team imports the list, prepares profiles and reviews invitations sent as ${esc(host)}.`,
      `Help ${esc(host)} deepen relationships and meet the right people without in-house events staff.`,
      `${esc(host)}-owned invitations, editable profiles, notes and recap in the full workspace.`,
      "First-test MVP: guest list &rarr; invite/RSVP &rarr; reviewed intelligence &rarr; day-of digest. Source quality and consent rules still need decisions.")}`;

  renderSelectedRecord(event);
  renderRsvpTab(document.getElementById("v3-rsvp"), event, guests);
  document.getElementById("v3-review").addEventListener("click", () => {
    const box = document.getElementById("v3-review-box");
    const msg = `You're invited - ${plainName(event)}, ${fmtDate(event.date)}${event.location ? " at " + event.location : ""}. Doors ${fmtTime(event.doorsTime)}. Can you make it? RSVP here: ${rsvpLink(event)}`;
    box.hidden = false;
    box.innerHTML = `<div class="v3-review"><b>Message ${esc(host)} sends from their own number or email</b><p>${esc(msg)}</p>
      <button class="v3-btn ghost" id="v3-copy-msg" type="button">Copy message + link</button>
      <small>Nothing is sent from here. Review it, then send it as ${esc(host)}.</small></div>`;
    document.getElementById("v3-copy-msg").addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText(msg); e.target.textContent = "Copied"; } catch (x) { e.target.textContent = "Copy failed"; }
    });
  });
  body.querySelectorAll("[data-pick]").forEach(tr => tr.addEventListener("click", (ev) => {
    if (ev.target.tagName === "INPUT") return;
    V3.sel[event.id] = tr.dataset.pick;
    body.querySelectorAll("[data-pick]").forEach(r => r.classList.toggle("sel", r === tr));
    renderSelectedRecord(event);
    hydrateAvatars();
  }));
  body.querySelectorAll("[data-why]").forEach(inp => {
    inp.addEventListener("focus", () => { V3.sel[event.id] = inp.dataset.why; });
    inp.addEventListener("change", async () => {
      intelFor(event, inp.dataset.why).ask = inp.value.trim();
      await dbUpdateIntel(event.id, inp.dataset.why, "ask", inp.value.trim());
      if (V3.sel[event.id] === inp.dataset.why) renderSelectedRecord(event);
    });
  });
}

function renderSelectedRecord(event) {
  const box = document.getElementById("v3-record"); if (!box) return;
  const p = personById(V3.sel[event.id]);
  if (!p) { box.innerHTML = `<div class="v3-card"><h3>People record</h3><p class="muted">Add a guest to see their record.</p></div>`; return; }
  const intel = intelFor(event, p.id), r = event.rsvp[p.id];
  const others = eventsFor(p.id).filter(e => e.id !== event.id).length;
  const edge = edgesFor(event, p.id)[0];
  let who = "";
  if (edge) {
    const o = personById(edge.aId === p.id ? edge.bId : edge.aId);
    if (o) who = `<div class="v3-who"><b>Who knows whom</b><p>${esc(firstName(o.name))} knows ${esc(firstName(p.name))}: ${esc(edge.basis)}. Ask ${esc(firstName(o.name))} to make the intro.</p><small>Host-confirmed connection, not inferred fact.</small></div>`;
  }
  box.innerHTML = `
    <div class="v3-card">
      <div class="v3-rowline"><h3>${esc(p.name)} / People record</h3>${avatarHtml(p)}</div>
      <p class="v3-rec-role"><b>${esc(roleLine(p))}</b><br>RSVP ${rsvpLabel(r).toLowerCase()}${DOT}${others ? "Hosted " + (others + 1) + " times" : "First event"}</p>
      <h5>Public professional context</h5>
      <textarea class="v3-ta" data-rec="context" rows="2" placeholder="What public sources say about this person">${esc(p.context)}</textarea>
      <small>${p.contextSuggested ? "Suggested" : "Host-entered"}${DOT}checked by the platform team${DOT}host can correct</small>
      <h5>Conversation starter</h5>
      <textarea class="v3-ta" data-rec="starter" rows="2" placeholder="One line the host can open with">${esc(p.starter || "")}</textarea>
      <small>Optional interest only if the guest supplied it.</small>
      <h5>Host-only ask / avoid / open loop</h5>
      <label>Ask<input data-rec="ask" value="${esc(intel.ask)}" /></label>
      <label>Avoid<input data-rec="avoid" value="${esc(intel.avoid)}" /></label>
      <label>Open loop<input data-rec="openLoop" value="${esc(intel.openLoop)}" /></label>
      ${who}
      <small class="v3-saved" id="v3-saved"></small>
    </div>`;
  box.querySelectorAll("[data-rec]").forEach(el => el.addEventListener("change", async () => {
    const f = el.dataset.rec, v = el.value.trim();
    if (f === "context") { p.context = v; p.contextSuggested = false; await dbUpdatePersonGlobal(p.id, "context", v); }
    else if (f === "starter") { p.starter = v; const { error } = await sb.from("host_people").update({ conversation_starter: v || null }).eq("host_id", currentHost.id).eq("person_id", p.id); if (error) console.error(error); }
    else { intel[f] = v; await dbUpdateIntel(event.id, p.id, f, v); const why = document.querySelector(`[data-why="${p.id}"]`); if (f === "ask" && why) why.value = v; }
    const s = document.getElementById("v3-saved"); if (s) s.textContent = "Saved";
  }));
}

/* ----- Guests / Intros reuse the v2 editors inside the workspace ----- */
function v3Guests(body, event, guests) { const d = document.createElement("div"); body.appendChild(d); renderGuestsTab(d, event, guests); }
function v3Intros(body, event, guests) {
  const d = document.createElement("div"); body.appendChild(d); renderConnectorsTab(d, event, guests);
}

/* ----- Guest texts: SMS journey ----- */
function v3Texts(body, event, guests) {
  const host = hostOf(event), title = plainName(event);
  const g0 = guests[0], gFirst = g0 ? firstName(g0.name) : "there";
  const link = rsvpLink(event);
  const ph = (n, label, goal, support, phone) => `
    <div class="v3-phone-col"><h3><span>${n}</span> ${label}</h3>${phone}
      <h5>User goal</h5><p>${goal}</p><h5>Villagers support</h5><p>${support}</p></div>`;
  const when = event.doorsTime ? fmtTime(event.doorsTime) : "";
  body.innerHTML = `
    <p class="v3-lede">${esc(g0 ? g0.name : "Guests")} and the rest of the room are guests. Texts only: no app, no host-only notes.</p>
    <div class="v3-phones">
      ${ph("01", "Host-owned RSVP", "Accept the right invitation quickly.",
        "A custom page with host, address and schedule. RSVP routes back to the event.",
        phoneHtml(esc(host) + DOT + esc(clientOf()), "Guest view &middot; Texts only", [
          { side: "in", html: `Hi ${esc(gFirst)}, ${esc(host)} here. Join us for ${esc(title)}${when ? ", doors " + esc(when) : ""}?` },
          { side: "in", html: `View the custom event page:<br><u>${esc(link.replace(/^https?:\/\//, "").slice(0, 38))}...</u>` },
          { side: "out", html: "I'm in." },
          { side: "in", html: "Confirmed. Want optional event-prep texts? Reply YES. You can attend without them." },
          { side: "out", html: "YES" }]))}
      ${ph("02", "3 short intake questions", "Meet relevant people, not collect random contacts.",
        "Role + company, current work and desired connections guide the host's introductions.",
        phoneHtml(esc(host) + DOT + esc(clientOf()), "Guest view &middot; Texts only", [
          { side: "in", html: "Share a little context for introductions? Your host sees it. Skip any question." },
          { side: "in", html: "1. What's your role and company?" },
          { side: "out", html: "Partner, Maple Family Office." },
          { side: "in", html: "2. What are you working on?" },
          { side: "out", html: "Portfolio strategy." },
          { side: "in", html: "3. Who would you like to meet?" },
          { side: "out", html: "Emerging fund managers." }]))}
      ${ph("03", "Event logistics by text", "Know why to attend, who to meet and how to get there.",
        "SMS connects guest intent to host preparation without exposing private relationship notes.",
        phoneHtml(esc(host) + DOT + esc(clientOf()), "Guest view &middot; Texts only", [
          { side: "out", html: "What's the address and schedule?" },
          { side: "in", html: `${event.location ? esc(event.location) + "; " : ""}${event.doorsTime ? "doors " + esc(when) + "; " : ""}${esc(host)} is your host.` },
          { side: "out", html: "Can I bring a colleague?" },
          { side: "in", html: `Plus-ones aren't confirmed for this event. I can ask ${esc(host)}.` },
          { side: "out", html: "Please ask." },
          { side: "in", html: "Sent for host review. I'll confirm when there's an answer." }]))}
    </div>
    <div class="v3-scope warn"><b>Status</b><span>The sample conversations above are illustrative; the event details in them come from this event. Today guests RSVP on the web page and the host sends the invite. Texting guests directly is not live: it needs carrier registration for a production number. Host-only notes never appear to guests. Guest floor notes remain optional and undecided.</span></div>`;
}

/* ----- Digest: team digest + platform notes ----- */
function v3Digest(body, event, guests) {
  const host = hostOf(event);
  const attending = guests.filter(g => (event.rsvp[g.id] || {}).status === "yes");
  const pool = attending.length ? attending : guests;
  const notes = notesFor(event.id).slice().reverse();
  const sendAt = digestTime(event);
  const bubs = [];
  bubs.push({ side: "in", html: `Tonight: ${esc(plainName(event))}.${event.win ? "<br>Goal: " + esc(event.win) + "." : ""}<br>${attending.length} confirmed of ${guests.length} invited.` });
  pool.slice(0, 6).forEach(g => {
    const i = intelFor(event, g.id);
    const parts = [`<b>${esc(g.name)}</b>${g.company ? " &middot; " + esc(g.company) : ""}`];
    if (i.ask) parts.push("Ask: " + esc(i.ask));
    if (i.avoid) parts.push("Avoid: " + esc(i.avoid));
    if (i.openLoop) parts.push("Open loop: " + esc(i.openLoop));
    bubs.push({ side: "in", html: parts.join("<br>") });
    if (g.starter) bubs.push({ side: "in", html: "Conversation starter: " + esc(g.starter) });
    const e = edgesFor(event, g.id)[0];
    if (e) { const o = personById(e.aId === g.id ? e.bId : e.aId); if (o) bubs.push({ side: "in", html: `${esc(firstName(o.name))} can introduce you to ${esc(firstName(g.name))}: ${esc(e.basis)}.` }); }
  });
  if (!pool.length) bubs.push({ side: "in", html: "No guests yet." });
  if (pool.length > 6) bubs.push({ side: "in", html: `+ ${pool.length - 6} more in the full digest.` });
  const nb = [];
  notes.slice(-4).forEach(n => {
    const p = n.person_id ? personById(n.person_id) : null;
    nb.push({ side: "out", html: esc(n.body) });
    nb.push({ side: "in", html: n.match_state === "matched" && p ? `Filed to ${esc(p.name)}'s event record.` : "Waiting for you to file it to a guest." });
  });
  if (!nb.length) nb.push({ side: "in", html: "Text a note to your Villagers number during the event. It is filed to the guest it names and opens a follow-up." });
  const plain = pool.map(g => digestLine(event, g, false)).join("\n\n");
  body.innerHTML = `
    <p class="v3-lede">${esc(host)} and the team receive the digest${sendAt ? " around " + esc(fmtTime(sendAt)) : ""} (${event.digestMinutes || 60} minutes before doors). The platform team captures notes and builds the recap.</p>
    <div class="v3-phones two">
      <div class="v3-phone-col"><h3><span>01</span> Team view / ${esc(host)} + team</h3>
        ${phoneHtml("Villagers &middot; Team digest", esc(host) + " + team &middot; Reviewed by platform team", bubs, "Built from this event's data")}
        <button class="v3-btn ghost" id="v3-digest-copy" type="button">Copy digest as text</button>
        <h5>User goal</h5><p>Walk in knowing who matters and who can connect them.</p>
        <h5>Villagers support</h5><p>Reviewed profiles and credible intro paths arrive about an hour before doors.</p></div>
      <div class="v3-phone-col"><h3><span>02</span> Host view / Platform team notes</h3>
        ${phoneHtml("Villagers &middot; Platform notes", "Platform team &middot; Full-workspace operator", nb, "Built from this event's notes")}
        <h5>User goal</h5><p>Keep a useful conversation from becoming a forgotten follow-up.</p>
        <h5>Villagers support</h5><p>Capture who met whom, the discussion, owner and next step. Confirm before saving.</p></div>
      <div class="v3-phone-col wide">${v3Flow(event, guests)}</div>
    </div>
    <div class="v3-scope warn"><b>Status</b><span>Today the digest is generated and emailed to ${esc((currentHost && currentHost.digest_email) || "the host")} at T-${event.digestMinutes || 60}; delivering it by text is not live yet. Notes texted to the Villagers number land below. Automatic replies to the texter are not live yet, so the replies shown here are what Villagers records.</span></div>
    <div class="v3-card"><div id="v3-notes"></div></div>
    ${annotate("Platform team prepares and captures notes. The host and team use the digest to make warm intros.",
      "Help the client team connect and keep the next step from becoming a forgotten follow-up.",
      "Team digest, restricted staff notes and a reviewed person/team recap with CRM handoff.",
      "First-test MVP ends at the day-of digest. Floor-note capture has a prototype; recap, CRM and ROI remain proposed. Automatic guest-list curation is future vision.")}`;
  document.getElementById("v3-digest-copy").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(`Villagers digest - ${plainName(event)}\n\n${plain}`); e.target.textContent = "Copied"; } catch (x) { e.target.textContent = "Copy failed"; }
  });
  renderNotesTab(document.getElementById("v3-notes"), event, guests);
}

/* ----- Recap: outcomes, individual + team recap, ROI ----- */
function v3Recap(body, event, guests) {
  const host = hostOf(event);
  const invited = guests.length, confirmed = guests.filter(g => (event.rsvp[g.id] || {}).status === "yes").length;
  const fups = followUpsFor(event.id), done = fups.filter(f => f.status === "done").length;
  const dash = (v) => (v === null || v === undefined ? "&ndash;" : v);
  const cost = event.costUsd, fm = event.founderMeetings;
  const per = cost && fm ? cost / fm : null;
  const phase = phaseOf(event);
  const withNotes = guests.filter(g => notesFor(event.id).some(n => n.person_id === g.id) || fups.some(f => f.person_id === g.id));
  const pick = V3.sel["recap" + event.id] && guests.find(g => g.id === V3.sel["recap" + event.id]) || withNotes[0] || guests[0];
  const pFups = pick ? fups.filter(f => f.person_id === pick.id) : [];
  const pNotes = pick ? notesFor(event.id).filter(n => n.person_id === pick.id) : [];
  const open = fups.filter(f => f.status !== "done");
  body.innerHTML = `
    <div class="v3-badge-row"><span class="v3-phase">${phase === "Before the event" || phase === "Day of" ? "Recap opens after the event" : phase}</span></div>
    <div class="v3-metrics">
      <div><b>${dash(event.attended)}</b><strong>Attended</strong><span>${invited} invited${DOT}${confirmed} confirmed</span></div>
      <div><b>${dash(event.targetsAdvanced)}${event.targetTotal != null ? " / " + event.targetTotal : ""}</b><strong>Target guests advanced</strong><span>Second meetings held</span></div>
      <div><b>${dash(fm)}</b><strong>Founder meetings</strong><span>Qualified + held</span></div>
      <div><b>${fups.length ? done + " / " + fups.length : "&ndash;"}</b><strong>Follow-ups done</strong><span>From texted notes</span></div>
    </div>
    <details class="v3-card"><summary><h3 style="display:inline">Update outcome numbers</h3> <small>Entered by the platform team after the event</small></summary>
      <div class="v3-form" id="v3-outform">
        <label>Attended<input data-o="attended" inputmode="numeric" value="${event.attended ?? ""}" /></label>
        <label>Target guests (total)<input data-o="targetTotal" inputmode="numeric" value="${event.targetTotal ?? ""}" /></label>
        <label>Target guests advanced<input data-o="targetsAdvanced" inputmode="numeric" value="${event.targetsAdvanced ?? ""}" /></label>
        <label>Qualified founder meetings held<input data-o="founderMeetings" inputmode="numeric" value="${event.founderMeetings ?? ""}" /></label>
        <label>Fully loaded event cost ($)<input data-o="costUsd" inputmode="decimal" value="${event.costUsd ?? ""}" /></label>
        <button class="v3-btn dark" id="v3-outsave" type="button">Save numbers</button>
        <small id="v3-outmsg"></small>
      </div></details>
    <div class="v3-cols">
      <div class="v3-col">
        <div class="v3-card"><h3>Individual recap${pick ? " / " + esc(pick.name) : ""}</h3>
          ${guests.length > 1 ? `<select id="v3-recap-pick" class="v3-select">${guests.map(g => `<option value="${g.id}" ${pick && pick.id === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select>` : ""}
          ${pick ? `
          <p class="v3-rec-role"><b>Met ${esc(host)} and team</b>${pNotes.length ? " &middot; " + esc(pNotes[0].body.slice(0, 110)) : ""}</p>
          ${pFups.map(f => `<div class="v3-item"><div><b>${esc(f.summary)}</b><small>${f.status === "done" ? "Open loop closed" : "Open"}</small></div><span class="v3-pill ${f.status === "done" ? "ok" : ""}">${f.status === "done" ? "Complete" : "Open"}</span></div>`).join("") || `<p class="muted">No follow-ups logged for ${esc(firstName(pick.name))} yet. Text a note naming them during the event.</p>`}
          <small>Private context stays with the authorized host/team.</small>` : `<p class="muted">No guests yet.</p>`}
        </div>
        <div class="v3-card"><h3>Team recap / ${esc(host)} + team approve follow-ups</h3>
          ${open.map(f => { const p = f.person_id ? personById(f.person_id) : null; return `<div class="v3-item"><div><b>${esc(p ? p.name : "Guest")}</b><small>${esc(f.summary)}</small></div><span class="v3-pill">Open</span></div>`; }).join("") || `<p class="muted">No open follow-ups.</p>`}
          <div class="v3-field">CRM destination: not connected${DOT}proposed integration</div>
          <div class="v3-actions"><small>Review the note and owner before export.</small>
            <button class="v3-btn dark" id="v3-export" type="button">Review export</button></div>
          <div id="v3-export-box" hidden></div>
          <small>Proposed integration. CRM vs Villagers as source of truth is unresolved.</small>
        </div>
      </div>
      <div class="v3-col">
        <div class="v3-card"><h3>ROI calculator / Evidence before claims</h3>
          <div class="v3-roi"><span>Fully loaded event cost</span><b>${cost != null ? money(cost) : "&ndash;"}</b></div>
          <div class="v3-roi"><span>Qualified founder meetings held</span><b>${dash(fm)}</b></div>
          <div class="v3-roi"><span>Cost per qualified meeting</span><b>${per != null ? money(per) : "&ndash;"}</b></div>
          ${cost != null && fm ? `<small>${money(cost)} &divide; ${fm} = ${money(per)}</small>` : `<small>Enter cost and meetings above to calculate.</small>`}
          <div class="v3-warnbox"><b>Relationship progress &ne; financial return</b>
            <p>${event.targetsAdvanced != null ? event.targetsAdvanced + " target guest" + (event.targetsAdvanced === 1 ? "" : "s") + " took a verified next-stage action. " : ""}Capital commitments and pipeline are not realized profit.</p></div>
          <p class="v3-note">Separate event-sourced from event-influenced results. Use the same goal chosen before the event.</p>
          <button class="v3-btn ghost" id="v3-export2" type="button">Export team recap</button>
        </div>
      </div>
    </div>
    <div class="v3-card"><h3>Debrief and intro follow-through</h3><div id="v3-after"></div></div>
    ${annotate("Platform team builds the recap; the host and team review owners and approve the CRM handoff.",
      "Give the paying host evidence for whether to repeat the event.", "Role-scoped recap and reviewed export. Sensitive guest context stays private.",
      "After-event layer: proposed recap, CRM logging and ROI calculator. ROI formula, attribution window and system of record are not finalized.")}`;

  document.getElementById("v3-outsave").addEventListener("click", async (e) => {
    const g = (k) => numOrNull(document.querySelector(`[data-o="${k}"]`).value);
    const f = { attended: g("attended"), targetTotal: g("targetTotal"), targetsAdvanced: g("targetsAdvanced"), founderMeetings: g("founderMeetings"), costUsd: g("costUsd") };
    e.target.disabled = true;
    const ok = await v3SaveOutcomes(event, f);
    document.getElementById("v3-outmsg").textContent = ok ? "Saved" : "Could not save. Try again.";
    e.target.disabled = false;
    if (ok) { await loadStoreFromDb(); renderEvent(event.id, "recap"); }
  });
  const sel = document.getElementById("v3-recap-pick");
  if (sel) sel.addEventListener("change", () => { V3.sel["recap" + event.id] = sel.value; renderEvent(event.id, "recap"); });
  const text = () => `Villagers team recap - ${plainName(event)}\nGoal: ${event.win || "-"}\nAttended: ${event.attended ?? "-"} (${invited} invited, ${confirmed} confirmed)\nTarget guests advanced: ${event.targetsAdvanced ?? "-"}${event.targetTotal != null ? " of " + event.targetTotal : ""}\nQualified founder meetings: ${fm ?? "-"}\nCost per qualified meeting: ${per != null ? money(per) : "-"}\n\nOpen follow-ups:\n` +
    (open.map(f => { const p = f.person_id ? personById(f.person_id) : null; return `- ${p ? p.name : "Guest"}: ${f.summary}`; }).join("\n") || "- none");
  const copy = async (btn) => { try { await navigator.clipboard.writeText(text()); btn.textContent = "Copied"; } catch (x) { btn.textContent = "Copy failed"; } };
  document.getElementById("v3-export2").addEventListener("click", (e) => copy(e.target));
  document.getElementById("v3-export").addEventListener("click", () => {
    const box = document.getElementById("v3-export-box"); box.hidden = false;
    box.innerHTML = `<pre class="v3-pre">${esc(text())}</pre><button class="v3-btn ghost" id="v3-export-copy" type="button">Copy to paste into your CRM</button><small>Nothing is sent to a CRM from here.</small>`;
    document.getElementById("v3-export-copy").addEventListener("click", (e) => copy(e.target));
  });
  renderAfterEventTab(document.getElementById("v3-after"), event, guests);
}
