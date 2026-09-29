import { $, $$, toggle, request, formValues, guarded } from "./core.js";

// The portal choice only tailors the sign-in screen and the first tab shown;
// what a person can do is decided by their role on the server.
const labels = { employee: "Employee sign-in", admin: "Administrator sign-in" };
const storageKey = "governbright.portal";

export function portal() {
  try { return sessionStorage.getItem(storageKey) === "admin" ? "admin" : "employee"; } catch { return "employee"; }
}

function remember(value) {
  try { sessionStorage.setItem(storageKey, value); } catch { /* storage unavailable; default to employee */ }
}

export function showLanding() {
  toggle($("#landing-view"), true);
  toggle($(".shell"), false);
  window.scrollTo(0, 0);
}

export function showShell() {
  toggle($("#landing-view"), false);
  toggle($(".shell"), true);
}

export function initLanding({ onChoose }) {
  for (const button of $$("[data-portal]")) button.addEventListener("click", () => {
    remember(button.dataset.portal);
    $("#login-portal").textContent = labels[button.dataset.portal];
    onChoose();
    $("#login-form [name=email]").focus();
  });
  $("#back-to-landing").addEventListener("click", showLanding);
  $("#contact-form").addEventListener("submit", guarded("#contact-error", async event => {
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try { await request("/api/v1/contact", { method: "POST", body: formValues(form) }); }
    finally { button.disabled = false; }
    form.reset();
    $("#contact-status").textContent = "Thanks, your message has been sent. We'll reply by email.";
    toggle($("#contact-status"), true);
  }));
  $("#login-portal").textContent = labels[portal()];
}
