import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogFacts } from "../services/catalog.js";
import { createHarness, databaseUrl, type Harness } from "./helpers.js";

describe.skipIf(!databaseUrl)("PostgreSQL integration: AI tool catalog", () => {
  let h: Harness;
  beforeAll(() => { h = createHarness(); });
  afterAll(() => h.close());

  it("ships seeded tools as unreviewed and keys them like tool requests", async () => {
    const catalog = await h.services.catalog.list();
    expect(catalog.length).toBeGreaterThanOrEqual(15);
    const chatgpt = catalog.find(c => c.key === "chatgpt")!;
    expect(chatgpt).toMatchObject({ vendor: "OpenAI" });
    expect(await h.services.catalog.get("chatgpt")).toMatchObject({ key: "chatgpt" });
  });

  it("only accepts reviewed vendor facts with a source and review date", async () => {
    const base = { key: "test-tool-x", name: "Test Tool X", vendor: "Test Vendor", category: "Assistant", website: "https://example.test" };
    expect(() => catalogFacts.parse([{ ...base, trainsOnCustomerData: "no" }])).toThrow(/sourceUrl/);
    const facts = catalogFacts.parse([{ ...base, trainsOnCustomerData: "no", sourceUrl: "https://example.test/privacy", reviewedAt: "2026-09-01", certifications: ["SOC 2 Type II"] }]);
    await h.services.catalog.import(facts);
    expect(await h.services.catalog.get("test-tool-x")).toMatchObject({ trainsOnCustomerData: "no", reviewedAt: "2026-09-01", certifications: ["SOC 2 Type II"] });
    await h.pool.query("DELETE FROM ai_tool_catalog WHERE key = 'test-tool-x'");
  });
});
