import { $, can, session, request, escapeHtml, badge, formValues, guarded, toggle, dateTime } from "./core.js";

function renderMfa(enabled) {
  $("#mfa-state").innerHTML = badge(enabled ? "on" : "off");
  toggle($("#mfa-off"), !enabled);
  toggle($("#mfa-disable"), enabled);
  toggle($("#mfa-enroll"), false);
}

export async function loadSettings() {
  renderMfa(session.user.mfaEnabled);
  if (!can.manage(session.user.role)) return;
  const [org, sso, provisioning, catalog] = await Promise.all([request("/api/v1/organization"), request("/api/v1/sso"), request("/api/v1/provisioning"), request("/api/v1/catalog")]);
  $("#require-mfa").checked = org.requireMfa;
  $("#slack-state").innerHTML = org.slackConfigured ? badge("connected") : badge("off", "not connected");

  $("#sso-redirect").textContent = sso.redirectUri;
  const form = $("#sso-form"), c = sso.connection;
  form.elements.issuer.value = c?.issuer ?? ""; form.elements.clientId.value = c?.clientId ?? ""; form.elements.clientSecret.value = "";
  form.elements.domains.value = c?.domains.map(d => d.domain).join(", ") ?? ""; form.elements.enforce.checked = !!c?.enforce; form.elements.autoProvisionRole.value = c?.autoProvisionRole ?? "";
  form.elements.clientSecret.required = !c;
  toggle($("#sso-remove"), !!c);
  toggle($("#sso-domains"), !!c?.domains.length);
  $("#sso-domains-body").innerHTML = (c?.domains ?? []).map(d => `<tr><td><strong>${escapeHtml(d.domain)}</strong></td>
    <td><span class="muted small-text">Name</span><br><code>${escapeHtml(d.txtName)}</code><br><span class="muted small-text">Value</span><br><code>${escapeHtml(d.txtValue)}</code></td>
    <td>${d.verified ? badge("on", "verified") : badge("pending", "not verified")}</td>
    <td>${d.verified ? "" : `<button class="small" data-verify-domain="${escapeHtml(d.domain)}">Verify</button>`}</td></tr>`).join("");
  $("#sso-state").innerHTML = c ? badge(c.enforce ? "enforced" : "on") : badge("off");

  $("#provisioning-tool").innerHTML = catalog.map(t => `<option value="${escapeHtml(t.key)}">${escapeHtml(t.name)}</option>`).join("");
  $("#provisioning-connections").innerHTML = provisioning.connections.map(p => `<tr><td>${escapeHtml(catalog.find(t => t.key === p.toolKey)?.name ?? p.toolKey)}</td><td><code>${escapeHtml(p.baseUrl)}</code></td><td>${p.accounts}</td><td>${p.errors ? badge("error", String(p.errors)) : "0"}</td><td><button class="secondary small" data-remove-provisioning="${escapeHtml(p.toolKey)}">Remove</button></td></tr>`).join("")
    || `<tr><td colspan="5" class="muted">No tools connected.</td></tr>`;
  $("#provisioning-accounts").innerHTML = provisioning.accounts.map(a => `<tr><td>${escapeHtml(a.toolKey)}</td><td>${escapeHtml(a.displayName)}<br><span class="muted">${escapeHtml(a.email)}</span></td><td>${badge(a.status)}${a.lastError ? `<br><span class="error small-text">${escapeHtml(a.lastError)}</span>` : ""}</td><td>${dateTime(a.syncedAt)}</td></tr>`).join("")
    || `<tr><td colspan="4" class="muted">No seats provisioned yet.</td></tr>`;
}

