import type pg from "pg";
import { z } from "zod";
import { requirePermission } from "../domain/authorization.js";
import type { RequestActor } from "../domain/types.js";
import { withTransaction } from "../db/transaction.js";
import { isSlackWebhook, type Notifier } from "../platform/notifier.js";
import type { SecretBox } from "../platform/secret-box.js";
import { recordAudit } from "./audit.js";

export const organizationSettingsInput = z.object({
  requireMfa: z.boolean().optional(),
  // A Slack incoming-webhook URL, or null to disconnect Slack.
  slackWebhookUrl: z.string().trim().refine(isSlackWebhook, "Use a Slack incoming webhook URL (https://hooks.slack.com/...)").nullable().optional()
});
export type OrganizationSettingsInput = z.infer<typeof organizationSettingsInput>;

export type OrganizationSettings = { id: string; name: string; requireMfa: boolean; slackConfigured: boolean };

export class OrganizationService {
  constructor(private readonly pool: pg.Pool, private readonly secrets?: SecretBox, private readonly notifier?: Notifier) {}

  async get(actor: RequestActor): Promise<OrganizationSettings> {
    requirePermission(actor, "member:manage");
    const result = await this.pool.query<OrganizationSettings>(`SELECT id, name, require_mfa AS "requireMfa", (slack_webhook_url IS NOT NULL) AS "slackConfigured"
      FROM organizations WHERE id = $1`, [actor.organizationId]);
    return result.rows[0]!;
  }

  async update(actor: RequestActor, rawInput: OrganizationSettingsInput): Promise<OrganizationSettings> {
    requirePermission(actor, "member:manage");
    const input = organizationSettingsInput.parse(rawInput);
    const sealedWebhook = input.slackWebhookUrl ? this.requireSecrets().seal(input.slackWebhookUrl) : null;
    await withTransaction(this.pool, async client => {
      if (input.requireMfa !== undefined) await client.query(`UPDATE organizations SET require_mfa = $2 WHERE id = $1`, [actor.organizationId, input.requireMfa]);
      if (input.slackWebhookUrl !== undefined) await client.query(`UPDATE organizations SET slack_webhook_url = $2 WHERE id = $1`, [actor.organizationId, sealedWebhook]);
      await recordAudit(client, actor, "organization.settings_updated", "organization", actor.organizationId,
        { ...(input.requireMfa !== undefined ? { requireMfa: input.requireMfa } : {}), ...(input.slackWebhookUrl !== undefined ? { slack: input.slackWebhookUrl ? "connected" : "disconnected" } : {}) });
    });
    return this.get(actor);
  }

  async testSlack(actor: RequestActor): Promise<{ delivered: boolean }> {
    requirePermission(actor, "member:manage");
    const delivered = await this.notifier?.notify(actor.organizationId, { title: "GovernBright is connected", lines: ["Tool requests, decisions, policy updates and review reminders will appear here."] }) ?? false;
    return { delivered };
  }

  private requireSecrets(): SecretBox {
    if (!this.secrets?.available) throw Object.assign(new Error("Integrations need APP_ENCRYPTION_KEY to be configured"), { statusCode: 503 });
    return this.secrets;
  }
}
