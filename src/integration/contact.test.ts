import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { createHarness, databaseUrl, type Harness } from "./helpers.js";

describe.skipIf(!databaseUrl)("PostgreSQL integration: contact form", () => {
  let h: Harness;
  beforeAll(() => { h = createHarness(); });
  afterAll(() => h.close());

  it("stores enquiries, emails them to the contact address and ignores bots", async () => {
    const app = await buildApp(h.config, h.services);
    const send = (payload: object, origin = h.config.APP_ORIGIN!) =>
      app.inject({ method: "POST", url: "/api/v1/contact", headers: { origin }, payload });
    const email = `buyer-${Date.now()}@example.test`;

    const sent = await send({ name: "Dana Buyer", company: "Acme Health", email, message: "We have 400 staff using ChatGPT. Can we see a demo?" });
    expect(sent.statusCode).toBe(204);
    const [stored] = (await h.services.contact.list()).filter(r => r.email === email);
    expect(stored).toMatchObject({ name: "Dana Buyer", company: "Acme Health", message: "We have 400 staff using ChatGPT. Can we see a demo?" });
    await vi.waitFor(() => expect(h.mailer.sent).toContainEqual(expect.objectContaining({
      to: "sales@example.test", subject: "GovernBright enquiry from Dana Buyer (Acme Health)", text: expect.stringContaining(email)
    })));

    const botEmail = `bot-${Date.now()}@example.test`;
    expect((await send({ name: "Bot", email: botEmail, message: "Buy now", website: "https://spam.example" })).statusCode).toBe(204);
    expect((await h.services.contact.list()).some(r => r.email === botEmail)).toBe(false);

    expect((await send({ name: "No email", email: "not-an-email", message: "Hi" })).statusCode).toBe(400);
    expect((await send({ name: "Elsewhere", email, message: "Hi" }, "https://evil.example")).statusCode).toBe(403);
    await app.close();
  });
});
