import type pg from "pg";
import { z } from "zod";
import { requirePermission } from "../domain/authorization.js";
import { roles, type RequestActor } from "../domain/types.js";
import { withTransaction } from "../db/transaction.js";
import { OidcClient, OidcError, pkceChallenge, randomToken } from "../platform/oidc.js";
import type { SecretBox } from "../platform/secret-box.js";
import { recordAudit } from "./audit.js";
import { tokenHash, type AuthService, type AuthenticatedSession } from "./auth.js";

const STATE_TTL_MS = 10 * 60 * 1000;
const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter domains like example.com");

export const ssoConnectionInput = z.object({
  issuer: z.string().trim().url().max(500).transform(v => v.replace(/\/$/, "")),
  clientId: z.string().trim().min(1).max(500),
  // Omit to keep the stored secret when editing other fields.
  clientSecret: z.string().min(1).max(2000).optional(),
  domains: z.array(domain).min(1).max(20),
  enforce: z.boolean().default(false),
  autoProvisionRole: z.enum(roles).exclude(["owner"]).nullable().default(null)
});
export type SsoConnectionInput = z.infer<typeof ssoConnectionInput>;

export type SsoConnection = { issuer: string; clientId: string; domains: string[]; enforce: boolean; autoProvisionRole: string | null; redirectUri: string };

