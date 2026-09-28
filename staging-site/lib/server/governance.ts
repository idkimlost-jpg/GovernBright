import { env } from "cloudflare:workers";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { approvedUsers } from "@/db/schema";

// Identity comes from headers injected by the Sites dispatch layer. They are only
// trustworthy while the Site is served exclusively through that layer (see STAGING.md).
const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";

export type Viewer = { userId: string; email: string };
export type Member = typeof approvedUsers.$inferSelect & { userId: string };

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function viewer(request: Request): Viewer {
  const userId = request.headers.get(USER_ID_HEADER)?.trim();
  const email = request.headers.get(USER_EMAIL_HEADER)?.trim().toLowerCase();
  if (!userId || !email) throw new HttpError(401, "Authentication required");
  return { userId, email };
}

// Blocks cross-site form posts: a JSON content type forces a CORS preflight, which
// this app never answers, and Fetch Metadata rejects cross-site browser requests outright.
export function requireSameOrigin(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site requests are not allowed");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Requests must be sent as JSON");
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new HttpError(400, "Request body must be valid JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Request body must be a JSON object");
  return body as Record<string, unknown>;
}

export function text(body: Record<string, unknown>, key: string, max: number): string {
  const value = body[key];
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// The approved membership for this viewer, or null. A membership row is bound to the
// first platform user ID that signs in with its email; a different account presenting
// the same email later is not treated as that member.
export async function membership(v: Viewer): Promise<Member | null> {
  const db = getDb();
  const rows = await db.select().from(approvedUsers)
    .where(and(eq(approvedUsers.email, v.email), eq(approvedUsers.status, "approved")))
    .orderBy(asc(approvedUsers.approvedAt)).limit(1);
  const row = rows[0] ?? await bootstrapAdministrator(v);
  if (!row) return null;
  if (row.userId && row.userId !== v.userId) return null;
  if (!row.userId) {
    await db.update(approvedUsers).set({ userId: v.userId, updatedAt: new Date().toISOString() })
      .where(and(eq(approvedUsers.id, row.id), eq(approvedUsers.status, "approved")));
  }
  return { ...row, userId: v.userId };
}

export async function requireAdministrator(v: Viewer): Promise<Member> {
  const member = await membership(v);
  if (!member || member.role !== "admin") throw new HttpError(403, "Administrator approval required");
  return member;
}

// This staging Site is single-tenant: its organization is the one the first administrator
// created. Visitors without a membership file their requests there.
export async function deploymentOrganizationId(): Promise<string | null> {
  const rows = await getDb().select({ organizationId: approvedUsers.organizationId }).from(approvedUsers)
    .where(eq(approvedUsers.role, "admin")).orderBy(asc(approvedUsers.approvedAt)).limit(1);
  return rows[0]?.organizationId ?? null;
}

// Only the email named in GOVERNBRIGHT_BOOTSTRAP_ADMIN_EMAIL may claim an empty Site.
async function bootstrapAdministrator(v: Viewer): Promise<typeof approvedUsers.$inferSelect | null> {
  const configured = (env as unknown as Record<string, unknown>).GOVERNBRIGHT_BOOTSTRAP_ADMIN_EMAIL;
  const bootstrapEmail = typeof configured === "string" ? configured.trim().toLowerCase() : "";
  if (!bootstrapEmail || bootstrapEmail !== v.email) return null;
  const db = getDb();
  if (await deploymentOrganizationId()) return null;
  const now = new Date().toISOString();
  // The organization ID is derived from the bootstrap user, so concurrent first
  // requests collide on the (organization, email) unique index instead of racing.
  await db.insert(approvedUsers).values({ id: crypto.randomUUID(), organizationId: v.userId, email: v.email, userId: v.userId, displayName: v.email, role: "admin", status: "approved", approvedBy: v.userId, approvedAt: now, updatedAt: now }).onConflictDoNothing();
  const rows = await db.select().from(approvedUsers).where(and(eq(approvedUsers.organizationId, v.userId), eq(approvedUsers.email, v.email))).limit(1);
  return rows[0] ?? null;
}

export async function handle(label: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    console.error(`${label} failed`, error);
    return Response.json({ error: `Unable to ${label}` }, { status: 500 });
  }
}

export const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

export function toolKeyFor(toolName: string): string {
  const slug = toolName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug === "chatgpt" || slug.startsWith("chatgpt-") ? "chatgpt" : slug;
}
