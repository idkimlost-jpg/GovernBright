import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { currentStep, hotp } from "../platform/totp.js";
import { AuthenticationError } from "../services/auth.js";
import { createHarness, databaseUrl, password, type Harness } from "./helpers.js";

describe.skipIf(!databaseUrl)("PostgreSQL integration: password reset and MFA", () => {
  let h: Harness;
  beforeAll(() => { h = createHarness(); });
  afterAll(() => h.close());

  it("resets a password once, signs the user out everywhere, and reveals nothing for unknown emails", async () => {
    const a = await h.organization("Reset");
    const member = await h.addMember(a.owner, "contributor");
    const before = await h.services.auth.login(member.email, password);
    if (before.kind !== "session") throw new Error("expected session");

    await h.services.passwordReset.request(`nobody-${randomUUID()}@example.test`);
    const sentBefore = h.mailer.sent.length;
    await h.services.passwordReset.request(member.email.toUpperCase());
    expect(h.mailer.sent).toHaveLength(sentBefore + 1);
    const mail = h.mailer.sent.at(-1)!;
    expect(mail.to).toBe(member.email);
    const token = /\?reset=([\w-]+)/.exec(mail.text)![1]!;

    const newPassword = "a-brand-new-password-2026";
    await h.services.passwordReset.confirm(token, newPassword);
    await expect(h.services.passwordReset.confirm(token, "another-password-2026")).rejects.toMatchObject({ statusCode: 400 });
    await expect(h.services.auth.resolve(before.token, randomUUID())).rejects.toBeInstanceOf(AuthenticationError);
    await expect(h.services.auth.login(member.email, password)).rejects.toBeInstanceOf(AuthenticationError);
    expect((await h.services.auth.login(member.email, newPassword)).kind).toBe("session");
  });

  it("requires a second factor after enrollment, blocks code replay and accepts a recovery code once", async () => {
    const a = await h.organization("MFA");
    const member = await h.addMember(a.owner, "reviewer");
    const { secret, otpauthUri } = await h.services.mfa.beginEnrollment(member.actor);
    expect(otpauthUri).toContain(`secret=${secret}`);
    await expect(h.services.mfa.confirmEnrollment(member.actor, "000000")).rejects.toMatchObject({ statusCode: 400 });
    const enrollStep = currentStep();
    const { recoveryCodes } = await h.services.mfa.confirmEnrollment(member.actor, hotp(secret, enrollStep));
    expect(recoveryCodes).toHaveLength(10);
    const stored = await h.pool.query("SELECT totp_secret FROM users WHERE id = $1", [member.actor.userId]);
    expect(stored.rows[0].totp_secret).not.toContain(secret);

    const first = await h.services.auth.login(member.email, password);
    expect(first.kind).toBe("mfa");
    if (first.kind !== "mfa") return;
    // The code used to enroll cannot be replayed; the next step's code works.
    await expect(h.services.auth.completeMfa(first.challenge, hotp(secret, enrollStep))).rejects.toBeInstanceOf(AuthenticationError);
    const session = await h.services.auth.completeMfa(first.challenge, hotp(secret, enrollStep + 1));
    expect(session.actor).toMatchObject({ userId: member.actor.userId, mfaEnabled: true });
    await expect(h.services.auth.completeMfa(first.challenge, hotp(secret, enrollStep + 1))).rejects.toBeInstanceOf(AuthenticationError);

    const second = await h.services.auth.login(member.email, password);
    if (second.kind !== "mfa") throw new Error("expected challenge");
    expect((await h.services.auth.completeMfa(second.challenge, recoveryCodes[0]!)).actor.userId).toBe(member.actor.userId);
    const third = await h.services.auth.login(member.email, password);
    if (third.kind !== "mfa") throw new Error("expected challenge");
    await expect(h.services.auth.completeMfa(third.challenge, recoveryCodes[0]!)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("locks a challenge after five wrong codes", async () => {
    const a = await h.organization("Lockout");
    const member = await h.addMember(a.owner, "read_only");
    const { secret } = await h.services.mfa.beginEnrollment(member.actor);
    await h.services.mfa.confirmEnrollment(member.actor, hotp(secret, currentStep()));
    const login = await h.services.auth.login(member.email, password);
    if (login.kind !== "mfa") throw new Error("expected challenge");
    for (let i = 0; i < 5; i++) await expect(h.services.auth.completeMfa(login.challenge, "abcdefabcd")).rejects.toBeInstanceOf(AuthenticationError);
    await expect(h.services.auth.completeMfa(login.challenge, hotp(secret, currentStep() + 1))).rejects.toThrow(/expired/);
  });

  it("holds password users at MFA setup when their organization requires it", async () => {
    const a = await h.organization("Require MFA");
    const member = await h.addMember(a.owner, "contributor");
    await h.services.organization.update(a.owner, { requireMfa: true });
    const app = await buildApp(h.config, h.services);
    const headers = { origin: h.config.APP_ORIGIN! };
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: { email: member.email, password } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(login.json().user).toMatchObject({ mfaSetupRequired: true });
    const blocked = await app.inject({ method: "GET", url: "/api/v1/tool-requests", headers: { cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("mfa_setup_required");
    const setup = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup", headers: { ...headers, cookie } });
    const secret = setup.json().secret as string;
    const enabled = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/enable", headers: { ...headers, cookie }, payload: { code: hotp(secret, currentStep()) } });
    expect(enabled.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/tool-requests", headers: { cookie } })).statusCode).toBe(200);
    await expect(h.services.mfa.disable(member.actor, password)).rejects.toMatchObject({ statusCode: 403 });
    await app.close();
  });

  it("walks the two-step login over HTTP", async () => {
    const a = await h.organization("MFA HTTP");
    const member = await h.addMember(a.owner, "admin");
    const { secret } = await h.services.mfa.beginEnrollment(member.actor);
    await h.services.mfa.confirmEnrollment(member.actor, hotp(secret, currentStep()));
    const app = await buildApp(h.config, h.services);
    const headers = { origin: h.config.APP_ORIGIN! };
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: { email: member.email, password } });
    expect(login.json()).toMatchObject({ mfaRequired: true });
    expect(login.headers["set-cookie"]).toBeUndefined();
    const verify = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/verify", headers, payload: { challenge: login.json().challenge, code: hotp(secret, currentStep() + 1) } });
    expect(verify.statusCode).toBe(200);
    expect(String(verify.headers["set-cookie"])).toContain("gb_session=");
    const reset = await app.inject({ method: "POST", url: "/api/v1/auth/password-reset", headers, payload: { email: `ghost-${randomUUID()}@example.test` } });
    expect(reset.statusCode).toBe(202);
    await app.close();
  });
});
