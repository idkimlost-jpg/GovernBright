import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type pg from "pg";
import type { Role, RequestActor } from "../domain/types.js";
import type { SecretBox } from "../platform/secret-box.js";
import { verifyTotp } from "../platform/totp.js";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_ATTEMPTS = 5;

export class AuthenticationError extends Error {
  readonly statusCode = 401;
  constructor(message = "Invalid email or password") { super(message); }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, encoded] = stored.split(":");
  if (algorithm !== "scrypt" || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, "hex");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Verified against when no user matches, so unknown emails take as long as wrong passwords.
const dummyHash = hashPassword(randomBytes(32).toString("hex"));

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export type AuthenticatedSession = RequestActor & { email: string; displayName: string; organizationName: string; mfaEnabled: boolean; mfaSetupRequired: boolean };
export type LoginResult =
  | { kind: "session"; token: string; actor: AuthenticatedSession }
  | { kind: "mfa"; challenge: string };

type Queryable = Pick<pg.Pool, "query">;

const sessionSelect = `SELECT u.id AS "userId", u.email, u.display_name AS "displayName",
  o.id AS "organizationId", o.name AS "organizationName", m.role, (u.totp_enabled_at IS NOT NULL) AS "mfaEnabled",
  (o.require_mfa AND u.totp_enabled_at IS NULL AND $3 <> 'sso') AS "mfaSetupRequired"
  FROM users u
  JOIN memberships m ON m.user_id = u.id AND m.active = true
  JOIN organizations o ON o.id = m.organization_id`;

export class AuthService {
  constructor(private readonly pool: pg.Pool, private readonly ttlHours: number, private readonly secrets?: SecretBox) {}

  async login(email: string, password: string, organizationId?: string): Promise<LoginResult> {
    // ssoRequired: this membership's own organization enforces SSO for the email's verified domain
    // (owners keep a password fallback). Other organizations' settings never affect this user.
    const result = await this.pool.query<{ userId: string; organizationId: string; passwordHash: string | null; mfaEnabled: boolean; ssoRequired: boolean }>(
      `SELECT u.id AS "userId", m.organization_id AS "organizationId", u.password_hash AS "passwordHash",
        (u.totp_enabled_at IS NOT NULL) AS "mfaEnabled",
        (m.role <> 'owner' AND EXISTS (SELECT 1 FROM sso_domains d JOIN sso_connections c ON c.organization_id = d.organization_id
          WHERE d.organization_id = m.organization_id AND d.verified_at IS NOT NULL
            AND d.domain = split_part(lower(u.email), '@', 2) AND c.enforce)) AS "ssoRequired"
      FROM users u JOIN memberships m ON m.user_id = u.id AND m.active = true
      WHERE lower(u.email) = lower($1) AND ($2::uuid IS NULL OR m.organization_id = $2)
      ORDER BY m.created_at ASC LIMIT 1`, [email, organizationId ?? null]);
    const row = result.rows[0];
    const valid = await verifyPassword(password, row?.passwordHash ?? await dummyHash);
    if (!row?.passwordHash || !valid) throw new AuthenticationError();
    if (row.ssoRequired) throw Object.assign(new AuthenticationError("Your organization requires single sign-on. Use “Sign in with SSO”."), { statusCode: 403, code: "sso_required" });

    if (row.mfaEnabled) {
      const challenge = newToken();
      await this.pool.query(`INSERT INTO login_challenges (token_hash, user_id, organization_id, expires_at) VALUES ($1,$2,$3,$4)`,
        [tokenHash(challenge), row.userId, row.organizationId, new Date(Date.now() + CHALLENGE_TTL_MS)]);
      return { kind: "mfa", challenge };
    }
    return { kind: "session", ...await this.createSession(row.userId, row.organizationId, "password") };
  }

