import { or, eq } from "drizzle-orm";
import { getDb } from "../db";
import { approvedUsers } from "../db/schema";

export class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function viewer(request: Request) {
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!userId || !email) throw new HttpError("Authentication required", 401);
  return { userId, email };
}

export async function accessFor(request: Request) {
  const identity = viewer(request);
  const db = getDb();
  const matches = await db.select().from(approvedUsers)
    .where(or(eq(approvedUsers.userId, identity.userId), eq(approvedUsers.email, identity.email))).limit(1);
  const user = matches[0] ?? null;
  if (user && user.userId !== identity.userId) {
    await db.update(approvedUsers).set({ userId: identity.userId, updatedAt: new Date().toISOString() })
      .where(eq(approvedUsers.id, user.id));
  }
  if (user) return { viewer: identity, user: { ...user, userId: identity.userId }, organizationId: user.organizationId };
  const administrators = await db.select().from(approvedUsers)
    .where(eq(approvedUsers.role, "admin")).limit(1);
  if (!administrators[0]) throw new HttpError("GovernBright has not been initialized by its owner", 503);
  return { viewer: identity, user: null, organizationId: administrators[0].organizationId };
}

export async function requireApproved(request: Request) {
  const access = await accessFor(request);
  if (!access.user || access.user.status !== "approved") throw new HttpError("Approved account required", 403);
  return access as typeof access & { user: NonNullable<typeof access.user> };
}

export async function requireAdmin(request: Request) {
  const access = await requireApproved(request);
  if (access.user.role !== "admin") throw new HttpError("Administrator approval required", 403);
  return access;
}

export function routeError(error: unknown, fallback: string) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}
