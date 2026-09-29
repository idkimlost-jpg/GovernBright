import { $, request, escapeHtml, badge, guarded, dateTime } from "./core.js";

const pct = (n, d) => d ? `${Math.round((n / d) * 100)}%` : "—";

// Plain-language names for the audit actions people look at most; the raw action stays visible below.
const actionLabels = {
  "tool_request.created": "Requested", "tool_request.approved": "Approved request", "tool_request.rejected": "Rejected request",
  "tool_request.launched": "Launched approved tool", "policy.published": "Published AI use policy", "policy.accepted": "Accepted AI use policy",
  "member.added": "Added member", "member.updated": "Updated member", "auth.login": "Signed in", "auth.logout": "Signed out"
};
const describe = e => {
  const label = actionLabels[e.action] ?? e.action;
  return e.metadata?.toolName ? `${label}: ${e.metadata.toolName}` : label;
};

export async function loadReports() {
  const [evidence, audit] = await Promise.all([request("/api/v1/reports/evidence"), request("/api/v1/reports/audit?limit=25")]);
  const tiles = [
    ["Systems", evidence.systems.total], ["Assessed", evidence.assessments.length], ["Overdue reviews", evidence.systems.overdueReviews.length],
    ["Policy accepted", evidence.policy ? pct(evidence.policy.accepted, evidence.policy.members) : "—"], ["MFA adoption", pct(evidence.access.mfaEnabled, evidence.access.members)],
    ["Clauses covered", evidence.frameworkCoverage.length]
  ];
  $("#evidence-metrics").innerHTML = tiles.map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`).join("");
  $("#audit-body").innerHTML = audit.map(e => `<tr><td>${dateTime(e.createdAt)}</td><td>${escapeHtml(e.actorName ?? "System")}</td><td>${escapeHtml(describe(e))}<br><code class="muted">${escapeHtml(e.action)}</code></td><td>${badge(e.result === "success" ? "active" : "error", e.result)}</td></tr>`).join("");
}

export function initReports() {
  $("#audit-export").addEventListener("submit", guarded(null, event => {
    const form = event.currentTarget, params = new URLSearchParams();
    for (const key of ["from", "to"]) if (form.elements[key].value) params.set(key, form.elements[key].value);
    location.assign(`/api/v1/reports/audit.csv${params.size ? `?${params}` : ""}`);
  }));
}
