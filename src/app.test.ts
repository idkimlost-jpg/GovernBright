import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type { Config } from "./config.js";

const config: Config = {
  NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://example.test/governbright",
  ALLOW_DEV_AUTH: false, SESSION_TTL_HOURS: 12, APP_ORIGIN: "http://localhost:3000", MAIL_FROM: "test@example.test", TRUST_PROXY: false, CONTACT_EMAIL: "sales@example.test"
};
const user = {
  userId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222",
  role: "owner", correlationId: "33333333-3333-4333-8333-333333333333", email: "owner@example.test",
  displayName: "Test Owner", organizationName: "GovernBright Demo"
} as const;

describe("authenticated application", () => {
  it("serves the dashboard and establishes an HttpOnly session", async () => {
    const service = { list: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn() };
    const auth = { login: vi.fn().mockResolvedValue({ kind: "session", token: "opaque-token", actor: user }), resolve: vi.fn().mockResolvedValue(user), logout: vi.fn() };
    const app = await buildApp(config, { aiSystems: service, auth, toolRequests: {}, members: {} } as never);
    const page = await app.inject({ method: "GET", url: "/" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("AI system register");
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin: config.APP_ORIGIN }, payload: { email: user.email, password: "a-secure-password" } });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]).toContain("SameSite=Strict");
    await app.close();
  });

  it("blocks a state-changing request from the wrong origin", async () => {
    const app = await buildApp(config, { aiSystems: {}, auth: {}, toolRequests: {}, members: {} } as never);
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin: "https://evil.example" }, payload: { email: user.email, password: "a-secure-password" } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
