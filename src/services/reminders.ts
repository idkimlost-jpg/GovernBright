import type pg from "pg";
import type { Mailer } from "../platform/mailer.js";
import type { Notifier } from "../platform/notifier.js";

const DUE_WITHIN_DAYS = 14;
const STALE_REQUEST_DAYS = 3;

export type Digest = { organizationId: string; organization: string; dueReviews: Array<{ name: string; nextReviewAt: string; overdue: boolean }>; staleRequests: Array<{ toolName: string; requester: string; days: number }> };

// Builds one digest per organization of reviews due soon or overdue and requests waiting on a decision,
// then posts it to Slack and emails owners and admins. Organizations get at most one digest per 20 hours.
export class ReminderService {
  constructor(private readonly pool: pg.Pool, private readonly mailer: Mailer, private readonly notifier: Notifier, private readonly appOrigin: string) {}

  async digests(): Promise<Digest[]> {
    const reviews = await this.pool.query<{ organizationId: string; organization: string; name: string; nextReviewAt: string; overdue: boolean }>(
      `SELECT o.id AS "organizationId", o.name AS organization, s.name, s.next_review_at::text AS "nextReviewAt", s.next_review_at < current_date AS overdue
      FROM ai_systems s JOIN organizations o ON o.id = s.organization_id
      WHERE s.status <> 'retired' AND s.next_review_at <= current_date + $1::int ORDER BY s.next_review_at`, [DUE_WITHIN_DAYS]);
    const requests = await this.pool.query<{ organizationId: string; organization: string; toolName: string; requester: string; days: number }>(
      `SELECT o.id AS "organizationId", o.name AS organization, r.tool_name AS "toolName", u.display_name AS requester,
        extract(day FROM now() - r.requested_at)::int AS days
      FROM tool_requests r JOIN organizations o ON o.id = r.organization_id JOIN users u ON u.id = r.requester_user_id
      WHERE r.status = 'pending' AND r.requested_at < now() - make_interval(days => $1) ORDER BY r.requested_at`, [STALE_REQUEST_DAYS]);
    const byOrg = new Map<string, Digest>();
    const digest = (id: string, name: string) => byOrg.get(id) ?? byOrg.set(id, { organizationId: id, organization: name, dueReviews: [], staleRequests: [] }).get(id)!;
    for (const r of reviews.rows) digest(r.organizationId, r.organization).dueReviews.push({ name: r.name, nextReviewAt: r.nextReviewAt, overdue: r.overdue });
    for (const r of requests.rows) digest(r.organizationId, r.organization).staleRequests.push({ toolName: r.toolName, requester: r.requester, days: r.days });
    return [...byOrg.values()];
  }

  async send(): Promise<{ sent: number }> {
    let sent = 0;
    for (const digest of await this.digests()) {
      const claimed = await this.pool.query(`UPDATE organizations SET last_digest_at = now()
        WHERE id = $1 AND (last_digest_at IS NULL OR last_digest_at < now() - interval '20 hours')`, [digest.organizationId]);
      if (!claimed.rowCount) continue;
      const lines = [
        ...digest.dueReviews.map(r => `• Review ${r.overdue ? "overdue" : "due"}: ${r.name} (${r.nextReviewAt})`),
        ...digest.staleRequests.map(r => `• ${r.requester} has waited ${r.days} days for a decision on ${r.toolName}`)
      ];
      const title = `GovernBright reminders for ${digest.organization}`;
      await this.notifier.notify(digest.organizationId, { title, lines, link: "/" });
      const recipients = await this.pool.query<{ email: string }>(`SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND m.active AND m.role IN ('owner', 'admin')`, [digest.organizationId]);
      for (const { email } of recipients.rows) {
        await this.mailer.send({ to: email, subject: title, text: `${lines.join("\n")}\n\nOpen GovernBright: ${this.appOrigin}/` }).catch(error => console.warn(`Reminder email to ${email} failed`, error));
      }
      sent++;
    }
    return { sent };
  }
}
