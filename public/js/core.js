export const $ = selector => document.querySelector(selector);
export const $$ = selector => [...document.querySelectorAll(selector)];

export const can = {
  create: role => ["owner", "admin", "contributor"].includes(role),
  approve: role => ["owner", "admin"].includes(role),
  manage: role => ["owner", "admin"].includes(role),
  assess: role => ["owner", "admin", "reviewer"].includes(role),
  audit: role => ["owner", "admin", "reviewer"].includes(role),
  discovery: role => ["owner", "admin"].includes(role)
};
export const roleLabels = { owner: "Owner", admin: "Admin", contributor: "Contributor", reviewer: "Reviewer", read_only: "Read only" };

export const session = { user: null };

// JSON API call; errors carry the server's message and code.
export async function request(url, options = {}) {
  const init = { credentials: "same-origin", ...options, headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) } };
  if (init.body && typeof init.body !== "string") init.body = JSON.stringify(init.body);
  const response = await fetch(url, init);
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "Request failed"), { code: data.code, status: response.status });
  return data;
}

export function escapeHtml(value) { const span = document.createElement("span"); span.textContent = value ?? ""; return span.innerHTML; }
// value picks the color class; label (optional) is the visible text.
export function badge(value, label) { const token = String(value).replace(/[^a-z_]/g, ""); return `<span class="badge ${token}">${escapeHtml(label ?? String(value).replace(/_/g, " "))}</span>`; }
export const formValues = form => Object.fromEntries(new FormData(form));
export const toggle = (element, visible) => element.classList.toggle("hidden", !visible);
export const date = value => value ? escapeHtml(new Date(value).toLocaleDateString()) : "—";
export const dateTime = value => value ? escapeHtml(new Date(value).toLocaleString()) : "—";

// Runs an async handler, showing any error in the given element.
export function guarded(errorSelector, handler) {
  return async event => {
    event?.preventDefault?.();
    const target = $(errorSelector);
    if (target) target.textContent = "";
    try { await handler(event); } catch (error) { if (target) target.textContent = error.message; else console.error(error); }
  };
}
