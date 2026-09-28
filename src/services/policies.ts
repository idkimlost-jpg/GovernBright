import type pg from "pg";
import { z } from "zod";
import { requirePermission } from "../domain/authorization.js";
import { ConflictError } from "../domain/errors.js";
import type { RequestActor } from "../domain/types.js";
import { withTransaction } from "../db/transaction.js";
import { recordAudit } from "./audit.js";
import { announce, type Notifier } from "../platform/notifier.js";

export const policyInput = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(10).max(50000)
});
export type PolicyInput = z.infer<typeof policyInput>;

export type Policy = { id: string; version: number; title: string; body: string; publishedAt: string; publishedBy: string | null };
export type PolicyAcceptanceStatus = { policy: Policy | null; members: Array<{ userId: string; email: string; displayName: string; acceptedAt: string | null }> };

type Queryable = Pick<pg.Pool, "query">;
const policyFields = `p.id, p.version, p.title, p.body, p.published_at AS "publishedAt", u.display_name AS "publishedBy"`;

export class PolicyAcceptanceRequiredError extends ConflictError {
  readonly code = "policy_acceptance_required";
  constructor() { super("Accept your organization's AI use policy before requesting a tool"); }
}

export class PolicyService {
  constructor(private readonly pool: pg.Pool, private readonly notifier?: Notifier) {}

  async current(actor: RequestActor): Promise<{ policy: Policy | null; acceptedAt: string | null }> {
    const policy = await this.currentPolicy(this.pool, actor.organizationId);
    if (!policy) return { policy: null, acceptedAt: null };
    const accepted = await this.pool.query<{ acceptedAt: string }>(`SELECT accepted_at AS "acceptedAt" FROM policy_acceptances WHERE policy_id = $1 AND user_id = $2`, [policy.id, actor.userId]);
    return { policy, acceptedAt: accepted.rows[0]?.acceptedAt ?? null };
  }

  async history(actor: RequestActor): Promise<Omit<Policy, "body">[]> {
    requirePermission(actor, "member:manage");
    const result = await this.pool.query<Omit<Policy, "body">>(`SELECT p.id, p.version, p.title, p.published_at AS "publishedAt", u.display_name AS "publishedBy"
      FROM ai_policies p LEFT JOIN users u ON u.id = p.published_by WHERE p.organization_id = $1 ORDER BY p.version DESC`, [actor.organizationId]);
    return result.rows;
  }

  // Publishing a new version means everyone must accept again.
  async publish(actor: RequestActor, input: PolicyInput): Promise<Policy> {
    requirePermission(actor, "member:manage");
    const policy = await withTransaction(this.pool, async client => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('ai_policies:' || $1))`, [actor.organizationId]);
      const inserted = await client.query<{ id: string; version: number }>(`INSERT INTO ai_policies (organization_id, version, title, body, published_by)
        SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4 FROM ai_policies WHERE organization_id = $1 RETURNING id, version`,
        [actor.organizationId, input.title, input.body, actor.userId]);
      await recordAudit(client, actor, "policy.published", "policy", inserted.rows[0]!.id, { version: inserted.rows[0]!.version, title: input.title });
      return (await this.currentPolicy(client, actor.organizationId))!;
    });
    announce(this.notifier, actor.organizationId, { title: `AI use policy updated: ${policy.title} (v${policy.version})`, lines: ["Everyone needs to review and accept the new version before requesting AI tools."], link: "/#policy" });
    return policy;
  }

  async accept(actor: RequestActor, policyId: string): Promise<{ acceptedAt: string }> {
    return withTransaction(this.pool, async client => {
      const policy = await this.currentPolicy(client, actor.organizationId);
      if (!policy || policy.id !== policyId) throw new ConflictError("That policy is no longer current; review the latest version");
      const result = await client.query<{ acceptedAt: string }>(`INSERT INTO policy_acceptances (policy_id, user_id) VALUES ($1,$2)
        ON CONFLICT (policy_id, user_id) DO UPDATE SET accepted_at = policy_acceptances.accepted_at RETURNING accepted_at AS "acceptedAt"`, [policyId, actor.userId]);
      await recordAudit(client, actor, "policy.accepted", "policy", policyId, { version: policy.version });
      return result.rows[0]!;
    });
  }

  // Who has and hasn't accepted the current version.
  async status(actor: RequestActor): Promise<PolicyAcceptanceStatus> {
    requirePermission(actor, "member:manage");
    const policy = await this.currentPolicy(this.pool, actor.organizationId);
    const members = await this.pool.query<PolicyAcceptanceStatus["members"][number]>(`SELECT u.id AS "userId", u.email, u.display_name AS "displayName", a.accepted_at AS "acceptedAt"
      FROM memberships m JOIN users u ON u.id = m.user_id
      LEFT JOIN policy_acceptances a ON a.user_id = u.id AND a.policy_id = $2
      WHERE m.organization_id = $1 AND m.active ORDER BY a.accepted_at IS NOT NULL, lower(u.email)`, [actor.organizationId, policy?.id ?? null]);
    return { policy, members: members.rows };
  }

  // Throws unless the actor has accepted the current policy (no policy means nothing to accept).
  async requireAccepted(db: Queryable, actor: RequestActor): Promise<void> {
    const result = await db.query<{ pending: boolean }>(`SELECT NOT EXISTS (SELECT 1 FROM policy_acceptances a WHERE a.policy_id = p.id AND a.user_id = $2) AS pending
      FROM ai_policies p WHERE p.organization_id = $1 ORDER BY p.version DESC LIMIT 1`, [actor.organizationId, actor.userId]);
    if (result.rows[0]?.pending) throw new PolicyAcceptanceRequiredError();
  }

  private async currentPolicy(db: Queryable, organizationId: string): Promise<Policy | null> {
    const result = await db.query<Policy>(`SELECT ${policyFields} FROM ai_policies p LEFT JOIN users u ON u.id = p.published_by
      WHERE p.organization_id = $1 ORDER BY p.version DESC LIMIT 1`, [organizationId]);
    return result.rows[0] ?? null;
  }
}
