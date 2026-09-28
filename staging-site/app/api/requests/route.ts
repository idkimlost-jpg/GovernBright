import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, toolRequests } from "@/db/schema";
import { deploymentOrganizationId, handle, membership, readJson, requireAdministrator, requireSameOrigin, text, toolKeyFor, viewer } from "@/lib/server/governance";

export async function GET(request: Request) {
  return handle("load requests", async () => {
    const v = viewer(request), db = getDb();
    const member = await membership(v);
    const isAdmin = member?.role === "admin";
    const rows = isAdmin
      ? await db.select().from(toolRequests).where(eq(toolRequests.organizationId, member.organizationId)).orderBy(desc(toolRequests.requestedAt))
      : await db.select().from(toolRequests).where(eq(toolRequests.requesterUserId, v.userId)).orderBy(desc(toolRequests.requestedAt));
    return Response.json({ requests: rows, isAdmin });
  });
}

export async function POST(request: Request) {
  return handle("submit request", async () => {
    requireSameOrigin(request);
    const v = viewer(request), body = await readJson(request);
    const toolName = text(body, "toolName", 120), purpose = text(body, "businessPurpose", 2000);
    if (!toolName || !purpose) return Response.json({ error: "Tool name and business purpose are required" }, { status: 400 });
    const toolKey = toolKeyFor(toolName);
    if (!toolKey) return Response.json({ error: "Tool name must contain letters or numbers" }, { status: 400 });
    const organizationId = (await membership(v))?.organizationId ?? await deploymentOrganizationId();
    if (!organizationId) return Response.json({ error: "An administrator must initialize GovernBright first" }, { status: 409 });
    const now = new Date().toISOString(), id = randomUUID(), db = getDb();
    await db.batch([
      db.insert(toolRequests).values({ id, organizationId, requesterUserId: v.userId, requesterEmail: v.email, toolKey, toolName, businessPurpose: purpose, dataDescription: text(body, "dataDescription", 2000), status: "pending", requestedAt: now }),
      db.insert(auditEvents).values({ id: randomUUID(), organizationId, actorUserId: v.userId, action: "ai_tool.requested", targetType: "tool_request", targetId: id, metadata: JSON.stringify({ toolName, email: v.email }), createdAt: now })
    ]);
    return Response.json({ requestId: id, status: "pending" }, { status: 201 });
  });
}

export async function PATCH(request: Request) {
  return handle("decide request", async () => {
    requireSameOrigin(request);
    const v = viewer(request);
    const admin = await requireAdministrator(v);
    const body = await readJson(request);
    const id = text(body, "id", 100), decision = body.decision;
    if (!id || (decision !== "approved" && decision !== "rejected")) return Response.json({ error: "Request and decision are required" }, { status: 400 });
    const db = getDb();
    const existing = await db.select({ status: toolRequests.status }).from(toolRequests)
      .where(and(eq(toolRequests.id, id), eq(toolRequests.organizationId, admin.organizationId))).limit(1);
    if (!existing[0]) return Response.json({ error: "Request not found" }, { status: 404 });
    if (existing[0].status !== "pending") return Response.json({ error: "Request has already been decided" }, { status: 409 });
    const now = new Date().toISOString(), notes = text(body, "notes", 1000);
    const updated = await db.update(toolRequests).set({ status: decision, decidedBy: v.userId, decisionNotes: notes, decidedAt: now })
      .where(and(eq(toolRequests.id, id), eq(toolRequests.organizationId, admin.organizationId), eq(toolRequests.status, "pending")))
      .returning({ id: toolRequests.id });
    if (!updated[0]) return Response.json({ error: "Request has already been decided" }, { status: 409 });
    await db.insert(auditEvents).values({ id: randomUUID(), organizationId: admin.organizationId, actorUserId: v.userId, action: `ai_tool.${decision}`, targetType: "tool_request", targetId: id, metadata: JSON.stringify({ notes }), createdAt: now });
    return Response.json({ updated: true });
  });
}
