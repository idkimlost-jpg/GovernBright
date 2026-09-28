import { $, $$, request, toggle, formValues, guarded } from "./core.js";

let challenge = null;
const resetToken = new URLSearchParams(location.search).get("reset");

export function showStep(step) {
  for (const form of $$("#login-view form")) toggle(form, form.dataset.step === step);
  $("#login-error").textContent = "";
  $("#login-title").textContent = { password: "Welcome back", mfa: "Two-factor check", forgot: "Reset your password", reset: "Choose a new password" }[step];
  $("#login-subtitle").textContent = {
    password: "Sign in to your organization’s governance workspace.",
    mfa: "Enter the code from your authenticator app, or one of your recovery codes.",
    forgot: "We’ll email you a link to choose a new password.",
    reset: "Use at least 12 characters."
  }[step];
}

function notice(message) { $("#login-notice").textContent = message; toggle($("#login-notice"), !!message); }

export function initAuth({ onSignedIn }) {
  for (const link of $$("[data-step-link]")) link.addEventListener("click", () => { notice(""); showStep(link.dataset.stepLink); });

  $("#login-form").addEventListener("submit", guarded("#login-error", async event => {
    const data = await request("/api/v1/auth/login", { method: "POST", body: formValues(event.currentTarget) });
    if (data.mfaRequired) { challenge = data.challenge; showStep("mfa"); $("#mfa-form [name=code]").focus(); return; }
    await onSignedIn(data.user);
  }));

  $("#mfa-form").addEventListener("submit", guarded("#login-error", async event => {
    const form = event.currentTarget;
    const data = await request("/api/v1/auth/mfa/verify", { method: "POST", body: { challenge, code: formValues(form).code } });
    form.reset();
    await onSignedIn(data.user);
  }));

  $("#sso-button").addEventListener("click", guarded("#login-error", async () => {
    const email = $("#login-form [name=email]").value;
    if (!email) throw new Error("Enter your work email first");
    const { redirectUrl } = await request("/api/v1/auth/sso/start", { method: "POST", body: { email } });
    location.assign(redirectUrl);
  }));

  $("#forgot-form").addEventListener("submit", guarded("#login-error", async event => {
    const data = await request("/api/v1/auth/password-reset", { method: "POST", body: formValues(event.currentTarget) });
    showStep("password");
    notice(data.status);
  }));

  $("#reset-form").addEventListener("submit", guarded("#login-error", async event => {
    const { password, confirm } = formValues(event.currentTarget);
    if (password !== confirm) throw new Error("The passwords don't match");
    await request("/api/v1/auth/password-reset/confirm", { method: "POST", body: { token: resetToken, password } });
    history.replaceState(null, "", "/");
    showStep("password");
    notice("Your password was changed. Sign in with the new password.");
  }));

  const ssoError = new URLSearchParams(location.search).get("sso_error");
  showStep(resetToken ? "reset" : "password");
  if (ssoError) { $("#login-error").textContent = ssoError; history.replaceState(null, "", "/"); }
}
