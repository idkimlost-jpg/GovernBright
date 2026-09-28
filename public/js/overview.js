import { $, can, session, request, escapeHtml, badge, formValues, guarded, toggle } from "./core.js";

let framework = null;
let systems = [];

export async function loadOverview() {
  systems = await request("/api/v1/ai-systems");
  $("#metric-total").textContent = systems.length;
  $("#metric-high").textContent = systems.filter(x => x.riskTier === "high" || x.riskTier === "prohibited").length;
  $("#metric-review").textContent = systems.filter(x => x.status === "under_review").length;
  $("#metric-approved").textContent = systems.filter(x => x.status === "approved").length;
  const assessor = can.assess(session.user.role);
  $("#systems-body").innerHTML = systems.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.vendor)}</td><td>${escapeHtml(x.ownerName)}</td><td>${badge(x.riskTier)}</td><td>${badge(x.status)}</td><td>${x.nextReviewAt ? escapeHtml(x.nextReviewAt) : "—"}</td><td>${assessor ? `<button class="secondary small" data-assess="${escapeHtml(x.id)}">Assess</button>` : ""}</td></tr>`).join("");
  toggle($("#empty-state"), systems.length === 0);
  toggle($("#systems-table"), systems.length > 0);
}

function closeCreate() { toggle($("#create-panel"), false); $(".content-grid").classList.remove("has-form"); }

async function openAssessment(systemId) {
  framework ??= await request("/api/v1/assessments/framework");
  const system = systems.find(s => s.id === systemId);
  const form = $("#assess-form");
  form.reset();
  form.dataset.systemId = systemId;
  $("#assess-title").textContent = `Assess ${system?.name ?? "system"}`;
  $("#assess-questions").innerHTML = framework.questions.map(q => `<fieldset class="question"><legend>${escapeHtml(q.prompt)}</legend>
    <label><input type="radio" name="${q.id}" value="yes" required> Yes</label><label><input type="radio" name="${q.id}" value="no"> No</label></fieldset>`).join("");
  toggle(form, true); toggle($("#assess-result"), false); $("#assess-error").textContent = "";
  $("#assess-dialog").showModal();
}

function renderResult(result) {
  const refs = control => control.references.map(r => `<span class="ref">${escapeHtml(r.framework)} ${escapeHtml(r.clause)}</span>`).join(" ");
  $("#assess-result").innerHTML = `<div class="panel-heading"><div><p class="eyebrow">Result</p><h3>${badge(result.decision)} ${badge(result.calculatedTier)} Score ${result.score}/100</h3></div><button class="icon" id="assess-done" aria-label="Close">×</button></div>
    <h4 class="subhead">Required controls</h4><ul class="controls">${result.requiredControls.map(c => `<li><strong>${escapeHtml(c.title)}</strong><div>${refs(c)}</div></li>`).join("")}</ul>
    <p class="muted small-text">Framework references are an indicative mapping to support your own legal review; they are not legal advice.</p>`;
  $("#assess-done").addEventListener("click", () => $("#assess-dialog").close());
}

export function initOverview() {
  $("#open-create").addEventListener("click", () => { toggle($("#create-panel"), true); $(".content-grid").classList.add("has-form"); });
  $("#close-create").addEventListener("click", closeCreate);
  $("#create-form").addEventListener("submit", guarded("#create-error", async event => {
    const form = event.currentTarget, payload = formValues(form);
    payload.nextReviewAt = payload.nextReviewAt || null;
    await request("/api/v1/ai-systems", { method: "POST", body: payload });
    form.reset(); closeCreate(); await loadOverview();
  }));
  $("#systems-body").addEventListener("click", guarded(null, async event => {
    const button = event.target.closest("[data-assess]");
    if (button) await openAssessment(button.dataset.assess);
  }));
  $("#assess-close").addEventListener("click", () => $("#assess-dialog").close());
  $("#assess-form").addEventListener("submit", guarded("#assess-error", async event => {
    const form = event.currentTarget, values = formValues(form);
    const responses = Object.fromEntries(framework.questions.map(q => [q.id, values[q.id] === "yes"]));
    const result = await request(`/api/v1/ai-systems/${form.dataset.systemId}/assessments`, { method: "POST", body: { responses, reviewNotes: values.reviewNotes || "" } });
    toggle(form, false); renderResult(result); toggle($("#assess-result"), true);
    await loadOverview();
  }));
}

export const applyOverviewRole = role => {
  toggle($("#open-create"), can.create(role));
  $("#status-approved").disabled = !can.approve(role);
  $("#status-approved").hidden = !can.approve(role);
};
