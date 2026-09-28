import type pg from "pg";
import { z } from "zod";
import { can, requirePermission } from "../domain/authorization.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type { RequestActor, ToolRequest } from "../domain/types.js";
import { withTransaction } from "../db/transaction.js";
import { recordAudit } from "./audit.js";

export const toolRequestInput = z.object({
  toolName: z.string().trim().min(1).max(120),
  businessPurpose: z.string().trim().min(1).max(2000),
  dataDescription: z.string().trim().max(2000).default("")
});
export type ToolRequestInput = z.infer<typeof toolRequestInput>;

export const toolRequestDecision = z.object({
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().max(1000).default("")
});
export type ToolRequestDecision = z.infer<typeof toolRequestDecision>;

// "ChatGPT", "ChatGPT Enterprise" -> "chatgpt"; other tools get a slug of their name.
export function toolKeyFor(toolName: string): string {
  const slug = toolName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug === "chatgpt" || slug.startsWith("chatgpt-") ? "chatgpt" : slug;
}

const selectFields = `r.id, r.organization_id AS "organizationId", r.requester_user_id AS "requesterUserId",
 u.email AS "requesterEmail", u.display_name AS "requesterName", r.tool_key AS "toolKey", r.tool_name AS "toolName",
 r.business_purpose AS "businessPurpose", r.data_description AS "dataDescription", r.status,
 r.decided_by AS "decidedBy", r.decision_notes AS "decisionNotes", r.requested_at AS "requestedAt", r.decided_at AS "decidedAt"`;
const fromRequests = `FROM tool_requests r JOIN users u ON u.id = r.requester_user_id`;

export class ToolRequestService {
  constructor(private readonly pool: pg.Pool) {}

  // Deciders see every request in their organization; everyone else sees only their own.
  async list(actor: RequestActor): Promise<ToolRequest[]> {
    requirePermission(actor, "tool_request:create");
    const result = can(actor, "tool_request:decide")
      ? await this.pool.query<ToolRequest>(`SELECT ${selectFields} ${fromRequests} WHERE r.organization_id = $1 ORDER BY r.requested_at DESC`, [actor.organizationId])
      : await this.pool.query<ToolRequest>(`SELECT ${selectFields} ${fromRequests} WHERE r.organization_id = $1 AND r.requester_user_id = $2 ORDER BY r.requested_at DESC`, [actor.organizationId, actor.userId]);
    return result.rows;
  }

  async create(actor: RequestActor, input: ToolRequestInput): Promise<ToolRequest> {
    requirePermission(actor, "tool_request:create");
    const toolKey = toolKeyFor(input.toolName);
    if (!toolKey) throw Object.assign(new Error("Tool name must contain letters or numbers"), { statusCode: 400 });
    return withTransaction(this.pool, async client => {
      const inserted = await client.query<{ id: string }>(`INSERT INTO tool_requests
        (organization_id, requester_user_id, tool_key, tool_name, business_purpose, data_description)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [actor.organizationId, actor.userId, toolKey, input.toolName, input.businessPurpose, input.dataDescription]);
      const id = inserted.rows[0]!.id;
      await recordAudit(client, actor, "tool_request.created", "tool_request", id, { toolName: input.toolName, toolKey });
      const result = await client.query<ToolRequest>(`SELECT ${selectFields} ${fromRequests} WHERE r.id = $1`, [id]);
      return result.rows[0]!;
    });
  }

  async decide(actor: RequestActor, id: string, input: ToolRequestDecision): Promise<ToolRequest> {
    requirePermission(actor, "tool_request:decide");
    return withTransaction(this.pool, async client => {
      const updated = await client.query(`UPDATE tool_requests
        SET status = $3, decided_by = $4, decision_notes = $5, decided_at = now()
        WHERE id = $1 AND organization_id = $2 AND status = 'pending' RETURNING id`,
        [id, actor.organizationId, input.decision, actor.userId, input.notes]);
      if (!updated.rowCount) {
        const existing = await client.query(`SELECT 1 FROM tool_requests WHERE id = $1 AND organization_id = $2`, [id, actor.organizationId]);
        if (existing.rowCount) throw new ConflictError("This request has already been decided");
        throw new NotFoundError("Tool request not found");
      }
      await recordAudit(client, actor, `tool_request.${input.decision}`, "tool_request", id, { notes: input.notes });
      const result = await client.query<ToolRequest>(`SELECT ${selectFields} ${fromRequests} WHERE r.id = $1`, [id]);
      return result.rows[0]!;
    });
  }
}
