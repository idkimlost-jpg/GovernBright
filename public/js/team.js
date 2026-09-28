import { $, session, request, escapeHtml, badge, formValues, guarded, roleLabels } from "./core.js";

export async function loadTeam() {
  const members = await request("/api/v1/members");
  const isOwner = session.user.role === "owner";
  $("#members-body").innerHTML = members.map(m => {
    const self = m.userId === session.user.userId, locked = self || (m.role === "owner" && !isOwner);
    const options = Object.entries(roleLabels).filter(([role]) => isOwner || role !== "owner" || m.role === "owner")
      .map(([role, label]) => `<option value="${role}"${role === m.role ? " selected" : ""}>${label}</option>`).join("");
    return `<tr><td>${escapeHtml(m.displayName)}${self ? " (you)" : ""}</td><td>${escapeHtml(m.email)}</td><td><select data-member-role="${escapeHtml(m.userId)}"${locked ? " disabled" : ""}>${options}</select></td><td>${badge(m.active ? "active" : "inactive")}</td><td>${locked ? "" : `<button class="secondary small" data-member-active="${escapeHtml(m.userId)}" data-active="${!m.active}">${m.active ? "Deactivate" : "Reactivate"}</button>`}</td></tr>`;
  }).join("");
}

async function updateMember(userId, change) {
  $("#member-error").textContent = "";
  try { await request(`/api/v1/members/${userId}`, { method: "PATCH", body: change }); }
  catch (error) { $("#member-error").textContent = error.message; }
  await loadTeam();
}

export function initTeam() {
  $("#member-form").addEventListener("submit", guarded("#member-error", async event => {
    const form = event.currentTarget;
    await request("/api/v1/members", { method: "POST", body: formValues(form) });
    form.reset(); await loadTeam();
  }));
  $("#members-body").addEventListener("change", event => {
    const select = event.target.closest("[data-member-role]");
    if (select) updateMember(select.dataset.memberRole, { role: select.value });
  });
  $("#members-body").addEventListener("click", event => {
    const button = event.target.closest("[data-member-active]");
    if (!button) return;
    if (button.dataset.active === "false" && !confirm("Deactivate this member? They are signed out and their provisioned AI tool seats are disabled.")) return;
    updateMember(button.dataset.memberActive, { active: button.dataset.active === "true" });
  });
}
