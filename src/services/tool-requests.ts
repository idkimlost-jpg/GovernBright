import type pg from "pg";
import { z } from "zod";
import { can, requirePermission } from "../domain/authorization.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type { RequestActor, ToolRequest } from "../domain/types.js";
import { withTransaction } from "../db/transaction.js";
import { recordAudit } from "./audit.js";
import type { PolicyService } from "./policies.js";
import { announce, type Notifier } from "../platform/notifier.js";
import type { ProvisioningService } from "./provisioning.js";
import type { Mailer } from "../platform/mailer.js";

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
  constructor(private readonly pool: pg.Pool, private readonly policies?: PolicyService, private readonly notifier?: Notifier, private readonly provisioning?: ProvisioningService,
    private readonly mail?: { mailer: Mailer; appOrigin: string }) {}

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
    const created = await withTransaction(this.pool, async client => {
      await this.policies?.requireAccepted(client, actor);
      const inserted = await client.query<{ id: string }>(`INSERT INTO tool_requests
        (organization_id, requester_user_id, tool_key, tool_name, business_purpose, data_description)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [actor.organizationId, actor.userId, toolKey, input.toolName, input.businessPurpose, input.dataDescription]);
      const id = inserted.rows[0]!.id;
      await recordAudit(client, actor, "tool_request.created", "tool_request", id, { toolName: input.toolName, toolKey });
      const result = await client.query<ToolRequest>(`SELECT ${selectFields} ${fromRequests} WHERE r.id = $1`, [id]);
      return result.rows[0]!;
    });
    announce(this.notifier, actor.organizationId, {
      title: `New AI tool request: ${created.toolName}`,
      lines: [`${created.requesterName} (${created.requesterEmail}) wants to use ${created.toolName}.`, `Purpose: ${created.businessPurpose}`],
      link: "/#requests"
    });
    void this.emailDeciders(created).catch(error => console.warn("New request email failed", error instanceof Error ? error.message : error));
    return created;
  }

  // Emails the organization's active owners and admins, other than the requester, so a request
  // is seen without Slack. Best effort, like Slack: failures never undo the request.
  private async emailDeciders(request: ToolRequest): Promise<void> {
    if (!this.mail) return;
    const recipients = await this.pool.query<{ email: string }>(`SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1 AND m.active AND m.role IN ('owner', 'admin') AND m.user_id <> $2`, [request.organizationId, request.requesterUserId]);
    const text = [
      `${request.requesterName} (${request.requesterEmail}) wants to use ${request.toolName}.`,
      `Purpose: ${request.businessPurpose}`,
      ...(request.dataDescription ? [`Data involved: ${request.dataDescription}`] : []),
      "",
      `Review and decide: ${this.mail.appOrigin}/#requests`
    ].join("\n");
    for (const { email } of recipients.rows) {
      await this.mail.mailer.send({ to: email, subject: `New AI tool request: ${request.toolName}`, text })
        .catch(error => console.warn(`New request email to ${email} failed`, error instanceof Error ? error.message : error));
    }
  }

  async decide(actor: RequestActor, id: string, input: ToolRequestDecision): Promise<ToolRequest> {
    requirePermission(actor, "tool_request:decide");
    const decided = await withTransaction(this.pool, async client => {
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
    announce(this.notifier, actor.organizationId, {
      title: `AI tool request ${decided.status}: ${decided.toolName}`,
      lines: [`${decided.requesterName}'s request for ${decided.toolName} was ${decided.status}.`, ...(decided.decisionNotes ? [`Notes: ${decided.decisionNotes}`] : [])],
      link: "/#requests"
    });
    // An approval grants the seat in the tool when it is connected for provisioning.
    if (decided.status === "approved" && this.provisioning) {
      void this.provisioning.grant(actor.organizationId, decided.toolKey, decided.requesterUserId).catch(error => console.warn("Provisioning failed", error));
    }
    return decided;
  }
}
