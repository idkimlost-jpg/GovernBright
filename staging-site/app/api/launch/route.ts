import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { launchEvents, toolRequests } from "@/db/schema";
import { deploymentOrganizationId, handle, membership, requireSameOrigin, viewer } from "@/lib/server/governance";

const destination = "https://chatgpt.com/";

export async function POST(request: Request) {
  return handle("launch ChatGPT", async () => {
    requireSameOrigin(request);
    const v = viewer(request), db = getDb(), now = new Date().toISOString();
    const member = await membership(v);
    const approvedRequest = member
      ? await db.select({ id: toolRequests.id }).from(toolRequests).where(and(
          eq(toolRequests.organizationId, member.organizationId),
          eq(toolRequests.requesterUserId, v.userId),
          eq(toolRequests.toolKey, "chatgpt"),
          eq(toolRequests.status, "approved"))).limit(1)
      : [];
    const allowed = !!member && approvedRequest.length > 0;
    const organizationId = member?.organizationId ?? await deploymentOrganizationId();
    if (organizationId) {
      await db.insert(launchEvents).values({ id: randomUUID(), organizationId, userId: v.userId, email: v.email, destination, result: allowed ? "allowed" : "denied", createdAt: now });
    }
    if (!allowed) return Response.json({ error: "Your ChatGPT request is awaiting administrator approval" }, { status: 403 });
    return Response.json({ url: destination });
  });
}
