import type pg from "pg";
import { z } from "zod";
import { requirePermission } from "../domain/authorization.js";
import { NotFoundError } from "../domain/errors.js";
import type { RequestActor } from "../domain/types.js";
import { withTransaction } from "../db/transaction.js";
import { ScimClient } from "../platform/scim.js";
import type { SecretBox } from "../platform/secret-box.js";
import { recordAudit } from "./audit.js";

type Fetch = typeof fetch;
export const toolKey = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120);
export const provisioningConnectionInput = z.object({
  baseUrl: z.string().trim().url().max(500),
  // Omit to keep the stored token when changing the URL.
  token: z.string().min(1).max(4000).optional()
});
export type ProvisioningConnectionInput = z.infer<typeof provisioningConnectionInput>;

export type ProvisionedAccount = { toolKey: string; userId: string; email: string; displayName: string; status: string; externalId: string | null; lastError: string | null; syncedAt: string | null };

// Keeps seats in connected AI tools in line with GovernBright: an approved tool request creates or
// reactivates the person's account; deactivating a member disables every seat they hold.
// Remote calls run after the database commit; failures are recorded and retried by sync().
export class ProvisioningService {
  constructor(private readonly pool: pg.Pool, private readonly secrets: SecretBox, private readonly allowLoopbackHttp: boolean, private readonly fetchImpl: Fetch = fetch) {}

  async connections(actor: RequestActor): Promise<Array<{ toolKey: string; baseUrl: string; accounts: number; errors: number }>> {
    requirePermission(actor, "member:manage");
    const result = await this.pool.query(`SELECT c.tool_key AS "toolKey", c.base_url AS "baseUrl",
        count(a.user_id)::int AS accounts, count(a.user_id) FILTER (WHERE a.status = 'error')::int AS errors
      FROM provisioning_connections c LEFT JOIN provisioned_accounts a ON a.organization_id = c.organization_id AND a.tool_key = c.tool_key
      WHERE c.organization_id = $1 GROUP BY c.tool_key, c.base_url ORDER BY c.tool_key`, [actor.organizationId]);
    return result.rows;
  }

  async saveConnection(actor: RequestActor, key: string, input: ProvisioningConnectionInput): Promise<void> {
    requirePermission(actor, "member:manage");
    const url = new URL(input.baseUrl);
    const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
    if (url.protocol !== "https:" && !(this.allowLoopbackHttp && loopback)) throw Object.assign(new Error("The SCIM base URL must use https"), { statusCode: 400 });
    await withTransaction(this.pool, async client => {
      const existing = await client.query<{ token: string }>(`SELECT token FROM provisioning_connections WHERE organization_id = $1 AND tool_key = $2`, [actor.organizationId, key]);
      const token = input.token ? this.secrets.seal(input.token) : existing.rows[0]?.token;
      if (!token) throw Object.assign(new Error("A SCIM bearer token is required"), { statusCode: 400 });
      await client.query(`INSERT INTO provisioning_connections (organization_id, tool_key, base_url, token) VALUES ($1,$2,$3,$4)
        ON CONFLICT (organization_id, tool_key) DO UPDATE SET base_url = $3, token = $4, updated_at = now()`, [actor.organizationId, key, input.baseUrl, token]);
      await recordAudit(client, actor, "provisioning.configured", "organization", actor.organizationId, { toolKey: key, baseUrl: input.baseUrl, tokenChanged: !!input.token });
    });
  }

  async deleteConnection(actor: RequestActor, key: string): Promise<void> {
    requirePermission(actor, "member:manage");
    await withTransaction(this.pool, async client => {
      const deleted = await client.query(`DELETE FROM provisioning_connections WHERE organization_id = $1 AND tool_key = $2`, [actor.organizationId, key]);
      if (!deleted.rowCount) throw new NotFoundError("No provisioning connection for that tool");
      await recordAudit(client, actor, "provisioning.removed", "organization", actor.organizationId, { toolKey: key });
    });
  }

  async accounts(actor: RequestActor): Promise<ProvisionedAccount[]> {
    requirePermission(actor, "member:manage");
    const result = await this.pool.query<ProvisionedAccount>(`SELECT a.tool_key AS "toolKey", a.user_id AS "userId", u.email, u.display_name AS "displayName",
        a.status, a.external_id AS "externalId", a.last_error AS "lastError", a.synced_at AS "syncedAt"
      FROM provisioned_accounts a JOIN users u ON u.id = a.user_id WHERE a.organization_id = $1 ORDER BY a.tool_key, lower(u.email)`, [actor.organizationId]);
    return result.rows;
  }

