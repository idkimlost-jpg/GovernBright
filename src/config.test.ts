import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://example.test/governbright" };
const production = { NODE_ENV: "production", APP_ORIGIN: "https://app.example.test", APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };

describe("configuration", () => {
  it("requires APP_ORIGIN in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/APP_ORIGIN/);
  });

  it("requires an encryption key in production and validates its length", () => {
    expect(() => loadConfig({ ...base, ...production, APP_ENCRYPTION_KEY: undefined })).toThrow(/APP_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...base, APP_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 bytes/);
  });

  it("parses the proxy trust setting", () => {
    expect(loadConfig(base).TRUST_PROXY).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: "2" }).TRUST_PROXY).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: "10.0.0.1,10.0.0.2" }).TRUST_PROXY).toBe("10.0.0.1,10.0.0.2");
  });

  it("refuses development authentication in production", () => {
    expect(() => loadConfig({ ...base, ...production, ALLOW_DEV_AUTH: "true" })).toThrow(/ALLOW_DEV_AUTH/);
  });

  it("uses Render's public address when APP_ORIGIN is not set", () => {
    const { APP_ORIGIN: _origin, ...rest } = production;
    expect(loadConfig({ ...base, ...rest, RENDER_EXTERNAL_URL: "https://governbright.onrender.com" }).APP_ORIGIN).toBe("https://governbright.onrender.com");
    expect(loadConfig({ ...base, ...production, RENDER_EXTERNAL_URL: "https://governbright.onrender.com" }).APP_ORIGIN).toBe("https://app.example.test");
  });

  it("ignores quotes and spaces pasted around values", () => {
    const config = loadConfig({ DATABASE_URL: ' "postgresql://user:pw@dpg-abc-a/governbright" ', ...production, APP_ORIGIN: "'https://app.example.test'", APP_ENCRYPTION_KEY: `"${production.APP_ENCRYPTION_KEY}"` });
    expect(config.DATABASE_URL).toBe("postgresql://user:pw@dpg-abc-a/governbright");
    expect(config.APP_ORIGIN).toBe("https://app.example.test");
    expect(config.APP_ENCRYPTION_KEY).toBe(production.APP_ENCRYPTION_KEY);
  });

  it("explains how to fix common mistakes", () => {
    expect(() => loadConfig({ ...base, ...production, APP_ORIGIN: "governbright.onrender.com" })).toThrow(/starting with https:\/\//);
    expect(() => loadConfig({ ...base, ...production, APP_ENCRYPTION_KEY: "a".repeat(64) })).toThrow(/openssl rand -base64 32/);
    expect(() => loadConfig({ ...production, DATABASE_URL: "DATABASE_URL=postgres://x/y" })).toThrow(/postgresql:\/\/user:password@host/);
  });

  it("accepts a complete production configuration", () => {
    expect(loadConfig({ ...base, ...production }).ALLOW_DEV_AUTH).toBe(false);
  });
});