export function initSettings({ onMfaEnabled }) {
  $("#mfa-start").addEventListener("click", guarded("#mfa-error", async () => {
    const { secret, otpauthUri } = await request("/api/v1/auth/mfa/setup", { method: "POST", body: {} });
    $("#mfa-secret").textContent = secret.replace(/(.{4})/g, "$1 ").trim();
    $("#mfa-uri").href = otpauthUri;
    toggle($("#mfa-off"), false); toggle($("#mfa-enroll"), true);
    $("#mfa-enroll [name=code]").focus();
  }));
  $("#mfa-enroll").addEventListener("submit", guarded("#mfa-error", async event => {
    const form = event.currentTarget;
    const { recoveryCodes } = await request("/api/v1/auth/mfa/enable", { method: "POST", body: { code: formValues(form).code } });
    form.reset();
    session.user.mfaEnabled = true; session.user.mfaSetupRequired = false;
    toggle($("#mfa-enroll"), false);
    $("#mfa-codes-list").textContent = recoveryCodes.join("\n");
    toggle($("#mfa-codes"), true);
  }));
  $("#mfa-codes-done").addEventListener("click", async () => { toggle($("#mfa-codes"), false); renderMfa(true); await onMfaEnabled(); });
  $("#mfa-disable").addEventListener("submit", guarded("#mfa-error", async event => {
    const form = event.currentTarget;
    await request("/api/v1/auth/mfa/disable", { method: "POST", body: formValues(form) });
    form.reset(); session.user.mfaEnabled = false; renderMfa(false);
  }));

  $("#require-mfa").addEventListener("change", guarded("#org-error", async event => {
    await request("/api/v1/organization", { method: "PATCH", body: { requireMfa: event.target.checked } });
  }));

  $("#sso-form").addEventListener("submit", guarded("#sso-error", async event => {
    const form = event.currentTarget, v = formValues(form);
    await request("/api/v1/sso", { method: "PUT", body: {
      issuer: v.issuer, clientId: v.clientId, ...(v.clientSecret ? { clientSecret: v.clientSecret } : {}),
      domains: v.domains.split(/[\s,]+/).filter(Boolean), enforce: form.elements.enforce.checked, autoProvisionRole: v.autoProvisionRole || null
    } });
    await loadSettings();
  }));
  $("#sso-domains-body").addEventListener("click", guarded("#sso-error", async event => {
    const button = event.target.closest("[data-verify-domain]");
    if (!button) return;
    button.disabled = true;
    try { await request(`/api/v1/sso/domains/${encodeURIComponent(button.dataset.verifyDomain)}/verify`, { method: "POST", body: {} }); }
    finally { button.disabled = false; }
    await loadSettings();
  }));
  $("#sso-remove").addEventListener("click", guarded("#sso-error", async () => {
    if (!confirm("Remove single sign-on? Members will sign in with passwords again.")) return;
    await request("/api/v1/sso", { method: "DELETE" }); await loadSettings();
  }));

  const slackMessage = text => { $("#slack-message").textContent = text; };
  $("#slack-form").addEventListener("submit", guarded("#slack-error", async event => {
    const form = event.currentTarget;
    await request("/api/v1/organization", { method: "PATCH", body: { slackWebhookUrl: form.elements.url.value } });
    form.reset(); slackMessage("Slack connected."); await loadSettings();
  }));
  $("#slack-test").addEventListener("click", guarded("#slack-error", async () => {
    const { delivered } = await request("/api/v1/organization/slack/test", { method: "POST", body: {} });
    slackMessage(delivered ? "Test message sent." : "Slack is not connected or did not accept the message.");
  }));
  $("#slack-remove").addEventListener("click", guarded("#slack-error", async () => {
    await request("/api/v1/organization", { method: "PATCH", body: { slackWebhookUrl: null } });
    slackMessage("Slack disconnected."); await loadSettings();
  }));

  $("#provisioning-form").addEventListener("submit", guarded("#provisioning-error", async event => {
    const form = event.currentTarget, v = formValues(form);
    await request(`/api/v1/provisioning/${v.key}`, { method: "PUT", body: { baseUrl: v.baseUrl, ...(v.token ? { token: v.token } : {}) } });
    form.reset(); await loadSettings();
  }));
  $("#provisioning-connections").addEventListener("click", guarded("#provisioning-error", async event => {
    const button = event.target.closest("[data-remove-provisioning]");
    if (!button || !confirm("Remove this connection? Existing seats in the tool are left as they are.")) return;
    await request(`/api/v1/provisioning/${button.dataset.removeProvisioning}`, { method: "DELETE" }); await loadSettings();
  }));
  $("#provisioning-sync").addEventListener("click", guarded("#provisioning-error", async () => {
    const result = await request("/api/v1/provisioning/sync", { method: "POST", body: {} });
    $("#provisioning-error").textContent = result.failed ? `${result.failed} of ${result.attempted} still failing.` : "";
    await loadSettings();
  }));
}