const emailDomain = (email: string) => email.toLowerCase().split("@")[1] ?? "";
const clientError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export class SsoService {
  constructor(private readonly pool: pg.Pool, private readonly secrets: SecretBox, private readonly auth: AuthService,
    private readonly oidc: OidcClient, private readonly appOrigin: string) {}

  get redirectUri(): string { return `${this.appOrigin}/api/v1/auth/sso/callback`; }

  async getConnection(actor: RequestActor): Promise<SsoConnection | null> {
    requirePermission(actor, "member:manage");
    const result = await this.pool.query<Omit<SsoConnection, "redirectUri">>(`SELECT c.issuer, c.client_id AS "clientId", c.enforce,
        c.auto_provision_role AS "autoProvisionRole", COALESCE(array_agg(d.domain ORDER BY d.domain) FILTER (WHERE d.domain IS NOT NULL), '{}') AS domains
      FROM sso_connections c LEFT JOIN sso_domains d ON d.organization_id = c.organization_id
      WHERE c.organization_id = $1 GROUP BY c.organization_id`, [actor.organizationId]);
    return result.rows[0] ? { ...result.rows[0], redirectUri: this.redirectUri } : null;
  }

  async saveConnection(actor: RequestActor, input: SsoConnectionInput): Promise<SsoConnection> {
    requirePermission(actor, "member:manage");
    await this.oidc.discover(input.issuer).catch(error => { throw clientError(400, `Could not reach the identity provider: ${error.message}`); });
    await withTransaction(this.pool, async client => {
      const existing = await client.query<{ secret: string }>(`SELECT client_secret AS secret FROM sso_connections WHERE organization_id = $1`, [actor.organizationId]);
      const secret = input.clientSecret ? this.secrets.seal(input.clientSecret) : existing.rows[0]?.secret;
      if (!secret) throw clientError(400, "Client secret is required");
      await client.query(`INSERT INTO sso_connections (organization_id, issuer, client_id, client_secret, enforce, auto_provision_role)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (organization_id) DO UPDATE SET issuer = $2, client_id = $3, client_secret = $4, enforce = $5, auto_provision_role = $6, updated_at = now()`,
        [actor.organizationId, input.issuer, input.clientId, secret, input.enforce, input.autoProvisionRole]);
      await client.query(`DELETE FROM sso_domains WHERE organization_id = $1`, [actor.organizationId]);
      for (const d of new Set(input.domains)) {
        const inserted = await client.query(`INSERT INTO sso_domains (domain, organization_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [d, actor.organizationId]);
        if (!inserted.rowCount) throw clientError(409, `${d} is already connected to another organization`);
      }
      await recordAudit(client, actor, "sso.configured", "organization", actor.organizationId,
        { issuer: input.issuer, domains: input.domains, enforce: input.enforce, autoProvisionRole: input.autoProvisionRole, secretChanged: !!input.clientSecret });
    });
    return (await this.getConnection(actor))!;
  }

  async deleteConnection(actor: RequestActor): Promise<void> {
    requirePermission(actor, "member:manage");
    await withTransaction(this.pool, async client => {
      await client.query(`DELETE FROM sso_connections WHERE organization_id = $1`, [actor.organizationId]);
      await recordAudit(client, actor, "sso.removed", "organization", actor.organizationId);
    });
  }

  // True when password sign-in is disabled for this email (owners keep a break-glass password).
  async passwordBlocked(email: string, organizationRole: string): Promise<boolean> {
    if (organizationRole === "owner") return false;
    const result = await this.pool.query(`SELECT 1 FROM sso_domains d JOIN sso_connections c ON c.organization_id = d.organization_id
      WHERE d.domain = $1 AND c.enforce`, [emailDomain(email)]);
    return !!result.rowCount;
  }

  // Starts a sign-in for an email address; returns where to send the browser and the state to bind to it.
  async start(email: string): Promise<{ redirectUrl: string; state: string }> {
    const connection = await this.pool.query<{ organizationId: string; issuer: string; clientId: string }>(
      `SELECT c.organization_id AS "organizationId", c.issuer, c.client_id AS "clientId"
      FROM sso_domains d JOIN sso_connections c ON c.organization_id = d.organization_id WHERE d.domain = $1`, [emailDomain(email)]);
    const row = connection.rows[0];
    if (!row) throw clientError(404, "Single sign-on is not set up for this email domain");
    const discovery = await this.oidc.discover(row.issuer);
    const state = randomToken(), nonce = randomToken(), codeVerifier = randomToken();
    await this.pool.query(`DELETE FROM sso_login_states WHERE expires_at <= now()`);
    await this.pool.query(`INSERT INTO sso_login_states (state_hash, organization_id, nonce, code_verifier, expires_at) VALUES ($1,$2,$3,$4,$5)`,
      [tokenHash(state), row.organizationId, nonce, codeVerifier, new Date(Date.now() + STATE_TTL_MS)]);
    const redirectUrl = this.oidc.authorizationUrl(discovery, { clientId: row.clientId, redirectUri: this.redirectUri, state, nonce, codeChallenge: pkceChallenge(codeVerifier), loginHint: email });
    return { redirectUrl, state };
  }

  // Finishes the identity-provider round trip and opens a GovernBright session.
  async complete(state: string, code: string): Promise<{ token: string; actor: AuthenticatedSession }> {
    const consumed = await this.pool.query<{ organizationId: string; nonce: string; codeVerifier: string }>(
      `DELETE FROM sso_login_states WHERE state_hash = $1 AND expires_at > now()
      RETURNING organization_id AS "organizationId", nonce, code_verifier AS "codeVerifier"`, [tokenHash(state)]);
    const flow = consumed.rows[0];
    if (!flow) throw new OidcError("This sign-in link has expired; start again");
    const connection = await this.pool.query<{ issuer: string; clientId: string; clientSecret: string; autoProvisionRole: string | null }>(
      `SELECT issuer, client_id AS "clientId", client_secret AS "clientSecret", auto_provision_role AS "autoProvisionRole"
      FROM sso_connections WHERE organization_id = $1`, [flow.organizationId]);
    const config = connection.rows[0];
    if (!config) throw new OidcError("Single sign-on is no longer set up for this organization");

    const discovery = await this.oidc.discover(config.issuer);
    const idToken = await this.oidc.exchangeCode(discovery, { clientId: config.clientId, clientSecret: this.secrets.open(config.clientSecret), redirectUri: this.redirectUri, code, codeVerifier: flow.codeVerifier });
    const claims = await this.oidc.verifyIdToken(discovery, idToken, { clientId: config.clientId, nonce: flow.nonce });
    const email = claims.email?.toLowerCase();
    if (!email || claims.email_verified === false || claims.email_verified === "false") throw new OidcError("Your identity provider did not share a verified email address");
    const domains = await this.pool.query(`SELECT 1 FROM sso_domains WHERE organization_id = $1 AND domain = $2`, [flow.organizationId, emailDomain(email)]);
    if (!domains.rowCount) throw new OidcError(`${emailDomain(email)} is not connected to this organization`);

    return withTransaction(this.pool, async client => {
      let userId = (await client.query<{ userId: string }>(`SELECT user_id AS "userId" FROM user_identities WHERE issuer = $1 AND subject = $2`, [claims.iss, claims.sub])).rows[0]?.userId;
      if (!userId) {
        userId = (await client.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = $1`, [email])).rows[0]?.id;
        if (!userId && config.autoProvisionRole) {
          userId = (await client.query<{ id: string }>(`INSERT INTO users (external_subject, email, display_name) VALUES ($1,$2,$3) RETURNING id`,
            [`oidc:${claims.iss}:${claims.sub}`, email, (claims.name || email).slice(0, 200)])).rows[0]!.id;
        }
        if (!userId) throw Object.assign(new OidcError("You don't have a GovernBright account yet; ask your administrator to add you"), { statusCode: 403 });
        await client.query(`INSERT INTO user_identities (issuer, subject, user_id) VALUES ($1,$2,$3)`, [claims.iss, claims.sub, userId]);
      }
      const membership = await client.query<{ active: boolean }>(`SELECT active FROM memberships WHERE organization_id = $1 AND user_id = $2`, [flow.organizationId, userId]);
      if (!membership.rows[0] && config.autoProvisionRole) {
        await client.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,$3)`, [flow.organizationId, userId, config.autoProvisionRole]);
        await client.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, target_type, target_id, result, correlation_id, metadata)
          VALUES ($1,$2,'member.provisioned_by_sso','user',$2,'success',gen_random_uuid(),$3)`, [flow.organizationId, userId, JSON.stringify({ email, role: config.autoProvisionRole })]);
      } else if (!membership.rows[0]?.active) {
        throw Object.assign(new OidcError("Your access to this organization is not active; ask your administrator"), { statusCode: 403 });
      }
      return this.auth.createSession(userId, flow.organizationId, "sso", client);
    });
  }
}
