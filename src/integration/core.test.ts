import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ForbiddenError } from "../domain/authorization.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import { aiSystemInput } from "../services/ai-systems.js";
import { AuthenticationError } from "../services/auth.js";
import { createHarness, databaseUrl, password, type Harness } from "./helpers.js";

describe.skipIf(!databaseUrl)("PostgreSQL integration: core", () => {
  let h: Harness;
  beforeAll(() => { h = createHarness(); });
  afterAll(() => h.close());
  const organization = (name: string) => h.organization(name);
  const addMember: Harness["addMember"] = (owner, role) => h.addMember(owner, role);
  const svc = () => h.services;

  it("keeps tool requests inside their organization and requester", async () => {
    const a = await organization("Tenant A"), b = await organization("Tenant B");
    const employee = await addMember(a.owner, "contributor");
    const colleague = await addMember(a.owner, "read_only");
    const request = await svc().toolRequests.create(employee.actor, { toolName: "ChatGPT Enterprise", businessPurpose: "Draft replies", dataDescription: "" });
    expect(request).toMatchObject({ toolKey: "chatgpt", status: "pending", requesterEmail: employee.email });

    expect((await svc().toolRequests.list(employee.actor)).map(r => r.id)).toEqual([request.id]);
    expect(await svc().toolRequests.list(colleague.actor)).toEqual([]);
    expect((await svc().toolRequests.list(a.owner)).map(r => r.id)).toContain(request.id);
    expect((await svc().toolRequests.list(b.owner)).map(r => r.id)).not.toContain(request.id);
    await expect(svc().toolRequests.decide(b.owner, request.id, { decision: "approved", notes: "" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc().toolRequests.decide(employee.actor, request.id, { decision: "approved", notes: "" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("decides a request once and records audit events", async () => {
    const a = await organization("Decisions");
    const employee = await addMember(a.owner, "reviewer");
    const request = await svc().toolRequests.create(employee.actor, { toolName: "Copilot", businessPurpose: "Code review", dataDescription: "Source code" });
    const decided = await svc().toolRequests.decide(a.owner, request.id, { decision: "approved", notes: "Use the enterprise tenant" });
    expect(decided).toMatchObject({ status: "approved", decidedBy: a.owner.userId, decisionNotes: "Use the enterprise tenant" });
    expect(decided.decidedAt).not.toBeNull();
    await expect(svc().toolRequests.decide(a.owner, request.id, { decision: "rejected", notes: "" })).rejects.toBeInstanceOf(ConflictError);
    const audit = await h.pool.query("SELECT action FROM audit_events WHERE target_id = $1 ORDER BY created_at", [request.id]);
    expect(audit.rows.map(r => r.action)).toEqual(["tool_request.created", "tool_request.approved"]);
  });

  it("manages members with owner-only escalation and session revocation", async () => {
    const a = await organization("Members");
    const admin = await addMember(a.owner, "admin");
    const employee = await addMember(admin.actor, "contributor");
    await expect(svc().members.add(admin.actor, { email: employee.email, displayName: "Again", role: "read_only", password })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc().members.add(admin.actor, { email: `x-${randomUUID()}@example.test`, displayName: "Escalate", role: "owner", password })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc().members.update(admin.actor, a.owner.userId, { active: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc().members.update(admin.actor, admin.actor.userId, { role: "owner" })).rejects.toMatchObject({ statusCode: 400 });

    const login = await svc().auth.login(employee.email, password);
    if (login.kind !== "session") throw new Error("expected a session");
    const { token } = login;
    await expect(svc().auth.resolve(token, randomUUID())).resolves.toMatchObject({ role: "contributor" });
    expect(await svc().members.update(admin.actor, employee.actor.userId, { active: false })).toMatchObject({ active: false });
    await expect(svc().auth.resolve(token, randomUUID())).rejects.toBeInstanceOf(AuthenticationError);
    await expect(svc().auth.login(employee.email, password)).rejects.toBeInstanceOf(AuthenticationError);

    const listed = await svc().members.list(admin.actor);
    expect(listed.map(m => m.email).sort()).toEqual([a.ownerEmail, admin.email, employee.email].sort());
  });

  it("reports duplicate AI system names as conflicts", async () => {
    const a = await organization("Systems");
    const input = aiSystemInput.parse({ name: "Support bot", purpose: "Answers tickets", vendor: "Acme", ownerName: "Ops", riskTier: "low" });
    await svc().aiSystems.create(a.owner, input);
    await expect(svc().aiSystems.create(a.owner, input)).rejects.toBeInstanceOf(ConflictError);
  });

  it("serves the request workflow over HTTP", async () => {
    const a = await organization("HTTP");
    const employee = await addMember(a.owner, "read_only");
    const config = h.config;
    const app = await buildApp(config, h.services);
    const headers = { origin: config.APP_ORIGIN! };
    const cookieFor = async (email: string) => {
      const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: { email, password } });
      expect(login.statusCode).toBe(200);
      return String(login.headers["set-cookie"]).split(";")[0]!;
    };
    const employeeCookie = await cookieFor(employee.email), ownerCookie = await cookieFor(a.ownerEmail);

    const created = await app.inject({ method: "POST", url: "/api/v1/tool-requests", headers: { ...headers, cookie: employeeCookie }, payload: { toolName: "ChatGPT", businessPurpose: "Summaries" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const launch = (cookie?: string) => app.inject({ method: "GET", url: `/api/v1/tool-requests/${id}/launch`, headers: cookie ? { cookie } : {} });
    expect((await launch(employeeCookie)).statusCode).toBe(409);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/tool-requests/${id}`, headers: { ...headers, cookie: employeeCookie }, payload: { decision: "approved" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/members", headers: { cookie: employeeCookie } })).statusCode).toBe(403);
    const decided = await app.inject({ method: "PATCH", url: `/api/v1/tool-requests/${id}`, headers: { ...headers, cookie: ownerCookie }, payload: { decision: "approved" } });
    expect(decided.json()).toMatchObject({ status: "approved" });
    const mine = await app.inject({ method: "GET", url: "/api/v1/tool-requests", headers: { cookie: employeeCookie } });
    expect(mine.json()).toEqual([expect.objectContaining({ id, status: "approved" })]);

    // Only the requester launches, and each launch is audited.
    expect((await launch()).statusCode).toBe(401);
    expect((await launch(ownerCookie)).statusCode).toBe(404);
    const launched = await launch(employeeCookie);
    expect(launched.statusCode).toBe(303);
    expect(launched.headers.location).toBe("https://chatgpt.com");
    const audit = await h.pool.query("SELECT actor_user_id, metadata FROM audit_events WHERE target_id = $1 AND action = 'tool_request.launched'", [id]);
    expect(audit.rows).toEqual([{ actor_user_id: employee.actor.userId, metadata: expect.objectContaining({ toolName: "ChatGPT", url: "https://chatgpt.com" }) }]);
    const approval = await h.pool.query("SELECT metadata FROM audit_events WHERE target_id = $1 AND action = 'tool_request.approved'", [id]);
    expect(approval.rows[0].metadata).toMatchObject({ toolName: "ChatGPT" });
    await app.close();
  });

  it("launches only approved tools that have a catalog link", async () => {
    const a = await organization("Launch");
    const b = await organization("Launch other");
    const employee = await addMember(a.owner, "contributor");
    const unlisted = await svc().toolRequests.create(employee.actor, { toolName: "In-house bot", businessPurpose: "Testing", dataDescription: "" });
    await svc().toolRequests.decide(a.owner, unlisted.id, { decision: "approved", notes: "" });
    await expect(svc().toolRequests.launch(employee.actor, unlisted.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc().toolRequests.launch(b.owner, unlisted.id)).rejects.toBeInstanceOf(NotFoundError);
    const rejected = await svc().toolRequests.create(employee.actor, { toolName: "ChatGPT", businessPurpose: "Testing", dataDescription: "" });
    await svc().toolRequests.decide(a.owner, rejected.id, { decision: "rejected", notes: "" });
    await expect(svc().toolRequests.launch(employee.actor, rejected.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
