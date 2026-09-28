import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiSystems, auditEvents, riskAssessments } from "@/db/schema";
import { handle, readJson, requireAdministrator, requireSameOrigin, viewer } from "@/lib/server/governance";

const questions = ["sensitiveData","customerImpact","automatedDecision","externalAccess","regulatedUse","limitedOversight","lowTransparency","weakIncidentPlan"] as const;
type Tier = "low"|"moderate"|"high"|"prohibited";
type Decision = "approved"|"conditional"|"prohibited";

function calculate(payload: Record<string, unknown>) {
  const weights = { sensitiveData:18, customerImpact:16, automatedDecision:18, externalAccess:10, regulatedUse:16, limitedOversight:10, lowTransparency:6, weakIncidentPlan:6 };
  let score = 0;
  for (const question of questions) if (payload[question] === true) score += weights[question];
  const tier: Tier = score >= 75 ? "prohibited" : score >= 50 ? "high" : score >= 25 ? "moderate" : "low";
  const decision: Decision = tier === "prohibited" ? "prohibited" : tier === "high" ? "conditional" : "approved";
  const controls = ["Named business owner", "Annual inventory review"];
  if (payload.sensitiveData) controls.push("Data minimization and retention controls", "Privacy review");
  if (payload.customerImpact || payload.automatedDecision) controls.push("Human review before consequential decisions", "Customer notice and appeal path");
  if (payload.externalAccess) controls.push("Vendor security and data-processing review");
  if (payload.regulatedUse) controls.push("Legal and regulatory review");
  if (payload.limitedOversight) controls.push("Documented human-oversight procedure");
  if (payload.lowTransparency) controls.push("Model documentation and output traceability");
  if (payload.weakIncidentPlan) controls.push("AI incident response playbook");
  if (score >= 50) controls.push("Quarterly monitoring and executive approval");
  return { score, tier, decision, controls };
}

export async function GET(request: Request, { params }: { params: Promise<{id:string}> }) {
  return handle("load assessment", async () => {
    const actor = await requireAdministrator(viewer(request)), { id } = await params;
    const rows = await getDb().select().from(riskAssessments).where(and(eq(riskAssessments.organizationId, actor.organizationId), eq(riskAssessments.aiSystemId, id))).limit(1);
    return Response.json({ assessment: rows[0] ?? null });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{id:string}> }) {
  return handle("complete assessment", async () => {
    requireSameOrigin(request);
    const v = viewer(request), member = await requireAdministrator(v), actor = { userId: v.userId, organizationId: member.organizationId };
    const { id } = await params, payload = await readJson(request), db = getDb();
    const system = await db.select().from(aiSystems).where(and(eq(aiSystems.id,id),eq(aiSystems.organizationId,actor.organizationId))).limit(1);
    if (!system[0]) return Response.json({ error: "AI system not found" }, { status: 404 });
    for (const question of questions) if (typeof payload[question] !== "boolean") return Response.json({ error: `${question} must be answered` }, { status: 400 });
    const result = calculate(payload), now = new Date().toISOString(), notes = typeof payload.reviewNotes === "string" ? payload.reviewNotes.trim().slice(0,2000) : "";
    const values = { id:randomUUID(), organizationId:actor.organizationId, aiSystemId:id, assessorUserId:actor.userId, responses:JSON.stringify(Object.fromEntries(questions.map(q=>[q,payload[q]]))), score:result.score, calculatedTier:result.tier, decision:result.decision, requiredControls:JSON.stringify(result.controls), reviewNotes:notes, completedAt:now, createdAt:now };
    await db.batch([
      db.insert(riskAssessments).values(values).onConflictDoUpdate({ target:[riskAssessments.organizationId,riskAssessments.aiSystemId], set:{ assessorUserId:values.assessorUserId,responses:values.responses,score:values.score,calculatedTier:values.calculatedTier,decision:values.decision,requiredControls:values.requiredControls,reviewNotes:values.reviewNotes,completedAt:values.completedAt } }),
      db.update(aiSystems).set({ riskTier:result.tier, status:result.decision === "approved" ? "approved" : result.decision === "prohibited" ? "retired" : "under_review", nextReviewAt:new Date(Date.now()+(result.score>=50?90:365)*86400000).toISOString().slice(0,10), updatedAt:now }).where(and(eq(aiSystems.id,id),eq(aiSystems.organizationId,actor.organizationId))),
      db.insert(auditEvents).values({ id:randomUUID(),organizationId:actor.organizationId,actorUserId:actor.userId,action:"risk_assessment.completed",targetType:"ai_system",targetId:id,metadata:JSON.stringify({score:result.score,tier:result.tier,decision:result.decision}),createdAt:now })
    ]);
    return Response.json({ assessment:{ score:result.score,calculatedTier:result.tier,decision:result.decision,requiredControls:result.controls,completedAt:now } });
  });
}
