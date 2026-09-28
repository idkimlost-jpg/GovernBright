import type pg from "pg";
import { z } from "zod";
import { requirePermission } from "../domain/authorization.js";
import type { Control } from "../domain/assessment-framework.js";
import type { RequestActor } from "../domain/types.js";

export const auditQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});
export type AuditQuery = z.infer<typeof auditQuery>;

export type AuditEntry = { createdAt: string; actorEmail: string | null; actorName: string | null; action: string; targetType: string; targetId: string | null; result: string; correlationId: string; metadata: Record<string, unknown> };

export type EvidenceReport = {
  organization: string; generatedAt: string; generatedBy: string;
  systems: { total: number; byTier: Record<string, number>; byStatus: Record<string, number>; overdueReviews: Array<{ name: string; nextReviewAt: string }>; unassessed: string[] };
  assessments: Array<{ system: string; decision: string; tier: string; score: number; completedAt: string; controls: string[] }>;
  frameworkCoverage: Array<{ framework: string; clause: string; title: string; systems: number }>;
  policy: { version: number; title: string; publishedAt: string; accepted: number; members: number } | null;
  toolRequests: Record<string, number>;
  access: { members: number; mfaEnabled: number; ssoConfigured: boolean; ssoEnforced: boolean; mfaRequired: boolean };
  auditEvents: { last90Days: number };
};

// Neutralizes spreadsheet formulas (=, +, -, @) and quotes every cell.
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const EXPORT_LIMIT = 50_000;

export class ReportService {
  constructor(private readonly pool: pg.Pool) {}

  async auditLog(actor: RequestActor, query: AuditQuery, limit = query.limit): Promise<AuditEntry[]> {
    requirePermission(actor, "audit:read");
    const result = await this.pool.query<AuditEntry>(`SELECT e.created_at AS "createdAt", u.email AS "actorEmail", u.display_name AS "actorName",
        e.action, e.target_type AS "targetType", e.target_id AS "targetId", e.result, e.correlation_id AS "correlationId", e.metadata
      FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.organization_id = $1 AND ($2::date IS NULL OR e.created_at >= $2::date) AND ($3::date IS NULL OR e.created_at < $3::date + 1)
      ORDER BY e.created_at DESC LIMIT $4`, [actor.organizationId, query.from ?? null, query.to ?? null, limit]);
    return result.rows;
  }

  async auditCsv(actor: RequestActor, query: AuditQuery): Promise<string> {
    const rows = await this.auditLog(actor, query, EXPORT_LIMIT);
    const header = ["time", "actor_email", "actor_name", "action", "target_type", "target_id", "result", "correlation_id", "details"];
    const lines = rows.map(r => [new Date(r.createdAt).toISOString(), r.actorEmail, r.actorName, r.action, r.targetType, r.targetId, r.result, r.correlationId, r.metadata].map(csvCell).join(","));
    return [header.join(","), ...lines].join("\r\n") + "\r\n";
  }

