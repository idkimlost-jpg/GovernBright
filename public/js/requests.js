import { $, $$, can, session, request, escapeHtml, badge, formValues, guarded, toggle, date } from "./core.js";
import { launchUrl } from "./live.js";

let catalog = [];
const trainsLabel = { no: "Does not train on your data", yes: "May train on your data", opt_out: "Trains unless you opt out", plan_dependent: "Depends on plan" };

export async function ensureCatalog() {
  if (!catalog.length) catalog = await request("/api/v1/catalog");
  return catalog;
}

// Only the requester can launch, only once approved, and only tools with a catalog link.
export const isLaunchable = r => r.status === "approved" && r.requesterUserId === session.user?.userId && !!catalog.find(c => c.key === r.toolKey)?.website;

export async function loadRequests() {
  const [requests, policy] = await Promise.all([request("/api/v1/tool-requests"), request("/api/v1/policy"), ensureCatalog()]);
  $("#catalog-options").innerHTML = catalog.map(c => `<option value="${escapeHtml(c.name)}">`).join("");
  toggle($("#policy-banner"), !!policy.policy && !policy.acceptedAt);
  const decider = can.approve(session.user.role);
  const tool = key => catalog.find(c => c.key === key);
  $("#requests-body").innerHTML = requests.map(r => `<tr><td>${escapeHtml(r.toolName)}${tool(r.toolKey) ? `<br><span class="muted">${escapeHtml(tool(r.toolKey).vendor)}</span>` : ""}</td>${decider ? `<td>${escapeHtml(r.requesterName)}<br><span class="muted">${escapeHtml(r.requesterEmail)}</span></td>` : ""}<td>${escapeHtml(r.businessPurpose)}</td><td>${badge(r.status)}${isLaunchable(r) ? ` <a class="button small" href="${launchUrl(r.id)}" target="_blank" rel="noopener">Launch</a>` : ""}</td><td>${date(r.requestedAt)}</td>${decider ? `<td>${r.status === "pending" ? `<div class="actions"><button data-decide="approved" data-id="${escapeHtml(r.id)}">Approve</button><button class="reject" data-decide="rejected" data-id="${escapeHtml(r.id)}">Reject</button></div>` : escapeHtml(r.decisionNotes || "—")}</td>` : ""}</tr>`).join("");
  toggle($("#requests-empty"), requests.length === 0);
}

function showCatalogHint(name) {
  const entry = catalog.find(c => c.name.toLowerCase() === name.trim().toLowerCase());
  const hint = $("#catalog-hint");
  toggle(hint, !!entry);
  if (!entry) return;
  const facts = entry.reviewedAt
    ? [trainsLabel[entry.trainsOnCustomerData], entry.dataRetention && `Retention: ${entry.dataRetention}`, entry.certifications?.length && `Certifications: ${entry.certifications.join(", ")}`].filter(Boolean).map(escapeHtml).join(" · ")
      + ` <span class="muted">(reviewed ${escapeHtml(entry.reviewedAt)}${entry.sourceUrl ? `, <a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener">source</a>` : ""})</span>`
    : `<span class="muted">Vendor data practices not yet reviewed.</span>`;
  hint.innerHTML = `<strong>${escapeHtml(entry.name)}</strong> by ${escapeHtml(entry.vendor)} · ${escapeHtml(entry.category)}<br>${facts}`;
}

export function initRequests() {
  $("#request-form [name=toolName]").addEventListener("input", event => showCatalogHint(event.target.value));
  $("#request-form").addEventListener("submit", guarded("#request-error", async event => {
    const form = event.currentTarget;
    try {
      await request("/api/v1/tool-requests", { method: "POST", body: formValues(form) });
    } catch (error) {
      if (error.code === "policy_acceptance_required") toggle($("#policy-banner"), true);
      throw error;
    }
    form.reset(); toggle($("#catalog-hint"), false); await loadRequests();
  }));
  // guarded() cancels the click, so only decision buttons go through it; Launch links must still open.
  const decide = guarded("#request-error", async event => {
    const button = event.target.closest("[data-decide]");
    for (const b of $$(`[data-id="${button.dataset.id}"]`)) b.disabled = true;
    await request(`/api/v1/tool-requests/${button.dataset.id}`, { method: "PATCH", body: { decision: button.dataset.decide } });
    await loadRequests();
  });
  $("#requests-body").addEventListener("click", event => { if (event.target.closest("[data-decide]")) void decide(event); });
}
