import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type pg from "pg";
import type { Role, RequestActor } from "../domain/types.js";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

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

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export type AuthenticatedSession = RequestActor & { email: string; displayName: string; organizationName: string };

export class AuthService {
  constructor(private readonly pool: pg.Pool, private readonly ttlHours: number) {}

  async login(email: string, password: string, organizationId?: string): Promise<{ token: string; actor: AuthenticatedSession }> {
    const result = await this.pool.query<{
      userId: string; email: string; displayName: string; passwordHash: string | null;
      organizationId: string; organizationName: string; role: Role;
    }>(`SELECT u.id AS "userId", u.email, u.display_name AS "displayName", u.password_hash AS "passwordHash",
        o.id AS "organizationId", o.name AS "organizationName", m.role
      FROM users u
      JOIN memberships m ON m.user_id = u.id AND m.active = true
      JOIN organizations o ON o.id = m.organization_id
      WHERE lower(u.email) = lower($1) AND ($2::uuid IS NULL OR o.id = $2)
      ORDER BY m.created_at ASC LIMIT 1`, [email, organizationId ?? null]);
    const row = result.rows[0];
    const valid = await verifyPassword(password, row?.passwordHash ?? await dummyHash);
    if (!row?.passwordHash || !valid) throw new AuthenticationError();

    await this.pool.query(`DELETE FROM sessions WHERE expires_at <= now()`);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.ttlHours * 60 * 60 * 1000);
    await this.pool.query(`INSERT INTO sessions (token_hash, user_id, organization_id, expires_at)
      VALUES ($1,$2,$3,$4)`, [tokenHash(token), row.userId, row.organizationId, expiresAt]);
    const correlationId = randomUUID();
    await this.pool.query(`INSERT INTO audit_events
      (organization_id, actor_user_id, action, target_type, target_id, result, correlation_id, metadata)
      VALUES ($1,$2,'auth.login','session',NULL,'success',$3,'{}')`, [row.organizationId, row.userId, correlationId]);
    return { token, actor: { ...row, correlationId } };
  }

  async resolve(token: string, correlationId: string): Promise<AuthenticatedSession> {
    const result = await this.pool.query<AuthenticatedSession>(`SELECT u.id AS "userId", u.email,
        u.display_name AS "displayName", o.id AS "organizationId", o.name AS "organizationName", m.role
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