  // Called after a tool request is approved.
  async grant(organizationId: string, key: string, userId: string): Promise<void> {
    const marked = await this.pool.query(`INSERT INTO provisioned_accounts (organization_id, tool_key, user_id, desired_active, status)
      SELECT $1, $2, $3, true, 'pending' WHERE EXISTS (SELECT 1 FROM provisioning_connections WHERE organization_id = $1 AND tool_key = $2)
      ON CONFLICT (organization_id, tool_key, user_id) DO UPDATE SET desired_active = true, status = 'pending'`, [organizationId, key, userId]);
    if (marked.rowCount) await this.syncOne(organizationId, key, userId);
  }

  // Called after a member is deactivated.
  async revokeAll(organizationId: string, userId: string): Promise<void> {
    const marked = await this.pool.query<{ toolKey: string }>(`UPDATE provisioned_accounts SET desired_active = false, status = 'pending'
      WHERE organization_id = $1 AND user_id = $2 AND desired_active RETURNING tool_key AS "toolKey"`, [organizationId, userId]);
    for (const { toolKey: key } of marked.rows) await this.syncOne(organizationId, key, userId);
  }

  // Retries every account that is pending or failed.
  async sync(actor: RequestActor): Promise<{ attempted: number; failed: number }> {
    requirePermission(actor, "member:manage");
    const pending = await this.pool.query<{ toolKey: string; userId: string }>(`SELECT tool_key AS "toolKey", user_id AS "userId" FROM provisioned_accounts
      WHERE organization_id = $1 AND status IN ('pending', 'error')`, [actor.organizationId]);
    let failed = 0;
    for (const row of pending.rows) if (!(await this.syncOne(actor.organizationId, row.toolKey, row.userId))) failed++;
    return { attempted: pending.rows.length, failed };
  }

  private async syncOne(organizationId: string, key: string, userId: string): Promise<boolean> {
    const found = await this.pool.query<{ baseUrl: string; token: string; externalId: string | null; desiredActive: boolean; email: string; displayName: string }>(
      `SELECT c.base_url AS "baseUrl", c.token, a.external_id AS "externalId", a.desired_active AS "desiredActive", u.email, u.display_name AS "displayName"
      FROM provisioned_accounts a JOIN provisioning_connections c USING (organization_id, tool_key) JOIN users u ON u.id = a.user_id
      WHERE a.organization_id = $1 AND a.tool_key = $2 AND a.user_id = $3`, [organizationId, key, userId]);
    const row = found.rows[0];
    if (!row) return true;
    const scim = new ScimClient(row.baseUrl, this.secrets.open(row.token), this.fetchImpl);
    try {
      let externalId = row.externalId;
      if (row.desiredActive) externalId = await scim.ensureActive({ email: row.email, displayName: row.displayName }, externalId);
      else if (externalId) await scim.setActive(externalId, false);
      else externalId = await scim.findByUserName(row.email).then(async id => { if (id) await scim.setActive(id, false); return id; });
      await this.pool.query(`UPDATE provisioned_accounts SET external_id = $4, status = $5, last_error = NULL, synced_at = now()
        WHERE organization_id = $1 AND tool_key = $2 AND user_id = $3`, [organizationId, key, userId, externalId, row.desiredActive ? "active" : "deactivated"]);
      await this.pool.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, target_type, target_id, result, correlation_id, metadata)
        VALUES ($1, NULL, $2, 'user', $3, 'success', gen_random_uuid(), $4)`, [organizationId, row.desiredActive ? "provisioning.granted" : "provisioning.revoked", userId, JSON.stringify({ toolKey: key })]);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.pool.query(`UPDATE provisioned_accounts SET status = 'error', last_error = $4 WHERE organization_id = $1 AND tool_key = $2 AND user_id = $3`,
        [organizationId, key, userId, message.slice(0, 500)]);
      await this.pool.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, target_type, target_id, result, correlation_id, metadata)
        VALUES ($1, NULL, 'provisioning.sync', 'user', $2, 'failure', gen_random_uuid(), $3)`, [organizationId, userId, JSON.stringify({ toolKey: key, error: message.slice(0, 200) })]);
      return false;
    }
  }
}
