import { $, request, escapeHtml, badge, guarded, toggle } from "./core.js";

const money = cents => cents ? `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

export async function loadDiscovery() {
  const tools = await request("/api/v1/discovery");
  $("#discovery-body").innerHTML = tools.map(t => `<tr class="${t.status === "ignored" ? "dim" : ""}">
    <td><strong>${escapeHtml(t.name)}</strong><br><span class="muted">${t.recognized ? escapeHtml(`${t.vendor} · ${t.category}`) : "Unrecognized AI-like app"}</span></td>
    <td title="${escapeHtml(t.users.join(", "))}">${t.users.length}</td><td>${t.eventCount}</td><td>${money(t.spendCents)}</td><td>${t.lastSeen ? escapeHtml(t.lastSeen) : "—"}</td><td>${badge(t.status)}</td>
    <td><div class="actions">${t.status === "new" ? `<button class="small" data-register="${escapeHtml(t.toolKey)}">Add to register</button><button class="secondary small" data-ignore="${escapeHtml(t.toolKey)}">Ignore</button>` : t.status === "ignored" ? `<button class="secondary small" data-restore="${escapeHtml(t.toolKey)}">Restore</button>` : ""}</div></td></tr>`).join("");
  toggle($("#discovery-empty"), tools.length === 0);
}

export function initDiscovery({ onRegistered }) {
  $("#discovery-form").addEventListener("submit", guarded("#discovery-error", async event => {
    const form = event.currentTarget, file = form.elements.file.files[0];
    if (!file) throw new Error("Choose a CSV file");
    if (file.size > 10_000_000) throw new Error("That file is larger than 10 MB; split it and import the parts");
    const summary = await request("/api/v1/discovery/import", { method: "POST", body: { source: form.elements.source.value, csv: await file.text() } });
    $("#discovery-result").textContent = `Read ${summary.rows} rows; ${summary.matchedRows} matched ${summary.tools.length} AI tool${summary.tools.length === 1 ? "" : "s"}.`;
    form.reset(); await loadDiscovery();
  }));
  $("#discovery-body").addEventListener("click", guarded("#discovery-error", async event => {
    const button = event.target.closest("button");
    if (!button) return;
    const key = button.dataset.register ?? button.dataset.ignore ?? button.dataset.restore;
    if (button.dataset.register) { await request(`/api/v1/discovery/${key}/register`, { method: "POST", body: {} }); await onRegistered(); }
    else await request(`/api/v1/discovery/${key}/ignore`, { method: "POST", body: { ignored: !!button.dataset.ignore } });
    await loadDiscovery();
  }));
}
