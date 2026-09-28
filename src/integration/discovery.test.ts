import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../domain/authorization.js";
import { createHarness, databaseUrl, type Harness } from "./helpers.js";

const googleExport = `Event Time,User Email,App Name,Client ID,Scope
2026-09-01T10:00:00Z,ana@example.test,ChatGPT,123.apps,openid email
2026-09-03T11:00:00Z,ben@example.test,ChatGPT,123.apps,openid email
2026-09-02T09:00:00Z,ana@example.test,Claude,456.apps,openid
2026-09-02T09:30:00Z,cam@example.test,Acme Meeting AI,789.apps,calendar
2026-09-02T09:45:00Z,cam@example.test,Zoom,000.apps,calendar
`;
const expenses = `Transaction Date,Cardholder,Merchant,Amount
2026-08-15,dee@example.test,OPENAI *CHATGPT SUBSCR,"$25.00"
2026-08-20,dee@example.test,MIDJOURNEY INC.,$30.00
2026-08-21,dee@example.test,STAPLES,$12.00
`;

describe.skipIf(!databaseUrl)("PostgreSQL integration: shadow AI discovery", () => {
  let h: Harness;
  beforeAll(() => { h = createHarness(); });
  afterAll(() => h.close());

  it("finds AI tools in sign-in and expense exports and merges repeat imports", async () => {
    const a = await h.organization("Discovery");
    const member = await h.addMember(a.owner, "contributor");
    await expect(h.services.discovery.import(member.actor, { source: "google_workspace", csv: googleExport })).rejects.toBeInstanceOf(ForbiddenError);

    const first = await h.services.discovery.import(a.owner, { source: "google_workspace", csv: googleExport });
    expect(first).toMatchObject({ rows: 5, matchedRows: 4 });
    expect(first.tools.map(t => t.toolKey).sort()).toEqual(["acme-meeting-ai", "chatgpt", "claude"]);
    await h.services.discovery.import(a.owner, { source: "expenses", csv: expenses });

    const tools = await h.services.discovery.list(a.owner);
    const chatgpt = tools.find(t => t.toolKey === "chatgpt")!;
    expect(chatgpt).toMatchObject({ recognized: true, vendor: "OpenAI", eventCount: 3, spendCents: 2500, firstSeen: "2026-08-15", lastSeen: "2026-09-03" });
    expect(chatgpt.sources.sort()).toEqual(["expenses", "google_workspace"]);
    expect(chatgpt.users.sort()).toEqual(["ana@example.test", "ben@example.test", "dee@example.test"]);
    expect(tools.find(t => t.toolKey === "acme-meeting-ai")).toMatchObject({ recognized: false, status: "new" });
    expect(tools.map(t => t.toolKey)).toContain("midjourney");
    expect(tools.map(t => t.toolKey)).not.toContain("zoom");
  });

  it("registers a discovered tool as a draft system once, and can ignore and restore", async () => {
    const a = await h.organization("Register"), b = await h.organization("Other discovery");
    await h.services.discovery.import(a.owner, { source: "google_workspace", csv: googleExport });
    const { aiSystemId } = await h.services.discovery.register(a.owner, "claude");
    expect(await h.services.discovery.register(a.owner, "claude")).toEqual({ aiSystemId });
    expect(await h.services.aiSystems.get(a.owner, aiSystemId)).toMatchObject({ name: "Claude", vendor: "Anthropic", status: "draft" });
    await h.services.discovery.setIgnored(a.owner, "acme-meeting-ai", true);
    let tools = await h.services.discovery.list(a.owner);
    expect(tools.find(t => t.toolKey === "claude")?.status).toBe("registered");
    expect(tools.find(t => t.toolKey === "acme-meeting-ai")?.status).toBe("ignored");
    await h.services.discovery.setIgnored(a.owner, "acme-meeting-ai", false);
    tools = await h.services.discovery.list(a.owner);
    expect(tools.find(t => t.toolKey === "acme-meeting-ai")?.status).toBe("new");
    expect(await h.services.discovery.list(b.owner)).toEqual([]);
    await expect(h.services.discovery.register(b.owner, "claude")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects files without an app or merchant column", async () => {
    const a = await h.organization("Bad file");
    await expect(h.services.discovery.import(a.owner, { source: "other", csv: "foo,bar\n1,2\n" })).rejects.toMatchObject({ statusCode: 400 });
  });
});
