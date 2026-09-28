import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://example.test/governbright" };

describe("configuration", () => {
  it("requires APP_ORIGIN in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/APP_ORIGIN/);
  });

  it("refuses development authentication in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", APP_ORIGIN: "https://app.example.test", ALLOW_DEV_AUTH: "true" })).toThrow(/ALLOW_DEV_AUTH/);
  });

  it("accepts a complete production configuration", () => {
    expect(loadConfig({ ...base, NODE_ENV: "production", APP_ORIGIN: "https://app.example.test" }).ALLOW_DEV_AUTH).toBe(false);
  });
});
