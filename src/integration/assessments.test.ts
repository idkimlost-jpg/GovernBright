import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../domain/authorization.js";
import { questions } from "../domain/assessment-framework.js";
import { NotFoundError } from "../domain/errors.js";
import { aiSystemInput } from "../services/ai-systems.js";
import { createHarness, databaseUrl, type Harness } from "./helpers.js";

const none = Object.fromEntries(questions.map(q => [q.id, false]));

describe.skipIf(!databaseUrl)("PostgreSQL integration: risk assessments", () => {
  let h: Harness;
  beforeAll(() => { h = createHarness(); });
  afterAll(() => h.close());

  it("scores a system, updates its status and review date, and keeps history", async () => {
    const a = await h.organization("Assess");
    const reviewer = await h.addMember(a.owner, "reviewer");
    const readOnly = await h.addMember(a.owner, "read_only");
    const system = await h.services.aiSystems.create(a.owner, aiSystemInput.parse({ name: "Resume screener", purpose: "Ranks applicants", vendor: "Acme", ownerName: "HR", riskTier: "low" }));

    await expect(h.services.assessments.assess(readOnly.actor, system.id, { responses: none, reviewNotes: "" })).rejects.toBeInstanceOf(ForbiddenError);
    const high = await h.services.assessments.assess(reviewer.actor, system.id, { responses: { ...none, regulatedUse: true, automatedDecision: true, customerImpact: true }, reviewNotes: "Hiring use" });
    expect(high).toMatchObject({ score: 50, calculatedTier: "high", decision: "conditional", assessorName: "Test reviewer" });
    expect(high.requiredControls.map(c => c.id)).toContain("legal-review");
    let updated = await h.services.aiSystems.get(a.owner, system.id);
    expect(updated).toMatchObject({ riskTier: "high", status: "under_review" });
    const inNinetyDays = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    expect(updated!.nextReviewAt).toBe(inNinetyDays);

    await h.services.assessments.assess(reviewer.actor, system.id, { responses: none, reviewNotes: "Scope reduced" });
    updated = await h.services.aiSystems.get(a.owner, system.id);
    expect(updated).toMatchObject({ riskTier: "low", status: "approved" });
    expect((await h.services.assessments.history(readOnly.actor, system.id)).map(x => x.decision)).toEqual(["approved", "conditional"]);
  });

  it("retires prohibited systems and keeps assessments inside the organization", async () => {
    const a = await h.organization("Prohibited"), b = await h.organization("Elsewhere");
    const system = await h.services.aiSystems.create(a.owner, aiSystemInput.parse({ name: "Mood tracker", purpose: "Emotion recognition of staff", vendor: "X", ownerName: "Ops", riskTier: "low" }));
    await expect(h.services.assessments.assess(b.owner, system.id, { responses: none, reviewNotes: "" })).rejects.toBeInstanceOf(NotFoundError);
    const result = await h.services.assessments.assess(a.owner, system.id, { responses: { ...none, prohibitedPractice: true }, reviewNotes: "" });
    expect(result.decision).toBe("prohibited");
    expect((await h.services.aiSystems.get(a.owner, system.id))!.status).toBe("retired");
    expect(await h.services.assessments.history(b.owner, system.id)).toEqual([]);
  });
});
