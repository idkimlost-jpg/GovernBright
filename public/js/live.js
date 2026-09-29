import { $, can, session, request, escapeHtml, toggle } from "./core.js";

// Keeps request status live without a page refresh: owners and admins get a popup for each new
// request, and employees get a notice with a launch link the moment their request is approved.
const POLL_MS = 4000;
const baseTitle = document.title;
let timer = null, known = null, onChange = () => {}, launchable = () => false;
const dismissed = new Set();

export const launchUrl = id => `/api/v1/tool-requests/${encodeURIComponent(id)}/launch`;

export function startLive(options) {
  stopLive();
  ({ onChange, launchable } = options);
  known = null;
  void tick();
  timer = setInterval(tick, POLL_MS);
}

export function stopLive() {
  clearInterval(timer);
  timer = null;
  known = null;
  hide();
}

function hide() {
  toggle($("#live-card"), false);
  document.title = baseTitle;
}

async function tick() {
  if (document.hidden || !session.user) return;
  let requests;
  try { requests = await request("/api/v1/tool-requests"); } catch { return; }
  const previous = known;
  known = new Map(requests.map(r => [r.id, r.status]));
  if (previous && requests.some(r => previous.get(r.id) !== r.status)) onChange();

  if (can.approve(session.user.role)) {
    const waiting = requests.filter(r => r.status === "pending" && r.requesterUserId !== session.user.userId && !dismissed.has(r.id));
    document.title = waiting.length ? `(${waiting.length}) ${baseTitle}` : baseTitle;
    if (waiting.length) showDecision(waiting.at(-1), waiting.length);
    else if ($("#live-card").dataset.kind === "decision") hide();
  } else if (previous) {
    // Anything approved since the last check, including a request approved before this page first saw it pending.
    const approved = requests.find(r => r.status === "approved" && previous.get(r.id) !== "approved");
    if (approved) showApproved(approved);
  }
}

function show(kind, html) {
  const card = $("#live-card");
  card.dataset.kind = kind;
  card.innerHTML = html;
  toggle(card, true);
}

function showDecision(r, count) {
  if ($("#live-card").dataset.requestId === r.id && !$("#live-card").classList.contains("hidden")) return;
  show("decision", `
    <p class="eyebrow">New AI tool request${count > 1 ? ` · ${count} waiting` : ""}</p>
    <h3>${escapeHtml(r.requesterName)} wants to use ${escapeHtml(r.toolName)}</h3>
    <p class="live-meta">${escapeHtml(r.requesterEmail)}</p>
    <dl><dt>Purpose</dt><dd>${escapeHtml(r.businessPurpose)}</dd>${r.dataDescription ? `<dt>Data involved</dt><dd>${escapeHtml(r.dataDescription)}</dd>` : ""}</dl>
    <div class="live-actions"><button data-live="approved">Approve</button><button class="reject" data-live="rejected">Reject</button><button class="secondary" data-live="later">Later</button></div>
    <p class="error" role="alert"></p>`);
  $("#live-card").dataset.requestId = r.id;
}

function showApproved(r) {
  show("approved", `
    <p class="eyebrow">Request approved</p>
    <h3>${escapeHtml(r.toolName)} is approved for you</h3>
    ${r.decisionNotes ? `<p class="live-meta">Note from your admin: ${escapeHtml(r.decisionNotes)}</p>` : ""}
    <div class="live-actions">${launchable(r) ? `<a class="button" href="${launchUrl(r.id)}" target="_blank" rel="noopener" data-live="close">Launch ${escapeHtml(r.toolName)}</a>` : ""}<button class="secondary" data-live="close">Close</button></div>`);
  $("#live-card").dataset.requestId = r.id;
}

export function initLive() {
  $("#live-card").addEventListener("click", async event => {
    const action = event.target.closest("[data-live]")?.dataset.live;
    if (!action) return;
    const card = $("#live-card"), id = card.dataset.requestId;
    if (action === "close") return hide();
    if (action === "later") { dismissed.add(id); hide(); return void tick(); }
    for (const button of card.querySelectorAll("button")) button.disabled = true;
    try {
      await request(`/api/v1/tool-requests/${id}`, { method: "PATCH", body: { decision: action } });
      dismissed.add(id);
      show("done", `<p class="eyebrow">Decision recorded</p><h3>Request ${action}</h3><p class="live-meta">The employee sees this right away, and the decision is in the audit log.</p>`);
      setTimeout(() => { if (card.dataset.kind === "done") hide(); }, 3500);
      onChange();
      void tick();
    } catch (error) {
      for (const button of card.querySelectorAll("button")) button.disabled = false;
      card.querySelector(".error").textContent = error.message;
    }
  });
}
