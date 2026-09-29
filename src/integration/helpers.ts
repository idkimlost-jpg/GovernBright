import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import type { Config } from "../config.js";
import { createPool } from "../db/pool.js";
import type { RequestActor, Role } from "../domain/types.js";
import type { Services } from "../http/context.js";
import { MemoryMailer } from "../platform/mailer.js";
import { SecretBox } from "../platform/secret-box.js";
import { hashPassword } from "../services/auth.js";
import { createServices } from "../services/index.js";

// Integration tests run against the migrated PostgreSQL database named by DATABASE_URL
// (CI provides one) and are skipped without it.
export const databaseUrl = process.env.DATABASE_URL;
export const password = "integration-password-2026";

export const testConfig = (): Config => ({
  NODE_ENV: "test", PORT: 3000, DATABASE_URL: databaseUrl!, ALLOW_DEV_AUTH: false, SESSION_TTL_HOURS: 1,
  APP_ORIGIN: "http://localhost:3000", APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"), MAIL_FROM: "test@example.test", TRUST_PROXY: false, CONTACT_EMAIL: "sales@example.test"
});

export type Harness = {
  pool: pg.Pool; config: Config; services: Services; mailer: MemoryMailer; secrets: SecretBox;
  // Outbound HTTP calls made through the injected fetch (Slack, SCIM).
  outbound: Array<{ url: string; method: string; body: unknown }>;
  // DNS TXT records visible to domain verification.
  dns: Map<string, string[][]>;
  organization(name: string): Promise<{ organizationId: string; owner: RequestActor; ownerEmail: string }>;
  addMember(owner: RequestActor, role: Role): Promise<{ email: string; actor: RequestActor }>;
  close(): Promise<void>;
};

export const actorFor = (organizationId: string, userId: string, role: Role): RequestActor => ({ organizationId, userId, role, correlationId: randomUUID() });

export function createHarness(): Harness {
  const config = testConfig();
  const pool = createPool(databaseUrl!);
  const mailer = new MemoryMailer(), secrets = new SecretBox(config.APP_ENCRYPTION_KEY);
  const outbound: Harness["outbound"] = [];
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    // Local test servers (SCIM, identity providers) are reached for real.
    if (String(url).startsWith("http://127.0.0.1:")) return fetch(url, init);
    outbound.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const dns = new Map<string, string[][]>();
  const services = createServices(config, pool, { mailer, secrets, fetch: fakeFetch, resolveTxt: async name => dns.get(name) ?? [] });
  return {
    pool, config, services, mailer, secrets, outbound, dns,
    async organization(name) {
      const organizationId = randomUUID(), userId = randomUUID(), email = `owner-${userId}@example.test`;
      await pool.query("INSERT INTO organizations (id, name) VALUES ($1,$2)", [organizationId, `${name} ${organizationId.slice(0, 8)}`]);
      await pool.query("INSERT INTO users (id, external_subject, email, display_name, password_hash) VALUES ($1,$2,$3,'Owner',$4)", [userId, `local:${email}`, email, await hashPassword(password)]);
      await pool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'owner')", [organizationId, userId]);
      return { organizationId, owner: actorFor(organizationId, userId, "owner"), ownerEmail: email };
    },
    async addMember(owner, role) {
      const email = `${role}-${randomUUID()}@example.test`;
      const member = await services.members.add(owner, { email, displayName: `Test ${role}`, role, password });
      return { email, actor: actorFor(owner.organizationId, member.userId, role) };
    },
    close: () => pool.end()
  };
}
