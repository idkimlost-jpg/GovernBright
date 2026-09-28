import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { approvedUsers, auditEvents } from "@/db/schema";
import { handle, membership, readJson, requireAdministrator, requireSameOrigin, text, viewer } from "@/lib/server/governance";

export async function GET(request: Request) {
  return handle("check access", async () => {
    const me = await membership(viewer(request));
    if (!me) return Response.json({ me: null, users: [] });
    const users = me.role === "admin"
      ? await getDb().select().from(approvedUsers).where(eq(approvedUsers.organizationId, me.organizationId)).orderBy(asc(approvedUsers.email))
      : [];
    return Response.json({ me, users });
  });
}

export async function POST(request: Request) {
  return handle("approve employee", async () => {
    requireSameOrigin(request);
    const v = viewer(request);
    const admin = await requireAdministrator(v);
    const body = await readJson(request);
    const email = text(body, "email", 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "A valid employee email is required" }, { status: 400 });
    const displayName = text(body, "displayName", 120) || email;
    const now = new Date().toISOString(), db = getDb();
    await db.batch([
      db.insert(approvedUsers)
        .values({ id: randomUUID(), organizationId: admin.organizationId, email, displayName, role: "employee", status: "approved", approvedBy: v.userId, approvedAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [approvedUsers.organizationId, approvedUsers.email], set: { status: "approved", displayName, approvedBy: v.userId, approvedAt: now, updatedAt: now } }),
      db.insert(auditEvents).values({ id: randomUUID(), organizationId: admin.organizationId, actorUserId: v.userId, action: "user.chatgpt_access_approved", targetType: "user", metadata: JSON.stringify({ email }), createdAt: now })
    ]);
    return Response.json({ approved: true }, { status: 201 });
  });
}
