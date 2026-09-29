import { $, $$, can, session, request, toggle } from "./js/core.js";
import { initAuth, showStep } from "./js/auth.js";
import { initOverview, loadOverview, applyOverviewRole } from "./js/overview.js";
import { initRequests, loadRequests } from "./js/requests.js";
import { initPolicy, loadPolicy } from "./js/policy.js";
import { initDiscovery, loadDiscovery } from "./js/discovery.js";
import { initReports, loadReports } from "./js/reports.js";
import { initTeam, loadTeam } from "./js/team.js";
import { initSettings, loadSettings } from "./js/settings.js";
import { initLanding, portal, showLanding, showShell } from "./js/landing.js";

// Password-reset and SSO-error links open the sign-in card, not the landing page.
// Read before initAuth, which strips these parameters from the URL.
const openSignIn = ["reset", "sso_error"].some(name => new URLSearchParams(location.search).has(name));

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
  session.user = null;
  showShell();
  toggle($("#login-view"), true); toggle($("#dashboard-view"), false);
  if (!keepStep) showStep("password");
}

async function showDashboard(user) {
  session.user = user;
  showShell();
  toggle($("#login-view"), false); toggle($("#dashboard-view"), true);
  $("#organization-name").textContent = user.organizationName;
  $("#user-name").textContent = `${user.displayName} · ${user.role.replace("_", " ")}`;
  for (const button of $$("[data-tab]")) toggle(button, tabAllowed(button.dataset.tab, user.role) && (!user.mfaSetupRequired || button.dataset.tab === "settings"));
  for (const element of $$(".manage-only")) toggle(element, can.manage(user.role) && !user.mfaSetupRequired);
  for (const element of $$(".decider-only")) toggle(element, can.approve(user.role));
  for (const option of $$(".owner-only")) { option.hidden = user.role !== "owner"; option.disabled = user.role !== "owner"; }
  toggle($("#mfa-required-banner"), !!user.mfaSetupRequired);
  toggle($("#portal-notice"), portal() === "admin" && !can.manage(user.role));
  applyOverviewRole(user.role);
  await openTab(location.hash.slice(1) || (portal() === "employee" ? "requests" : "overview"));
}

for (const button of $$("[data-tab]")) button.addEventListener("click", () => openTab(button.dataset.tab));
$("#logout").addEventListener("click", async () => {
  try { await request("/api/v1/auth/logout", { method: "POST", body: {} }); }
  catch (error) { console.error("Sign-out request failed", error); }
  session.user = null;
  history.replaceState(null, "", "/");
  showLanding();
});

initAuth({ onSignedIn: showDashboard });
initLanding({ onChoose: () => showLogin() });
initOverview();
initRequests();
initPolicy();
initDiscovery({ onRegistered: loadOverview });
initReports();
initTeam();
initSettings({ onMfaEnabled: async () => showDashboard((await request("/api/v1/auth/me")).user) });

(async () => {
  try { await showDashboard((await request("/api/v1/auth/me")).user); }
  catch { if (openSignIn) showLogin({ keepStep: true }); else showLanding(); }
})();
