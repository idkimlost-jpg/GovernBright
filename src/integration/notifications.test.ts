import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Notifier } from "../platform/notifier.js";
import { aiSystemInput } from "../services/ai-systems.js";
import { ReminderService } from "../services/reminders.js";
import { createHarness, databaseUrl, type Harness } from "./helpers.js";

const webhook = "https://hooks.slack.com/services/T000/B000/XXXXXXXX";

describe.skipIf(!databaseUrl)("PostgreSQL integration: Slack notifications and reminders", () => {
  let h: Harness;
  beforeAll(() => { h = createHarness(); });
  afterAll(() => h.close());
  const postsTo = (text: string) => h.outbound.filter(c => c.url === webhook && JSON.stringify(c.body).includes(text));

  it("stores the webhook encrypted and posts requests, decisions and policy updates", async () => {
    const a = await h.organization("Slack");
    const member = await h.addMember(a.owner, "contributor");
    await expect(h.services.organization.update(a.owner, { slackWebhookUrl: "https://evil.example/hook" })).rejects.toThrow();
    const settings = await h.services.organization.update(a.owner, { slackWebhookUrl: webhook });
    expect(settings.slackConfigured).toBe(true);
    const stored = await h.pool.query("SELECT slack_webhook_url FROM organizations WHERE id = $1", [a.organizationId]);
    expect(stored.rows[0].slack_webhook_url).not.toContain("hooks.slack.com");

    const request = await h.services.toolRequests.create(member.actor, { toolName: "Midjourney <b>", businessPurpose: "Marketing images", dataDescription: "" });
    await vi.waitFor(() => expect(postsTo("New AI tool request: Midjourney &lt;b&gt;")).toHaveLength(1));
    await h.services.toolRequests.decide(a.owner, request.id, { decision: "rejected", notes: "Use the approved image tool" });
    await vi.waitFor(() => expect(postsTo("was rejected")).toHaveLength(1));
    await h.services.policies.publish(a.owner, { title: "AI use", body: "New rules for everyone." });
    await vi.waitFor(() => expect(postsTo("AI use policy updated")).toHaveLength(1));
    expect((await h.services.organization.testSlack(a.owner)).delivered).toBe(true);

    await h.services.organization.update(a.owner, { slackWebhookUrl: null });
    expect((await h.services.organization.testSlack(a.owner)).delivered).toBe(false);
  });

  it("sends one reminder digest per organization per day to Slack and admins", async () => {
    const a = await h.organization("Reminders");
    const admin = await h.addMember(a.owner, "admin");
    const member = await h.addMember(a.owner, "contributor");
    await h.services.organization.update(a.owner, { slackWebhookUrl: webhook });
    await h.services.aiSystems.create(a.owner, aiSystemInput.parse({ name: "Overdue bot", purpose: "Old", vendor: "V", ownerName: "Ops", riskTier: "low", nextReviewAt: "2021-01-01" }));
    await h.services.aiSystems.create(a.owner, aiSystemInput.parse({ name: "Future bot", purpose: "New", vendor: "V", ownerName: "Ops", riskTier: "low", nextReviewAt: "2099-01-01" }));
    const stale = await h.services.toolRequests.create(member.actor, { toolName: "Perplexity", businessPurpose: "Research", dataDescription: "" });
    await h.pool.query("UPDATE tool_requests SET requested_at = now() - interval '5 days' WHERE id = $1", [stale.id]);

    const notifier = new Notifier(h.pool, h.secrets, "http://localhost:3000", (async (url: string, init?: RequestInit) => {
      h.outbound.push({ url, method: "POST", body: JSON.parse(String(init?.body)) });
      return new Response("ok");
    }) as typeof fetch);
    const reminders = new ReminderService(h.pool, h.mailer, notifier, "http://localhost:3000");
    const digest = (await reminders.digests()).find(d => d.organizationId === a.organizationId)!;
    expect(digest.dueReviews.map(r => r.name)).toEqual(["Overdue bot"]);
    expect(digest.staleRequests).toEqual([expect.objectContaining({ toolName: "Perplexity", days: 5 })]);

    const mailsBefore = h.mailer.sent.length;
    await reminders.send();
    expect(postsTo(`GovernBright reminders for`).some(c => JSON.stringify(c.body).includes("Overdue bot"))).toBe(true);
    const mails = h.mailer.sent.slice(mailsBefore).filter(m => m.subject.includes(digest.organization));
    expect(mails.map(m => m.to).sort()).toEqual([a.ownerEmail, admin.email].sort());
    await reminders.send();
    expect(h.mailer.sent.filter(m => m.subject.includes(digest.organization))).toHaveLength(2);
  });
});
