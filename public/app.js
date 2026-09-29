import { $, $$, can, session, request, toggle } from "./js/core.js";
import { initAuth, showStep } from "./js/auth.js";
import { initOverview, loadOverview, applyOverviewRole } from "./js/overview.js";
import { initRequests, loadRequests, ensureCatalog, isLaunchable } from "./js/requests.js";
import { initLive, startLive, stopLive } from "./js/live.js";
import { initPolicy, loadPolicy } from "./js/policy.js";
import { initDiscovery, loadDiscovery } from "./js/discovery.js";
import { initReports, loadReports } from "./js/reports.js";
import { initTeam, loadTeam } from "./js/team.js";
import { initSettings, loadSettings } from "./js/settings.js";

const loaders = { overview: loadOverview, requests: loadRequests, policy: loadPolicy, discovery: loadDiscovery, reports: loadReports, team: loadTeam, settings: loadSettings };
const tabAllowed = (tab, role) => {
  const requirement = $(`[data-tab="${tab}"]`)?.dataset.requires;
  return !requirement || can[requirement](role);
};

async function openTab(tab) {
  const role = session.user.role;
  if (session.user.mfaSetupRequired) tab = "settings";
  if (!loaders[tab] || !tabAllowed(tab, role)) tab = "overview";
  for (const button of $$("[data-tab]")) button.classList.toggle("active", button.dataset.tab === tab);
  for (const panel of $$("[data-panel]")) toggle(panel, panel.dataset.panel === tab);
  if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
  try { await loaders[tab](); }
  catch (error) {
    if (error.code === "mfa_setup_required") { session.user.mfaSetupRequired = true; return openTab("settings"); }
    if (error.status === 401) return showLogin();
    console.error(error);
  }
}

function showLogin({ keepStep = false } = {}) {
  stopLive();
  session.user = null;
  toggle($("#login-view"), true); toggle($("#dashboard-view"), false);
  if (!keepStep) showStep("password");
}

async function showDashboard(user) {
  session.user = user;
  toggle($("#login-view"), false); toggle($("#dashboard-view"), true);
  $("#organization-name").textContent = user.organizationName;
  $("#user-name").textContent = `${user.displayName} · ${user.role.replace("_", " ")}`;
  for (const button of $$("[data-tab]")) toggle(button, tabAllowed(button.dataset.tab, user.role) && (!user.mfaSetupRequired || button.dataset.tab === "settings"));
  for (const element of $$(".manage-only")) toggle(element, can.manage(user.role) && !user.mfaSetupRequired);
  for (const element of $$(".decider-only")) toggle(element, can.approve(user.role));
  for (const option of $$(".owner-only")) { option.hidden = user.role !== "owner"; option.disabled = user.role !== "owner"; }
  toggle($("#mfa-required-banner"), !!user.mfaSetupRequired);
  applyOverviewRole(user.role);
  if (!user.mfaSetupRequired) {
    await ensureCatalog().catch(() => {});
    startLive({ launchable: isLaunchable, onChange: () => { if ($("[data-tab].active")?.dataset.tab === "requests") loadRequests().catch(() => {}); } });
  }
  await openTab(location.hash.slice(1) || "overview");
}

for (const button of $$("[data-tab]")) button.addEventListener("click", () => openTab(button.dataset.tab));
$("#logout").addEventListener("click", async () => {
  try { await request("/api/v1/auth/logout", { method: "POST", body: {} }); }
  catch (error) { console.error("Sign-out request failed", error); }
  showLogin();
});

initAuth({ onSignedIn: showDashboard });
initOverview();
initRequests();
initLive();
initPolicy();
initDiscovery({ onRegistered: loadOverview });
initReports();
initTeam();
initSettings({ onMfaEnabled: async () => showDashboard((await request("/api/v1/auth/me")).user) });

(async () => {
  try { await showDashboard((await request("/api/v1/auth/me")).user); }
  catch { showLogin({ keepStep: true }); }
})();
