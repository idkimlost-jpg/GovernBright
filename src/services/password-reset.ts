import type pg from "pg";
import { withTransaction } from "../db/transaction.js";
import type { Mailer } from "../platform/mailer.js";
import { hashPassword, newToken, tokenHash } from "./auth.js";

const RESET_TTL_MS = 60 * 60 * 1000;

export class PasswordResetService {
  constructor(private readonly pool: pg.Pool, private readonly mailer: Mailer, private readonly appOrigin: string) {}

  // Always resolves the same way so the response never reveals whether an account exists.
  async request(email: string): Promise<void> {
    const result = await this.pool.query<{ id: string; email: string }>(
      `SELECT u.id, u.email FROM users u
      WHERE lower(u.email) = lower($1) AND u.password_hash IS NOT NULL
        AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.active = true)`, [email]);
    const user = result.rows[0];
    if (!user) return;
    const token = newToken();
    await this.pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1 OR expires_at <= now()`, [user.id]);
    await this.pool.query(`INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`,
      [tokenHash(token), user.id, new Date(Date.now() + RESET_TTL_MS)]);
    await this.mailer.send({
      to: user.email,
      subject: "Reset your GovernBright password",
      text: `Someone asked to reset the password for this GovernBright account.\n\nChoose a new password here (the link works once, for one hour):\n${this.appOrigin}/?reset=${token}\n\nIf this wasn't you, ignore this email; your password stays the same.`
    });
  }

  // Sets the new password, burns the token and signs the user out everywhere.
  async confirm(token: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    await withTransaction(this.pool, async client => {
      const used = await client.query<{ userId: string }>(`UPDATE password_reset_tokens SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id AS "userId"`, [tokenHash(token)]);
      const userId = used.rows[0]?.userId;
      if (!userId) throw Object.assign(new Error("This reset link is invalid or has expired"), { statusCode: 400 });
      await client.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, passwordHash]);
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM password_reset_tokens WHERE user_id = $1 AND token_hash <> $2`, [userId, tokenHash(token)]);
      await client.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, target_type, target_id, result, correlation_id)
        SELECT m.organization_id, $1, 'auth.password_reset', 'user', $1, 'success', gen_random_uuid()
        FROM memberships m WHERE m.user_id = $1 AND m.active = true`, [userId]);
    });
  }
}