  // Completes a password login with a 6-digit authenticator code or a one-time recovery code.
  async completeMfa(challenge: string, code: string): Promise<{ token: string; actor: AuthenticatedSession }> {
    const hash = tokenHash(challenge);
    const found = await this.pool.query<{ userId: string; organizationId: string; attempts: number; secret: string | null; lastStep: string | null }>(
      `UPDATE login_challenges c SET attempts = c.attempts + 1
      FROM users u WHERE c.token_hash = $1 AND u.id = c.user_id AND c.expires_at > now() AND c.attempts < $2
      RETURNING c.user_id AS "userId", c.organization_id AS "organizationId", c.attempts, u.totp_secret AS secret, u.totp_last_step AS "lastStep"`,
      [hash, MAX_CHALLENGE_ATTEMPTS]);
    const row = found.rows[0];
    if (!row || !row.secret || !this.secrets) throw new AuthenticationError("Your sign-in expired; start again");

    const normalized = code.replace(/[\s-]/g, "");
    let ok = false;
    if (/^\d{6}$/.test(normalized)) {
      const step = verifyTotp(this.secrets.open(row.secret), normalized);
      if (step !== null && (row.lastStep === null || step > Number(row.lastStep))) {
        const claimed = await this.pool.query(`UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`, [row.userId, step]);
        ok = claimed.rowCount === 1;
      }
    } else {
      const used = await this.pool.query(`UPDATE mfa_recovery_codes SET used_at = now()
        WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`, [row.userId, tokenHash(normalized.toLowerCase())]);
      ok = used.rowCount === 1;
    }
    if (!ok) throw new AuthenticationError("That code is not valid");
    await this.pool.query(`DELETE FROM login_challenges WHERE token_hash = $1`, [hash]);
    return this.createSession(row.userId, row.organizationId, "mfa");
  }

  // Creates a session for an already-authenticated user (password, MFA or SSO).
  async createSession(userId: string, organizationId: string, method: string, db: Queryable = this.pool): Promise<{ token: string; actor: AuthenticatedSession }> {
    await db.query(`DELETE FROM sessions WHERE expires_at <= now()`);
    await db.query(`DELETE FROM login_challenges WHERE expires_at <= now()`);
    const token = newToken();
    const expiresAt = new Date(Date.now() + this.ttlHours * 60 * 60 * 1000);
    await db.query(`INSERT INTO sessions (token_hash, user_id, organization_id, expires_at, auth_method) VALUES ($1,$2,$3,$4,$5)`,
      [tokenHash(token), userId, organizationId, expiresAt, method]);
    const correlationId = randomUUID();
    await db.query(`INSERT INTO audit_events
      (organization_id, actor_user_id, action, target_type, target_id, result, correlation_id, metadata)
      VALUES ($1,$2,'auth.login','session',NULL,'success',$3,$4)`, [organizationId, userId, correlationId, JSON.stringify({ method })]);
    const actor = await db.query<AuthenticatedSession>(`${sessionSelect} WHERE u.id = $1 AND o.id = $2`, [userId, organizationId, method]);
    if (!actor.rows[0]) throw new AuthenticationError();
    return { token, actor: { ...actor.rows[0], correlationId } };
  }

  async resolve(token: string, correlationId: string): Promise<AuthenticatedSession> {
    const result = await this.pool.query<AuthenticatedSession>(`SELECT u.id AS "userId", u.email,
        u.display_name AS "displayName", o.id AS "organizationId", o.name AS "organizationName", m.role,
        (u.totp_enabled_at IS NOT NULL) AS "mfaEnabled",
        (o.require_mfa AND u.totp_enabled_at IS NULL AND s.auth_method <> 'sso') AS "mfaSetupRequired"
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN organizations o ON o.id = s.organization_id
      JOIN memberships m ON m.user_id = s.user_id AND m.organization_id = s.organization_id AND m.active = true
      WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token)]);
    const row = result.rows[0];
    if (!row) throw new AuthenticationError("Your session is invalid or has expired");
    await this.pool.query(`UPDATE sessions SET last_seen_at = now()
      WHERE token_hash = $1 AND last_seen_at < now() - interval '5 minutes'`, [tokenHash(token)]);
    return { ...row, correlationId };
  }

  async logout(token: string): Promise<void> {
    await this.pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash(token)]);
  }
}
