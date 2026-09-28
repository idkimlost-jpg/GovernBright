import { $, can, session, request, escapeHtml, formValues, guarded, toggle, date } from "./core.js";

let currentPolicyId = null;

export async function loadPolicy() {
  const { policy, acceptedAt } = await request("/api/v1/policy");
  currentPolicyId = policy?.id ?? null;
  $("#policy-title").textContent = policy ? policy.title : "No policy published yet";
  $("#policy-version").textContent = policy ? `Version ${policy.version} · published ${new Date(policy.publishedAt).toLocaleDateString()}${policy.publishedBy ? ` by ${policy.publishedBy}` : ""}` : "";
  $("#policy-body").textContent = policy ? policy.body : "Your administrators haven't published an AI use policy.";
  toggle($("#policy-accept-row"), !!policy && !acceptedAt);
  toggle($("#policy-accepted"), !!acceptedAt);
  $("#policy-accepted").textContent = acceptedAt ? `You accepted this version on ${new Date(acceptedAt).toLocaleDateString()}.` : "";
  if (can.manage(session.user.role)) {
    const status = await request("/api/v1/policy/status");
    $("#policy-status-body").innerHTML = status.policy
      ? status.members.map(m => `<tr><td>${escapeHtml(m.displayName)}</td><td>${escapeHtml(m.email)}</td><td>${m.acceptedAt ? date(m.acceptedAt) : '<span class="badge pending">not yet</span>'}</td></tr>`).join("")
      : `<tr><td colspan="3" class="muted">Publish a policy to track acceptance.</td></tr>`;
  }
}

export function initPolicy() {
  $("#policy-accept").addEventListener("click", guarded("#policy-error", async () => {
    await request(`/api/v1/policy/${currentPolicyId}/accept`, { method: "POST", body: {} });
    await loadPolicy();
    toggle($("#policy-banner"), false);
  }));
  $("#policy-form").addEventListener("submit", guarded("#policy-form-error", async event => {
    const form = event.currentTarget;
    if (!confirm("Publish this version? Everyone will need to accept it again before requesting AI tools.")) return;
    await request("/api/v1/policy", { method: "POST", body: formValues(form) });
    form.reset(); await loadPolicy();
  }));
}
