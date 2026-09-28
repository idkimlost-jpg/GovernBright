import type pg from "pg";
import type { SecretBox } from "./secret-box.js";

export type Notification = { title: string; lines: string[]; link?: string };
type Fetch = typeof fetch;

export const isSlackWebhook = (url: string) => /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/[\w/-]+$/.test(url);

// Posts organization notifications to Slack. Delivery is best effort: failures are logged and
// never break the action that triggered them.
export class Notifier {
  constructor(private readonly pool: pg.Pool, private readonly secrets: SecretBox, private readonly appOrigin: string, private readonly fetchImpl: Fetch = fetch) {}

  async notify(organizationId: string, notification: Notification): Promise<boolean> {
    try {
      const result = await this.pool.query<{ webhook: string | null }>(`SELECT slack_webhook_url AS webhook FROM organizations WHERE id = $1`, [organizationId]);
      const sealed = result.rows[0]?.webhook;
      if (!sealed || !this.secrets.available) return false;
      return await this.post(this.secrets.open(sealed), notification);
    } catch (error) {
      console.warn("Slack notification failed", error instanceof Error ? error.message : error);
      return false;
    }
  }

  async post(webhookUrl: string, notification: Notification): Promise<boolean> {
    if (!isSlackWebhook(webhookUrl)) return false;
    const link = notification.link ? `${this.appOrigin}${notification.link}` : this.appOrigin;
    const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const body = {
      text: notification.title,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${escape(notification.title)}*\n${notification.lines.map(escape).join("\n")}` } },
        { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open GovernBright" }, url: link }] }
      ]
    };
    const response = await this.fetchImpl(webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    return response.ok;
  }
}

// Fire-and-forget helper for services.
export const announce = (notifier: Notifier | undefined, organizationId: string, notification: Notification) => {
  if (notifier) void notifier.notify(organizationId, notification);
};
