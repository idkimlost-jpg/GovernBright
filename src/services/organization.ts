import type pg from "pg";
import { z } from "zod";
import { requirePermission } from "../domain/authorization.js";
import type { RequestActor } from "../domain/types.js";
import { withTransaction } from "../db/transaction.js";
import { recordAudit } from "./audit.js";

export const organizationSettingsInput = z.object({
  requireMfa: z.boolean().optional()
});
export type OrganizationSettingsInput = z.infer<typeof organizationSettingsInput>;

export type OrganizationSettings = { id: string; name: string; requireMfa: boolean };

export class OrganizationService {
  constructor(private readonly pool: pg.Pool) {}

  async get(actor: RequestActor): Promise<OrganizationSettings> {
    requirePermission(actor, "member:manage");
    const result = await this.pool.query<OrganizationSettings>(`SELECT id, name, require_mfa AS "requireMfa" FROM organizations WHERE id = $1`, [actor.organizationId]);
    return result.rows[0]!;
  }

  async update(actor: RequestActor, input: OrganizationSettingsInput): Promise<OrganizationSettings> {
    requirePermission(actor, "member:manage");
    await withTransaction(this.pool, async client => {
      if (input.requireMfa !== undefined) await client.query(`UPDATE organizations SET require_mfa = $2 WHERE id = $1`, [actor.organizationId, input.requireMfa]);
      await recordAudit(client, actor, "organization.settings_updated", "organization", actor.organizationId, input);
    });
    return this.get(actor);
  }
}