  async evidence(actor: RequestActor): Promise<EvidenceReport> {
    requirePermission(actor, "audit:read");
    const org = actor.organizationId, q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = [org]) => this.pool.query<T>(sql, params).then(r => r.rows);
    const [meta, systems, latest, policy, requests, access, audit] = await Promise.all([
      q<{ name: string; generatedBy: string; requireMfa: boolean }>(`SELECT o.name, u.display_name AS "generatedBy", o.require_mfa AS "requireMfa" FROM organizations o, users u WHERE o.id = $1 AND u.id = $2`, [org, actor.userId]),
      q<{ name: string; riskTier: string; status: string; nextReviewAt: string | null; assessed: boolean }>(`SELECT s.name, s.risk_tier AS "riskTier", s.status, s.next_review_at::text AS "nextReviewAt",
          EXISTS (SELECT 1 FROM risk_assessments a WHERE a.ai_system_id = s.id) AS assessed FROM ai_systems s WHERE s.organization_id = $1 ORDER BY s.name`),
      q<{ system: string; decision: string; tier: string; score: number; completedAt: string; requiredControls: Control[] }>(`SELECT DISTINCT ON (a.ai_system_id) s.name AS system, a.decision, a.calculated_tier AS tier, a.score,
          a.completed_at AS "completedAt", a.required_controls AS "requiredControls"
          FROM risk_assessments a JOIN ai_systems s ON s.id = a.ai_system_id WHERE a.organization_id = $1 ORDER BY a.ai_system_id, a.completed_at DESC`),
      q<{ version: number; title: string; publishedAt: string; accepted: number; members: number }>(`SELECT p.version, p.title, p.published_at AS "publishedAt",
          (SELECT count(*)::int FROM policy_acceptances pa JOIN memberships m ON m.user_id = pa.user_id AND m.organization_id = $1 AND m.active WHERE pa.policy_id = p.id) AS accepted,
          (SELECT count(*)::int FROM memberships m WHERE m.organization_id = $1 AND m.active) AS members
          FROM ai_policies p WHERE p.organization_id = $1 ORDER BY p.version DESC LIMIT 1`),
      q<{ status: string; count: number }>(`SELECT status, count(*)::int AS count FROM tool_requests WHERE organization_id = $1 GROUP BY status`),
      q<{ members: number; mfaEnabled: number; ssoConfigured: boolean; ssoEnforced: boolean }>(`SELECT count(*)::int AS members, count(u.totp_enabled_at)::int AS "mfaEnabled",
          EXISTS (SELECT 1 FROM sso_connections c WHERE c.organization_id = $1) AS "ssoConfigured",
          EXISTS (SELECT 1 FROM sso_connections c WHERE c.organization_id = $1 AND c.enforce) AS "ssoEnforced"
          FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 AND m.active`),
      q<{ count: number }>(`SELECT count(*)::int AS count FROM audit_events WHERE organization_id = $1 AND created_at > now() - interval '90 days'`)
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const tally = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
    const coverage = new Map<string, { framework: string; clause: string; title: string; systems: Set<string> }>();
    for (const assessment of latest) for (const control of assessment.requiredControls) for (const ref of control.references) {
      const key = `${ref.framework}|${ref.clause}`;
      if (!coverage.has(key)) coverage.set(key, { ...ref, systems: new Set() });
      coverage.get(key)!.systems.add(assessment.system);
    }
    return {
      organization: meta[0]!.name, generatedAt: new Date().toISOString(), generatedBy: meta[0]!.generatedBy,
      systems: {
        total: systems.length, byTier: tally(systems.map(s => s.riskTier)), byStatus: tally(systems.map(s => s.status)),
        overdueReviews: systems.filter(s => s.status !== "retired" && s.nextReviewAt && s.nextReviewAt < today).map(s => ({ name: s.name, nextReviewAt: s.nextReviewAt! })),
        unassessed: systems.filter(s => !s.assessed && s.status !== "retired").map(s => s.name)
      },
      assessments: latest.map(a => ({ system: a.system, decision: a.decision, tier: a.tier, score: a.score, completedAt: a.completedAt, controls: a.requiredControls.map(c => c.title) }))
        .sort((x, y) => x.system.localeCompare(y.system)),
      frameworkCoverage: [...coverage.values()].map(c => ({ framework: c.framework, clause: c.clause, title: c.title, systems: c.systems.size }))
        .sort((x, y) => x.framework.localeCompare(y.framework) || x.clause.localeCompare(y.clause, undefined, { numeric: true })),
      policy: policy[0] ?? null,
      toolRequests: Object.fromEntries(requests.map(r => [r.status, r.count])),
      access: { ...access[0]!, mfaRequired: meta[0]!.requireMfa },
      auditEvents: { last90Days: audit[0]!.count }
    };
  }
}

const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A self-contained page an auditor can read or print to PDF.
export function renderEvidenceHtml(report: EvidenceReport): string {
  const pct = (n: number, d: number) => d ? `${Math.round((n / d) * 100)}%` : "—";
  const list = (record: Record<string, number>) => Object.entries(record).map(([k, v]) => `${esc(k.replace("_", " "))}: ${v}`).join(" · ") || "none";
  const rows = (items: string[][]) => items.map(cells => `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AI governance evidence — ${esc(report.organization)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#142b2d;max-width:960px;margin:40px auto;padding:0 20px}h1{margin-bottom:0}h2{margin-top:32px;border-bottom:2px solid #0f766e;padding-bottom:4px}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #dfe6e2;vertical-align:top}th{font-size:12px;text-transform:uppercase;color:#667575}
.muted{color:#667575}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.grid div{border:1px solid #dfe6e2;border-radius:8px;padding:12px}.grid strong{display:block;font-size:22px}
@media print{body{margin:0}h2{break-after:avoid}}</style></head><body>
<h1>AI governance evidence report</h1>
<p class="muted">${esc(report.organization)} · generated ${esc(new Date(report.generatedAt).toUTCString())} by ${esc(report.generatedBy)}</p>
<div class="grid"><div>AI systems<strong>${report.systems.total}</strong></div><div>Assessed<strong>${report.assessments.length}</strong></div>
<div>Policy accepted<strong>${report.policy ? pct(report.policy.accepted, report.policy.members) : "—"}</strong></div><div>MFA adoption<strong>${pct(report.access.mfaEnabled, report.access.members)}</strong></div></div>
<h2>AI system inventory</h2><p>By risk tier: ${list(report.systems.byTier)}<br>By status: ${list(report.systems.byStatus)}</p>
<p>Overdue reviews: ${report.systems.overdueReviews.length ? report.systems.overdueReviews.map(s => `${esc(s.name)} (due ${esc(s.nextReviewAt)})`).join(", ") : "none"}<br>
Not yet assessed: ${report.systems.unassessed.length ? report.systems.unassessed.map(esc).join(", ") : "none"}</p>
<h2>Risk assessments</h2><table><thead><tr><th>System</th><th>Decision</th><th>Tier</th><th>Score</th><th>Completed</th><th>Required controls</th></tr></thead><tbody>
${rows(report.assessments.map(a => [esc(a.system), esc(a.decision), esc(a.tier), String(a.score), esc(new Date(a.completedAt).toISOString().slice(0, 10)), a.controls.map(esc).join("<br>")]))}</tbody></table>
<h2>Regulatory coverage</h2><p class="muted">Clauses addressed by controls required in current assessments. Indicative mapping for your own legal review; not legal advice.</p>
<table><thead><tr><th>Framework</th><th>Clause</th><th>Topic</th><th>Systems</th></tr></thead><tbody>
${rows(report.frameworkCoverage.map(c => [esc(c.framework), esc(c.clause), esc(c.title), String(c.systems)]))}</tbody></table>
<h2>AI use policy</h2><p>${report.policy ? `Version ${report.policy.version}, “${esc(report.policy.title)}”, published ${esc(new Date(report.policy.publishedAt).toISOString().slice(0, 10))}. Accepted by ${report.policy.accepted} of ${report.policy.members} active members (${pct(report.policy.accepted, report.policy.members)}).` : "No policy published."}</p>
<h2>Access control</h2><p>${report.access.members} active members; ${report.access.mfaEnabled} use two-factor authentication${report.access.mfaRequired ? " (required by the organization)" : ""}.
Single sign-on: ${report.access.ssoConfigured ? report.access.ssoEnforced ? "configured and enforced" : "configured" : "not configured"}.</p>
<h2>AI tool requests</h2><p>${list(report.toolRequests)}</p>
<h2>Audit trail</h2><p>${report.auditEvents.last90Days} append-only audit events recorded in the last 90 days. Export the full log as CSV from the Reports tab.</p>
</body></html>`;
}
