const $ = selector => document.querySelector(selector);
const loginView = $("#login-view");
const dashboardView = $("#dashboard-view");
const contentGrid = $(".content-grid");
const createPanel = $("#create-panel");
const canCreate = new Set(["owner", "admin", "contributor"]);
const canApprove = new Set(["owner", "admin"]);
const canManageMembers = new Set(["owner", "admin"]);
const roleLabels = { owner: "Owner", admin: "Admin", contributor: "Contributor", reviewer: "Reviewer", read_only: "Read only" };
let currentUser = null;

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showLogin() { loginView.classList.remove("hidden"); dashboardView.classList.add("hidden"); }
function showDashboard(user) {
  currentUser = user;
  loginView.classList.add("hidden"); dashboardView.classList.remove("hidden");
  $("#organization-name").textContent = user.organizationName;
  $("#user-name").textContent = `${user.displayName} · ${user.role.replace("_", " ")}`;
  $("#open-create").classList.toggle("hidden", !canCreate.has(user.role));
  $("#status-approved").disabled = !canApprove.has(user.role);
  $("#status-approved").hidden = !canApprove.has(user.role);
  document.querySelectorAll(".decider-only").forEach(el => el.classList.toggle("hidden", !canApprove.has(user.role)));
  $("#members-panel").classList.toggle("hidden", !canManageMembers.has(user.role));
  document.querySelectorAll(".owner-only").forEach(el => { el.hidden = user.role !== "owner"; el.disabled = user.role !== "owner"; });
}
async function loadDashboard() {
  await Promise.all([loadSystems(), loadRequests(), canManageMembers.has(currentUser.role) ? loadMembers() : null]);
}
function escapeHtml(value) { const span = document.createElement("span"); span.textContent = value ?? ""; return span.innerHTML; }
function badge(value) { const text = String(value); const token = text.replace(/[^a-z_]/g, ""); return `<span class="badge ${token}">${escapeHtml(text.replace("_", " "))}</span>`; }

