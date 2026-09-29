import { describe,expect,it } from "vitest";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://example.test/governbright" };

describe("security configuration", () => {
  it("requires the application origin in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/APP_ORIGIN/);
  });

  it("rejects development authentication on a non-local origin", () => {
    expect(() => loadConfig({ ...base, ALLOW_DEV_AUTH: "true", APP_ORIGIN: "https://staging.example.test" })).toThrow(/localhost/);
  });

  it("allows development authentication only on localhost", () => {
    const config = loadConfig({ ...base, ALLOW_DEV_AUTH: "true", APP_ORIGIN: "http://localhost:3000" });
    expect(config.ALLOW_DEV_AUTH).toBe(true);
  });
});
