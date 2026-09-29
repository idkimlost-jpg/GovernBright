import type pg from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePermission } from "../domain/authorization.js";
import type { AiSystem, RequestActor } from "../domain/types.js";

export const aiSystemInput = z.object({
  name: z.string().trim().min(2).max(200),
  purpose: z.string().trim().min(2).max(5000),
  vendor: z.string().trim().min(1).max(200),
  ownerName: z.string().trim().min(1).max(200),
  riskTier: z.enum(["low", "moderate", "high", "prohibited"]),
  status: z.enum(["draft", "under_review", "approved", "retired"]).default("draft"),
  nextReviewAt: z.iso.date().nullable().default(null)
});
export type AiSystemInput = z.infer<typeof aiSystemInput>;

const selectFields = `id, organization_id AS "organizationId", name, purpose, vendor,
 owner_name AS "ownerName", risk_tier AS "riskTier", status,
 next_review_at::text AS "nextReviewAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

export class AiSystemService {
  constructor(private readonly pool: pg.Pool) {}

  async list(actor: RequestActor): Promise<AiSystem[]> {
    requirePermission(actor, "ai_system:read");
    const result = await this.pool.query<AiSystem>(`SELECT ${selectFields} FROM ai_systems WHERE organization_id = $1 ORDER BY updated_at DESC`, [actor.organizationId]);
    return result.rows;
  }

  async get(actor: RequestActor, id: string): Promise<AiSystem | null> {
    requirePermission(actor, "ai_system:read");
    const result = await this.pool.query<AiSystem>(`SELECT ${selectFields} FROM ai_systems WHERE id = $1 AND organization_id = $2`, [id, actor.organizationId]);
    return result.rows[0] ?? null;
  }

  async create(actor: RequestActor, input: AiSystemInput): Promise<AiSystem> {
    requirePermission(actor, "ai_system:create");
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<AiSystem>(`INSERT INTO ai_systems
        (id, organization_id, name, purpose, vendor, owner_name, risk_tier, status, next_review_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${selectFields}`,
        [id, actor.organizationId, input.name, input.purpose, input.vendor, input.ownerName, input.riskTier, input.status, input.nextReviewAt]);
      await client.query(`INSERT INTO audit_events
        (organization_id, actor_user_id, action, target_type, target_id, result, correlation_id, metadata)
        VALUES ($1,$2,'ai_system.created','ai_system',$3,'success',$4,$5)`,
        [actor.organizationId, actor.userId, id, actor.correlationId, JSON.stringify({ name: input.name, riskTier: input.riskTier })]);
      await client.query("COMMIT");
      return result.rows[0]!;
    } catch (error) {
      await client.query("ROLLBACK");
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        const conflict = new Error("An AI system with this name already exists") as Error & { statusCode: number };
        conflict.statusCode = 409;
        throw conflict;
      }
      throw error;
    } finally { client.release(); }
  }
}
