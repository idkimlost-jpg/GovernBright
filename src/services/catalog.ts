import type pg from "pg";
import { z } from "zod";

export type CatalogEntry = {
  key: string; name: string; vendor: string; category: string; website: string;
  trainsOnCustomerData: string | null; dataRetention: string | null; dataResidency: string | null; certifications: string[] | null;
  enterpriseControls: string | null; notes: string | null; sourceUrl: string | null; reviewedAt: string | null;
};
export type Matcher = { key: string; name: string; domains: string[]; keywords: string[] };

// Operator-supplied vendor facts. Every fact needs a source and review date so customers can check it.
export const catalogFacts = z.array(z.object({
  key: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1).max(120), vendor: z.string().min(1).max(120), category: z.string().min(1).max(60), website: z.url(),
  matchDomains: z.array(z.string()).default([]), matchKeywords: z.array(z.string()).default([]),
  trainsOnCustomerData: z.enum(["no", "yes", "opt_out", "plan_dependent"]).nullable().default(null),
  dataRetention: z.string().max(500).nullable().default(null), dataResidency: z.string().max(500).nullable().default(null),
  certifications: z.array(z.string().max(60)).nullable().default(null), enterpriseControls: z.string().max(1000).nullable().default(null),
  notes: z.string().max(2000).nullable().default(null), sourceUrl: z.url().nullable().default(null), reviewedAt: z.iso.date().nullable().default(null)
}).refine(f => f.trainsOnCustomerData === null || (f.sourceUrl && f.reviewedAt), "Reviewed facts need sourceUrl and reviewedAt"));

const fields = `key, name, vendor, category, website, trains_on_customer_data AS "trainsOnCustomerData", data_retention AS "dataRetention",
  data_residency AS "dataResidency", certifications, enterprise_controls AS "enterpriseControls", notes, source_url AS "sourceUrl", reviewed_at::text AS "reviewedAt"`;

export class CatalogService {
  constructor(private readonly pool: pg.Pool) {}

  async list(): Promise<CatalogEntry[]> {
    return (await this.pool.query<CatalogEntry>(`SELECT ${fields} FROM ai_tool_catalog ORDER BY name`)).rows;
  }

  async get(key: string): Promise<CatalogEntry | null> {
    return (await this.pool.query<CatalogEntry>(`SELECT ${fields} FROM ai_tool_catalog WHERE key = $1`, [key])).rows[0] ?? null;
  }

  async matchers(): Promise<Matcher[]> {
    return (await this.pool.query<Matcher>(`SELECT key, name, match_domains AS domains, match_keywords AS keywords FROM ai_tool_catalog`)).rows;
  }

  async import(entries: z.infer<typeof catalogFacts>): Promise<number> {
    for (const e of entries) {
      await this.pool.query(`INSERT INTO ai_tool_catalog (key, name, vendor, category, website, match_domains, match_keywords, trains_on_customer_data,
          data_retention, data_residency, certifications, enterprise_controls, notes, source_url, reviewed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (key) DO UPDATE SET name = $2, vendor = $3, category = $4, website = $5, match_domains = $6, match_keywords = $7,
          trains_on_customer_data = $8, data_retention = $9, data_residency = $10, certifications = $11, enterprise_controls = $12,
          notes = $13, source_url = $14, reviewed_at = $15, updated_at = now()`,
        [e.key, e.name, e.vendor, e.category, e.website, e.matchDomains, e.matchKeywords, e.trainsOnCustomerData, e.dataRetention,
          e.dataResidency, e.certifications, e.enterpriseControls, e.notes, e.sourceUrl, e.reviewedAt]);
    }
    return entries.length;
  }
}
