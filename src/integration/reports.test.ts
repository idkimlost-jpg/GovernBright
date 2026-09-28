import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ForbiddenError } from "../domain/authorization.js";
import { questions } from "../domain/assessment-framework.js";
import { aiSystemInput } from "../services/ai-systems.js";
import { createHarness, databaseUrl, password, type Harness } from "./helpers.js";

const none = Object.fromEntries(questions.map(q => [q.id, false]));

describe.skipIf(!databaseUrl)("PostgreSQL integration: reports", () => {
  let h: Harness;
  beforeAll(() => { h = createHarness(); });
  afterAll(() => h.close());

  it("summarizes inventory, assessments, policy, access and coverage for one organization", async () => {
    const a = await h.organization("Evidence"), other = await h.organization("Other evidence");
    const member = await h.addMember(a.owner, "contributor");
    const system = await h.services.aiSystems.create(a.owner, aiSystemInput.parse({ name: "Chat assistant", purpose: "Support", vendor: "V", ownerName: "Ops", riskTier: "low" }));
    await h.services.aiSystems.create(a.owner, aiSystemInput.parse({ name: "Old model", purpose: "Legacy", vendor: "V", ownerName: "Ops", riskTier: "moderate", nextReviewAt: "2020-01-01" }));
    await h.services.aiSystems.create(other.owner, aiSystemInput.parse({ name: "Not mine", purpose: "Other org", vendor: "V", ownerName: "Ops", riskTier: "low" }));
    await h.services.assessments.assess(a.owner, system.id, { responses: { ...none, externalAccess: true }, reviewNotes: "" });
    const policy = await h.services.policies.publish(a.owner, { title: "AI use", body: "Keep customer data out." });
    await h.services.policies.accept(member.actor, policy.id);
    await h.services.toolRequests.create(member.actor, { toolName: "Copilot", businessPurpose: "Code", dataDescription: "" });

    await expect(h.services.reports.evidence(member.actor)).rejects.toBeInstanceOf(ForbiddenError);
    const report = await h.services.reports.evidence(a.owner);
    expect(report.systems).toMatchObject({ total: 2, unassessed: ["Old model"], overdueReviews: [{ name: "Old model", nextReviewAt: "2020-01-01" }] });
    expect(report.assessments).toEqual([expect.objectContaining({ system: "Chat assistant", decision: "approved" })]);
    expect(report.frameworkCoverage).toEqual(expect.arrayContaining([expect.objectContaining({ framework: "GDPR", clause: "Art. 28", systems: 1 })]));
    expect(report.policy).toMatchObject({ version: 1, accepted: 1, members: 2 });
    expect(report.toolRequests).toEqual({ pending: 1 });
    expect(report.access).toMatchObject({ members: 2, mfaEnabled: 0, ssoConfigured: false });
  });

  it("exports the audit log as CSV and HTML over HTTP", async () => {
    const a = await h.organization("Export");
    await h.services.policies.publish(a.owner, { title: "=cmd|' /C calc'!A0", body: "Formula injection attempt in the title." });
    const app = await buildApp(h.config, h.services);
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin: h.config.APP_ORIGIN! }, payload: { email: a.ownerEmail, password } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const csv = await app.inject({ method: "GET", url: "/api/v1/reports/audit.csv", headers: { cookie } });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("attachment");
    const lines = csv.body.trim().split("\r\n");
    expect(lines[0]).toBe("time,actor_email,actor_name,action,target_type,target_id,result,correlation_id,details");
    expect(csv.body).toContain('"policy.published"');
    expect(csv.body).toContain('"auth.login"');
    const html = await app.inject({ method: "GET", url: "/api/v1/reports/evidence.html", headers: { cookie } });
    expect(html.body).toContain("AI governance evidence report");
    expect(html.body).not.toContain("<script");
    await app.close();
  });
});
