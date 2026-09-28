import type pg from "pg";
import type { RequestActor } from "../domain/types.js";

export async function recordAudit(db: pg.PoolClient, actor: RequestActor, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
  await db.query(`INSERT INTO audit_events
    (organization_id, actor_user_id, action, target_type, target_id, result, correlation_id, metadata)
    VALUES ($1,$2,$3,$4,$5,'success',$6,$7)`,
    [actor.organizationId, actor.userId, action, targetType, targetId, actor.correlationId, JSON.stringify(metadata)]);
}
