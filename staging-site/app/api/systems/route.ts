import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiSystems, auditEvents, riskAssessments } from "@/db/schema";
import { handle, isIsoDate, readJson, requireAdministrator, requireSameOrigin, text, viewer } from "@/lib/server/governance";

const riskTiers = ["low", "moderate", "high", "prohibited"] as const;
// Systems reach "approved" only through a completed risk assessment.
const creatableStatuses = ["draft", "under_review"] as const;

export async function GET(request: Request) {
  return handle("load systems", async () => {
    const admin = await requireAdministrator(viewer(request)), db = getDb();
    const rows = await db.select().from(aiSystems).where(eq(aiSystems.organizationId, admin.organizationId)).orderBy(desc(aiSystems.updatedAt));
    const assessments = await db.select().from(riskAssessments).where(eq(riskAssessments.organizationId, admin.organizationId));
    const bySystem = new Map(assessments.map(x => [x.aiSystemId, x]));
    return Response.json({ systems: rows.map(x => ({ ...x, assessment: bySystem.get(x.id) ?? null })) });
  });
}

export async function POST(request: Request) {
  return handle("save system", async () => {
    requireSameOrigin(request);
    const v = viewer(request);
    const admin = await requireAdministrator(v);
    const body = await readJson(request);
    const fields = { name: text(body, "name", 200), purpose: text(body, "purpose", 5000), vendor: text(body, "vendor", 200), ownerName: text(body, "ownerName", 200) };
    for (const [key, value] of Object.entries(fields)) if (!value) return Response.json({ error: `${key} is required` }, { status: 400 });
    const riskTier = riskTiers.find(x => x === body.riskTier);
    if (!riskTier) return Response.json({ error: "Invalid risk tier" }, { status: 400 });
    const status = creatableStatuses.find(x => x === body.status);
    if (!status) return Response.json({ error: "Status must be draft or under review; approval requires a risk assessment" }, { status: 400 });
    const nextReviewAt = text(body, "nextReviewAt", 10) || null;
    if (nextReviewAt && !isIsoDate(nextReviewAt)) return Response.json({ error: "Next review date must be YYYY-MM-DD" }, { status: 400 });
    const id = randomUUID(), now = new Date().toISOString(), db = getDb();
    await db.batch([
      db.insert(aiSystems).values({ id, organizationId: admin.organizationId, ...fields, riskTier, status, nextReviewAt, createdAt: now, updatedAt: now }),
      db.insert(auditEvents).values({ id: randomUUID(), organizationId: admin.organizationId, actorUserId: v.userId, action: "ai_system.created", targetType: "ai_system", targetId: id, metadata: JSON.stringify({ name: fields.name, riskTier }), createdAt: now })
    ]);
    return Response.json({ id }, { status: 201 });
  });
}
