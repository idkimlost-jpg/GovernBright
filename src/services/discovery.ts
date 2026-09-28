import type pg from "pg";
import { z } from "zod";
import { requirePermission } from "../domain/authorization.js";
import { NotFoundError } from "../domain/errors.js";
import type { RequestActor } from "../domain/types.js";
import { withTransaction } from "../db/transaction.js";
import { findColumns, parseCsv } from "../platform/csv.js";
import { recordAudit } from "./audit.js";
import type { CatalogService, Matcher } from "./catalog.js";
import { toolKeyFor } from "./tool-requests.js";

export const discoverySources = ["google_workspace", "microsoft_entra", "okta", "expenses", "other"] as const;
export const discoveryImport = z.object({
  source: z.enum(discoverySources),
  csv: z.string().min(1).max(10_000_000)
});
export type DiscoveryImport = z.infer<typeof discoveryImport>;

export type DiscoveredTool = {
  toolKey: string; name: string; recognized: boolean; sources: string[]; users: string[]; eventCount: number; spendCents: number;
  firstSeen: string | null; lastSeen: string | null; status: string; aiSystemId: string | null; vendor: string | null; category: string | null;
};
export type ImportSummary = { rows: number; matchedRows: number; tools: Array<{ toolKey: string; name: string; recognized: boolean; events: number }> };

// Column names used by Google Workspace OAuth token audit exports, Entra/Okta sign-in logs and
// expense tools; matched loosely so most CSV exports work without mapping.
const columnAliases = {
  app: ["app name", "application", "application name", "client", "client name", "app", "target", "merchant", "vendor", "payee", "description", "memo"],
  email: ["user email", "email", "user principal name", "actor", "user", "employee", "cardholder", "submitter"],
  domain: ["domain", "url", "website", "redirect", "scope"],
  date: ["date", "time", "timestamp", "event time", "created", "transaction date", "posted"],
  amount: ["amount", "total", "cost", "spend"]
};
// Names that look like AI tools even when they are not in the catalog.
const aiLike = /\b(ai|gpt|llm|copilot|chatbot|genai|openai|assistant)\b/i;
const MAX_USERS_TRACKED = 200;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Matches an app name exactly, a vendor domain (or subdomain) as a whole host, or a keyword as whole words.
export function matchTool(text: string, matchers: Matcher[], appName?: string): Matcher | null {
  const haystack = text.toLowerCase(), app = appName?.trim().toLowerCase();
  for (const m of matchers) {
    if (app && app === m.name.toLowerCase()) return m;
    if (m.domains.some(d => new RegExp(`(^|[^a-z0-9.-])([a-z0-9-]+\\.)*${escapeRegex(d)}(?![a-z0-9-]|\\.[a-z0-9])`).test(haystack))) return m;
    if (m.keywords.some(k => new RegExp(`(^|[^a-z0-9])${escapeRegex(k.toLowerCase())}($|[^a-z0-9])`).test(haystack))) return m;
  }
  return null;
}

