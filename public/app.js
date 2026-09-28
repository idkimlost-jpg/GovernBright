const $ = selector => document.querySelector(selector);
const loginView = $("#login-view");
const dashboardView = $("#dashboard-view");
const contentGrid = $(".content-grid");
const createPanel = $("#create-panel");

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showLogin() { loginView.classList.remove("hidden"); dashboardView.classList.add("hidden"); }
function showDashboard(user) {
  loginView.classList.add("hidden"); dashboardView.classList.remove("hidden");
  $("#organization-name").textContent = user.organizationName;
  $("#user-name").textContent = `${user.displayName} · ${user.role.replace("_", " ")}`;
}
function badge(value) { const safe = String(value); return `<span class="badge ${safe}">${safe.replace("_", " ")}</span>`; }
function escapeHtml(value) { const span = document.createElement("span"); span.textContent = value ?? ""; return span.innerHTML; }

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

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault(); $("#login-error").textContent = "";
  const form = new FormData(event.currentTarget);
  try { const data = await request("/api/v1/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) }); showDashboard(data.user); await loadSystems(); }
  catch (error) { $("#login-error").textContent = error.message; }
});
$("#logout").addEventListener("click", async () => { await request("/api/v1/auth/logout", { method: "POST", body: "{}" }); showLogin(); });
$("#open-create").addEventListener("click", () => { createPanel.classList.remove("hidden"); contentGrid.classList.add("has-form"); });
$("#close-create").addEventListener("click", () => { createPanel.classList.add("hidden"); contentGrid.classList.remove("has-form"); });
$("#create-form").addEventListener("submit", async event => {
  event.preventDefault(); $("#create-error").textContent = "";
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  payload.nextReviewAt = payload.nextReviewAt || null;
  try { await request("/api/v1/ai-systems", { method: "POST", body: JSON.stringify(payload) }); event.currentTarget.reset(); createPanel.classList.add("hidden"); contentGrid.classList.remove("has-form"); await loadSystems(); }
  catch (error) { $("#create-error").textContent = error.message; }
});

(async () => { try { const data = await request("/api/v1/auth/me"); showDashboard(data.user); await loadSystems(); } catch { showLogin(); } })();
