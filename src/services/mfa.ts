import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { RequestActor } from "../domain/types.js";
import { withTransaction } from "../db/transaction.js";
import type { SecretBox } from "../platform/secret-box.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../platform/totp.js";
import { recordAudit } from "./audit.js";
import { AuthenticationError, tokenHash, verifyPassword } from "./auth.js";

const RECOVERY_CODE_COUNT = 10;
const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

export class MfaService {
  constructor(private readonly pool: pg.Pool, private readonly secrets: SecretBox) {}

  // Stores a new (not yet active) seed and returns what the authenticator app needs.
  async beginEnrollment(actor: RequestActor): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.user(actor.userId);
    if (user.enabled) throw badRequest("Two-factor authentication is already on");
    const secret = generateTotpSecret();
    await this.pool.query(`UPDATE users SET totp_secret = $2, totp_last_step = NULL WHERE id = $1`, [actor.userId, this.secrets.seal(secret)]);
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  }

  // Turns MFA on once the user proves their app works; returns one-time recovery codes.
  async confirmEnrollment(actor: RequestActor, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.user(actor.userId);
    if (user.enabled) throw badRequest("Two-factor authentication is already on");
    if (!user.secret) throw badRequest("Start setup first");
    const step = verifyTotp(this.secrets.open(user.secret), code.trim());
    if (step === null) throw badRequest("That code is not valid; check your device's clock and try again");
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomBytes(5).toString("hex"));
    await withTransaction(this.pool, async client => {
      await client.query(`UPDATE users SET totp_enabled_at = now(), totp_last_step = $2 WHERE id = $1`, [actor.userId, step]);
      await client.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [actor.userId]);
      for (const recovery of recoveryCodes) await client.query(`INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1,$2)`, [actor.userId, tokenHash(recovery)]);
      await recordAudit(client, actor, "auth.mfa_enabled", "user", actor.userId);
    });
    return { recoveryCodes };
  }

  async disable(actor: RequestActor, password: string): Promise<void> {
    const user = await this.user(actor.userId);
    if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) throw new AuthenticationError("Password is incorrect");
    const required = await this.pool.query(`SELECT require_mfa FROM organizations WHERE id = $1`, [actor.organizationId]);
    if (required.rows[0]?.require_mfa) throw Object.assign(new Error("Your organization requires two-factor authentication"), { statusCode: 403 });
    await withTransaction(this.pool, async client => {
      await client.query(`UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1`, [actor.userId]);
      await client.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [actor.userId]);
      await recordAudit(client, actor, "auth.mfa_disabled", "user", actor.userId);
    });
  }

  private async user(userId: string) {
    const result = await this.pool.query<{ email: string; secret: string | null; enabled: boolean; passwordHash: string | null }>(
      `SELECT email, totp_secret AS secret, (totp_enabled_at IS NOT NULL) AS enabled, password_hash AS "passwordHash" FROM users WHERE id = $1`, [userId]);
    return result.rows[0]!;
  }
}
