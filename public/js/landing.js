import { $, $$, toggle } from "./core.js";

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
  $("#login-portal").textContent = labels[portal()];
}