async function loadSystems() {
  const systems = await request("/api/v1/ai-systems");
  $("#metric-total").textContent = systems.length;
  $("#metric-high").textContent = systems.filter(x => x.riskTier === "high" || x.riskTier === "prohibited").length;
  $("#metric-review").textContent = systems.filter(x => x.status === "under_review").length;
  $("#metric-approved").textContent = systems.filter(x => x.status === "approved").length;
  $("#systems-body").innerHTML = systems.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.vendor)}</td><td>${escapeHtml(x.ownerName)}</td><td>${badge(x.riskTier)}</td><td>${badge(x.status)}</td><td>${x.nextReviewAt ? escapeHtml(x.nextReviewAt) : "—"}</td></tr>`).join("");
  $("#empty-state").classList.toggle("hidden", systems.length > 0);
  $(".table-wrap").classList.toggle("hidden", systems.length === 0);
}

async function loadRequests() {
  const requests = await request("/api/v1/tool-requests");
  const decider = canApprove.has(currentUser.role);
  $("#requests-body").innerHTML = requests.map(r => `<tr><td>${escapeHtml(r.toolName)}</td>${decider ? `<td>${escapeHtml(r.requesterName)}<br><span class="muted">${escapeHtml(r.requesterEmail)}</span></td>` : ""}<td>${escapeHtml(r.businessPurpose)}</td><td>${badge(r.status)}</td><td>${escapeHtml(new Date(r.requestedAt).toLocaleDateString())}</td>${decider ? `<td>${r.status === "pending" ? `<div class="actions"><button data-decide="approved" data-id="${escapeHtml(r.id)}">Approve</button><button class="reject" data-decide="rejected" data-id="${escapeHtml(r.id)}">Reject</button></div>` : escapeHtml(r.decisionNotes || "—")}</td>` : ""}</tr>`).join("");
  $("#requests-empty").classList.toggle("hidden", requests.length > 0);
}

async function loadMembers() {
  const members = await request("/api/v1/members");
  const isOwner = currentUser.role === "owner";
  $("#members-body").innerHTML = members.map(m => {
    const self = m.userId === currentUser.userId, locked = self || (m.role === "owner" && !isOwner);
    const options = Object.entries(roleLabels).filter(([role]) => isOwner || role !== "owner" || m.role === "owner")
      .map(([role, label]) => `<option value="${role}"${role === m.role ? " selected" : ""}>${label}</option>`).join("");
    return `<tr><td>${escapeHtml(m.displayName)}${self ? " (you)" : ""}</td><td>${escapeHtml(m.email)}</td><td><select data-member-role="${escapeHtml(m.userId)}"${locked ? " disabled" : ""}>${options}</select></td><td>${badge(m.active ? "active" : "inactive")}</td><td>${locked ? "" : `<button class="secondary" data-member-active="${escapeHtml(m.userId)}" data-active="${!m.active}">${m.active ? "Deactivate" : "Reactivate"}</button>`}</td></tr>`;
  }).join("");
}

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault(); $("#login-error").textContent = "";
  const form = new FormData(event.currentTarget);
  try { const data = await request("/api/v1/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) }); showDashboard(data.user); await loadDashboard(); }
  catch (error) { $("#login-error").textContent = error.message; }
});
$("#logout").addEventListener("click", async () => {
  try { await request("/api/v1/auth/logout", { method: "POST", body: "{}" }); }
  catch (error) { console.error("Sign-out request failed", error); }
  showLogin();
});
$("#open-create").addEventListener("click", () => { createPanel.classList.remove("hidden"); contentGrid.classList.add("has-form"); });
$("#close-create").addEventListener("click", () => { createPanel.classList.add("hidden"); contentGrid.classList.remove("has-form"); });
$("#create-form").addEventListener("submit", async event => {
  event.preventDefault(); $("#create-error").textContent = "";
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  payload.nextReviewAt = payload.nextReviewAt || null;
  try { await request("/api/v1/ai-systems", { method: "POST", body: JSON.stringify(payload) }); event.currentTarget.reset(); createPanel.classList.add("hidden"); contentGrid.classList.remove("has-form"); await loadSystems(); }
  catch (error) { $("#create-error").textContent = error.message; }
});

$("#request-form").addEventListener("submit", async event => {
  event.preventDefault(); $("#request-error").textContent = "";
  const form = event.currentTarget;
  try { await request("/api/v1/tool-requests", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); await loadRequests(); }
  catch (error) { $("#request-error").textContent = error.message; }
});
$("#requests-body").addEventListener("click", async event => {
  const button = event.target.closest("[data-decide]");
  if (!button) return;
  $("#request-error").textContent = "";
  try { await request(`/api/v1/tool-requests/${button.dataset.id}`, { method: "PATCH", body: JSON.stringify({ decision: button.dataset.decide }) }); await loadRequests(); }
  catch (error) { $("#request-error").textContent = error.message; }
});
$("#member-form").addEventListener("submit", async event => {
  event.preventDefault(); $("#member-error").textContent = "";
  const form = event.currentTarget;
  try { await request("/api/v1/members", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); await loadMembers(); }
  catch (error) { $("#member-error").textContent = error.message; }
});
async function updateMember(userId, change) {
  $("#member-error").textContent = "";
  try { await request(`/api/v1/members/${userId}`, { method: "PATCH", body: JSON.stringify(change) }); }
  catch (error) { $("#member-error").textContent = error.message; }
  await loadMembers();
}
$("#members-body").addEventListener("change", event => {
  const select = event.target.closest("[data-member-role]");
  if (select) updateMember(select.dataset.memberRole, { role: select.value });
});
$("#members-body").addEventListener("click", event => {
  const button = event.target.closest("[data-member-active]");
  if (button) updateMember(button.dataset.memberActive, { active: button.dataset.active === "true" });
});

(async () => { try { const data = await request("/api/v1/auth/me"); showDashboard(data.user); await loadDashboard(); } catch { showLogin(); } })();
