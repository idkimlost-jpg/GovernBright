import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHarness, databaseUrl, type Harness } from "./helpers.js";

type ScimUser = { id: string; userName: string; active: boolean };

// A SCIM 2.0 service provider that checks the bearer token and keeps users in memory.
async function fakeScim(token: string) {
  const users = new Map<string, ScimUser>();
  const server: FastifyInstance = Fastify();
  server.addContentTypeParser("application/scim+json", { parseAs: "string" }, (_req, body, done) => done(null, JSON.parse(body as string)));
  server.addHook("onRequest", async (request, reply) => { if (request.headers.authorization !== `Bearer ${token}`) return reply.code(401).send({ detail: "bad token" }); });
  server.post("/scim/v2/Users", async (request, reply) => {
    const body = request.body as { userName: string; active: boolean };
    if ([...users.values()].some(u => u.userName === body.userName)) return reply.code(409).send({ detail: "exists" });
    const user = { id: randomUUID(), userName: body.userName, active: body.active };
    users.set(user.id, user);
    return reply.code(201).send(user);
  });
  server.get("/scim/v2/Users", async request => {
    const match = /userName eq "(.+)"/.exec((request.query as { filter?: string }).filter ?? "");
    return { Resources: [...users.values()].filter(u => u.userName === match?.[1]) };
  });
  server.patch("/scim/v2/Users/:id", async (request, reply) => {
    const user = users.get((request.params as { id: string }).id);
    if (!user) return reply.code(404).send({});
    user.active = (request.body as { Operations: Array<{ value: boolean }> }).Operations[0]!.value;
    return user;
  });
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/scim/v2`;
  return { baseUrl, users, close: () => server.close() };
}

describe.skipIf(!databaseUrl)("PostgreSQL integration: SCIM seat provisioning", () => {
  let h: Harness, scim: Awaited<ReturnType<typeof fakeScim>>;
  beforeAll(async () => { h = createHarness(); scim = await fakeScim("scim-token"); });
  afterAll(async () => { await scim.close(); await h.close(); });
  const scimUser = (email: string) => [...scim.users.values()].find(u => u.userName === email);

  it("creates a seat on approval and disables it when the member is deactivated", async () => {
    const a = await h.organization("SCIM");
    const member = await h.addMember(a.owner, "contributor");
    await h.services.provisioning.saveConnection(a.owner, "chatgpt", { baseUrl: scim.baseUrl, token: "scim-token" });
    const stored = await h.pool.query("SELECT token FROM provisioning_connections WHERE organization_id = $1", [a.organizationId]);
    expect(stored.rows[0].token).not.toContain("scim-token");

    const request = await h.services.toolRequests.create(member.actor, { toolName: "ChatGPT Enterprise", businessPurpose: "Drafting", dataDescription: "" });
    await h.services.toolRequests.decide(a.owner, request.id, { decision: "approved", notes: "" });
    await vi.waitFor(() => expect(scimUser(member.email)).toMatchObject({ active: true }));
    await vi.waitFor(async () => expect((await h.services.provisioning.accounts(a.owner))[0]).toMatchObject({ toolKey: "chatgpt", status: "active", email: member.email }));

    await h.services.members.update(a.owner, member.actor.userId, { active: false });
    await vi.waitFor(() => expect(scimUser(member.email)).toMatchObject({ active: false }));
    await vi.waitFor(async () => expect((await h.services.provisioning.accounts(a.owner))[0]).toMatchObject({ status: "deactivated" }));
  });

  it("adopts an existing remote account, records failures and retries them", async () => {
    const a = await h.organization("SCIM retry");
    const member = await h.addMember(a.owner, "reviewer");
    scim.users.set("pre-existing", { id: "pre-existing", userName: member.email, active: false });
    await h.services.provisioning.saveConnection(a.owner, "claude", { baseUrl: scim.baseUrl, token: "wrong-token" });
    const request = await h.services.toolRequests.create(member.actor, { toolName: "Claude", businessPurpose: "Research", dataDescription: "" });
    await h.services.toolRequests.decide(a.owner, request.id, { decision: "approved", notes: "" });
    await vi.waitFor(async () => expect((await h.services.provisioning.accounts(a.owner))[0]).toMatchObject({ status: "error", lastError: expect.stringContaining("401") }));

    await h.services.provisioning.saveConnection(a.owner, "claude", { baseUrl: scim.baseUrl, token: "scim-token" });
    expect(await h.services.provisioning.sync(a.owner)).toEqual({ attempted: 1, failed: 0 });
    expect(scim.users.get("pre-existing")).toMatchObject({ active: true });
    expect((await h.services.provisioning.accounts(a.owner))[0]).toMatchObject({ status: "active", externalId: "pre-existing" });
  });

  it("does nothing for tools without a connection and refuses plain http outside loopback", async () => {
    const a = await h.organization("No SCIM");
    const member = await h.addMember(a.owner, "contributor");
    const request = await h.services.toolRequests.create(member.actor, { toolName: "Gemini", businessPurpose: "Summaries", dataDescription: "" });
    await h.services.toolRequests.decide(a.owner, request.id, { decision: "approved", notes: "" });
    expect(await h.services.provisioning.accounts(a.owner)).toEqual([]);
    await expect(h.services.provisioning.saveConnection(a.owner, "gemini", { baseUrl: "http://scim.example.com/v2", token: "t" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(h.services.provisioning.saveConnection(member.actor, "gemini", { baseUrl: "https://scim.example.com/v2", token: "t" })).rejects.toMatchObject({ statusCode: 403 });
  });
});