const toCents = (value: string | undefined) => {
  const n = Number((value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : 0;
};
const toDate = (value: string | undefined) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

export class DiscoveryService {
  constructor(private readonly pool: pg.Pool, private readonly catalog: CatalogService) {}

  async import(actor: RequestActor, input: DiscoveryImport): Promise<ImportSummary> {
    requirePermission(actor, "discovery:manage");
    const [header, ...rows] = parseCsv(input.csv);
    if (!header) throw Object.assign(new Error("The file is empty"), { statusCode: 400 });
    const col = findColumns(header, columnAliases);
    if (col.app < 0 && col.domain < 0) throw Object.assign(new Error("Could not find an app, merchant or description column in this file"), { statusCode: 400 });
    const matchers = await this.catalog.matchers();

    type Hit = { name: string; recognized: boolean; users: Set<string>; events: number; spend: number; first: string | null; last: string | null };
    const hits = new Map<string, Hit>();
    let matchedRows = 0;
    for (const row of rows) {
      const cell = (i: number) => (i >= 0 ? row[i]?.trim() : undefined) || undefined;
      const text = [cell(col.app), cell(col.domain)].filter(Boolean).join(" ");
      if (!text) continue;
      const matched = matchTool(text, matchers, cell(col.app));
      const name = matched?.name ?? (aiLike.test(cell(col.app) ?? "") ? cell(col.app)!.slice(0, 120) : null);
      if (!name) continue;
      const key = matched?.key ?? toolKeyFor(name);
      if (!key) continue;
      matchedRows++;
      const hit = hits.get(key) ?? hits.set(key, { name, recognized: !!matched, users: new Set(), events: 0, spend: 0, first: null, last: null }).get(key)!;
      hit.events++;
      const email = cell(col.email)?.toLowerCase();
      if (email?.includes("@")) hit.users.add(email);
      if (input.source === "expenses") hit.spend += toCents(cell(col.amount));
      const date = toDate(cell(col.date));
      if (date && (!hit.first || date < hit.first)) hit.first = date;
      if (date && (!hit.last || date > hit.last)) hit.last = date;
    }

    await withTransaction(this.pool, async client => {
      for (const [key, hit] of hits) {
        await client.query(`INSERT INTO discovered_tools (organization_id, tool_key, name, recognized, sources, users, event_count, spend_cents, first_seen, last_seen)
          VALUES ($1,$2,$3,$4,ARRAY[$5],$6,$7,$8,$9,$10)
          ON CONFLICT (organization_id, tool_key) DO UPDATE SET
            sources = (SELECT array_agg(DISTINCT s) FROM unnest(discovered_tools.sources || EXCLUDED.sources) s),
            users = (SELECT array_agg(DISTINCT u) FROM (SELECT unnest(discovered_tools.users || EXCLUDED.users) u LIMIT ${MAX_USERS_TRACKED}) x),
            event_count = discovered_tools.event_count + EXCLUDED.event_count,
            spend_cents = discovered_tools.spend_cents + EXCLUDED.spend_cents,
            first_seen = LEAST(discovered_tools.first_seen, EXCLUDED.first_seen),
            last_seen = GREATEST(discovered_tools.last_seen, EXCLUDED.last_seen),
            updated_at = now()`,
          [actor.organizationId, key, hit.name, hit.recognized, input.source, [...hit.users].slice(0, MAX_USERS_TRACKED), hit.events, hit.spend, hit.first, hit.last]);
      }
      await recordAudit(client, actor, "discovery.imported", "organization", actor.organizationId, { source: input.source, rows: rows.length, tools: [...hits.keys()] });
    });
    return { rows: rows.length, matchedRows, tools: [...hits].map(([toolKey, h]) => ({ toolKey, name: h.name, recognized: h.recognized, events: h.events })) };
  }

  async list(actor: RequestActor): Promise<DiscoveredTool[]> {
    requirePermission(actor, "discovery:manage");
    const result = await this.pool.query<DiscoveredTool>(`SELECT d.tool_key AS "toolKey", d.name, d.recognized, d.sources, d.users, d.event_count AS "eventCount",
        d.spend_cents::int AS "spendCents", d.first_seen::text AS "firstSeen", d.last_seen::text AS "lastSeen", d.status, d.ai_system_id AS "aiSystemId",
        c.vendor, c.category
      FROM discovered_tools d LEFT JOIN ai_tool_catalog c ON c.key = d.tool_key
      WHERE d.organization_id = $1 ORDER BY d.status = 'new' DESC, cardinality(d.users) DESC, d.event_count DESC`, [actor.organizationId]);
    return result.rows;
  }

  // Adds a discovered tool to the AI system register as a draft for assessment.
  async register(actor: RequestActor, toolKey: string): Promise<{ aiSystemId: string }> {
    requirePermission(actor, "discovery:manage");
    requirePermission(actor, "ai_system:create");
    return withTransaction(this.pool, async client => {
      const found = await client.query<{ name: string; users: string[]; vendor: string | null; aiSystemId: string | null }>(`SELECT d.name, d.users, c.vendor, d.ai_system_id AS "aiSystemId"
        FROM discovered_tools d LEFT JOIN ai_tool_catalog c ON c.key = d.tool_key WHERE d.organization_id = $1 AND d.tool_key = $2 FOR UPDATE OF d`, [actor.organizationId, toolKey]);
      const tool = found.rows[0];
      if (!tool) throw new NotFoundError("Discovered tool not found");
      if (tool.aiSystemId) return { aiSystemId: tool.aiSystemId };
      const existing = await client.query<{ id: string }>(`SELECT id FROM ai_systems WHERE organization_id = $1 AND lower(name) = lower($2)`, [actor.organizationId, tool.name]);
      const aiSystemId = existing.rows[0]?.id ?? (await client.query<{ id: string }>(`INSERT INTO ai_systems (organization_id, name, purpose, vendor, owner_name, risk_tier, status)
        VALUES ($1,$2,$3,$4,'Unassigned','moderate','draft') RETURNING id`,
        [actor.organizationId, tool.name, `Discovered in use by ${tool.users.length} people; purpose to be confirmed.`, tool.vendor ?? "Unknown"])).rows[0]!.id;
      await client.query(`UPDATE discovered_tools SET status = 'registered', ai_system_id = $3, updated_at = now() WHERE organization_id = $1 AND tool_key = $2`, [actor.organizationId, toolKey, aiSystemId]);
      await recordAudit(client, actor, "discovery.registered", "ai_system", aiSystemId, { toolKey, name: tool.name });
      return { aiSystemId };
    });
  }

  async setIgnored(actor: RequestActor, toolKey: string, ignored: boolean): Promise<void> {
    requirePermission(actor, "discovery:manage");
    await withTransaction(this.pool, async client => {
      const updated = await client.query(`UPDATE discovered_tools SET status = CASE WHEN $3 THEN 'ignored'::discovery_status WHEN ai_system_id IS NULL THEN 'new' ELSE 'registered' END, updated_at = now()
        WHERE organization_id = $1 AND tool_key = $2`, [actor.organizationId, toolKey, ignored]);
      if (!updated.rowCount) throw new NotFoundError("Discovered tool not found");
      await recordAudit(client, actor, ignored ? "discovery.ignored" : "discovery.restored", "organization", actor.organizationId, { toolKey });
    });
  }
}
