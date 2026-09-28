import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { buildApp } from "./app.js";
import type { Config } from "./config.js";
import { createPool } from "./db/pool.js";
import { ForbiddenError } from "./domain/authorization.js";
import { ConflictError, NotFoundError } from "./domain/errors.js";
import type { RequestActor, Role } from "./domain/types.js";
import { AiSystemService, aiSystemInput } from "./services/ai-systems.js";
import { AuthService, AuthenticationError, hashPassword } from "./services/auth.js";
import { MemberService } from "./services/members.js";
import { ToolRequestService } from "./services/tool-requests.js";

// Runs against the migrated PostgreSQL database named by DATABASE_URL (CI provides one).
const databaseUrl = process.env.DATABASE_URL;
const password = "integration-password-2026";

describe.skipIf(!databaseUrl)("PostgreSQL integration", () => {
  let pool: pg.Pool;
  let toolRequests: ToolRequestService, members: MemberService, auth: AuthService, aiSystems: AiSystemService;

  const actor = (organizationId: string, userId: string, role: Role): RequestActor => ({ organizationId, userId, role, correlationId: randomUUID() });
  async function organization(name: string) {
    const organizationId = randomUUID(), userId = randomUUID(), email = `owner-${userId}@example.test`;
    await pool.query("INSERT INTO organizations (id, name) VALUES ($1,$2)", [organizationId, `${name} ${organizationId.slice(0, 8)}`]);
    await pool.query("INSERT INTO users (id, external_subject, email, display_name, password_hash) VALUES ($1,$2,$3,'Owner',$4)", [userId, `local:${email}`, email, await hashPassword(password)]);
    await pool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'owner')", [organizationId, userId]);
    return { organizationId, owner: actor(organizationId, userId, "owner"), ownerEmail: email };
  }
  async function addMember(owner: RequestActor, role: Role) {
    const email = `${role}-${randomUUID()}@example.test`;
    const member = await members.add(owner, { email, displayName: `Test ${role}`, role, password });
    return { email, actor: actor(owner.organizationId, member.userId, role) };
  }

  beforeAll(() => {
    pool = createPool(databaseUrl!);
    toolRequests = new ToolRequestService(pool);
    members = new MemberService(pool);
    auth = new AuthService(pool, 1);
    aiSystems = new AiSystemService(pool);
  });
  afterAll(async () => { await pool.end(); });

  it("keeps tool requests inside their organization and requester", async () => {
    const a = await organization("Tenant A"), b = await organization("Tenant B");
    const employee = await addMember(a.owner, "contributor");
    const colleague = await addMember(a.owner, "read_only");
    const request = await toolRequests.create(employee.actor, { toolName: "ChatGPT Enterprise", businessPurpose: "Draft replies", dataDescription: "" });
    expect(request).toMatchObject({ toolKey: "chatgpt", status: "pending", requesterEmail: employee.email });

    expect((await toolRequests.list(employee.actor)).map(r => r.id)).toEqual([request.id]);
    expect(await toolRequests.list(colleague.actor)).toEqual([]);
    expect((await toolRequests.list(a.owner)).map(r => r.id)).toContain(request.id);
    expect((await toolRequests.list(b.owner)).map(r => r.id)).not.toContain(request.id);
    await expect(toolRequests.decide(b.owner, request.id, { decision: "approved", notes: "" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(toolRequests.decide(employee.actor, request.id, { decision: "approved", notes: "" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("decides a request once and records audit events", async () => {
    const a = await organization("Decisions");
    const employee = await addMember(a.owner, "reviewer");
    const request = await toolRequests.create(employee.actor, { toolName: "Copilot", businessPurpose: "Code review", dataDescription: "Source code" });
    const decided = await toolRequests.decide(a.owner, request.id, { decision: "approved", notes: "Use the enterprise tenant" });
    expect(decided).toMatchObject({ status: "approved", decidedBy: a.owner.userId, decisionNotes: "Use the enterprise tenant" });
    expect(decided.decidedAt).not.toBeNull();
    await expect(toolRequests.decide(a.owner, request.id, { decision: "rejected", notes: "" })).rejects.toBeInstanceOf(ConflictError);
    const audit = await pool.query("SELECT action FROM audit_events WHERE target_id = $1 ORDER BY created_at", [request.id]);
    expect(audit.rows.map(r => r.action)).toEqual(["tool_request.created", "tool_request.approved"]);
  });

  it("manages members with owner-only escalation and session revocation", async () => {
    const a = await organization("Members");
    const admin = await addMember(a.owner, "admin");
    const employee = await addMember(admin.actor, "contributor");
    await expect(members.add(admin.actor, { email: employee.email, displayName: "Again", role: "read_only", password })).rejects.toBeInstanceOf(ConflictError);
    await expect(members.add(admin.actor, { email: `x-${randomUUID()}@example.test`, displayName: "Escalate", role: "owner", password })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(members.update(admin.actor, a.owner.userId, { active: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(members.update(admin.actor, admin.actor.userId, { role: "owner" })).rejects.toMatchObject({ statusCode: 400 });

    const { token } = await auth.login(employee.email, password);
    await expect(auth.resolve(token, randomUUID())).resolves.toMatchObject({ role: "contributor" });
    expect(await members.update(admin.actor, employee.actor.userId, { active: false })).toMatchObject({ active: false });
    await expect(auth.resolve(token, randomUUID())).rejects.toBeInstanceOf(AuthenticationError);
    await expect(auth.login(employee.email, password)).rejects.toBeInstanceOf(AuthenticationError);

    const listed = await members.list(admin.actor);
    expect(listed.map(m => m.email).sort()).toEqual([a.ownerEmail, admin.email, employee.email].sort());
  });

  it("reports duplicate AI system names as conflicts", async () => {
    const a = await organization("Systems");
    const input = aiSystemInput.parse({ name: "Support bot", purpose: "Answers tickets", vendor: "Acme", ownerName: "Ops", riskTier: "low" });
    await aiSystems.create(a.owner, input);
    await expect(aiSystems.create(a.owner, input)).rejects.toBeInstanceOf(ConflictError);
  });

  it("serves the request workflow over HTTP", async () => {
    const a = await organization("HTTP");
    const employee = await addMember(a.owner, "read_only");
    const config: Config = { NODE_ENV: "test", PORT: 3000, DATABASE_URL: databaseUrl!, ALLOW_DEV_AUTH: false, SESSION_TTL_HOURS: 1, APP_ORIGIN: "http://localhost:3000" };
    const app = await buildApp(config, { aiSystems, auth, toolRequests, members });
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
    expect((await app.inject({ method: "PATCH", url: `/api/v1/tool-requests/${id}`, headers: { ...headers, cookie: employeeCookie }, payload: { decision: "approved" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/members", headers: { cookie: employeeCookie } })).statusCode).toBe(403);
    const decided = await app.inject({ method: "PATCH", url: `/api/v1/tool-requests/${id}`, headers: { ...headers, cookie: ownerCookie }, payload: { decision: "approved" } });
    expect(decided.json()).toMatchObject({ status: "approved" });
    const mine = await app.inject({ method: "GET", url: "/api/v1/tool-requests", headers: { cookie: employeeCookie } });
    expect(mine.json()).toEqual([expect.objectContaining({ id, status: "approved" })]);
    await app.close();
  });
});
