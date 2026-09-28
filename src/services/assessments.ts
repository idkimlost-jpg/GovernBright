import type pg from "pg";
import { z } from "zod";
import { requirePermission } from "../domain/authorization.js";
import { controls, evaluate, questions, type Control } from "../domain/assessment-framework.js";
import { NotFoundError } from "../domain/errors.js";
import type { RequestActor } from "../domain/types.js";
import { withTransaction } from "../db/transaction.js";
import { recordAudit } from "./audit.js";

export const assessmentInput = z.object({
  responses: z.object(Object.fromEntries(questions.map(q => [q.id, z.boolean()])) as Record<string, z.ZodBoolean>),
  reviewNotes: z.string().trim().max(2000).default("")
});
export type AssessmentInput = z.infer<typeof assessmentInput>;

export type Assessment = {
  id: string; aiSystemId: string; assessorName: string | null; responses: Record<string, boolean>; score: number;
  calculatedTier: string; decision: string; requiredControls: Control[]; reviewNotes: string; completedAt: string;
};

const selectFields = `a.id, a.ai_system_id AS "aiSystemId", u.display_name AS "assessorName", a.responses, a.score,
  a.calculated_tier AS "calculatedTier", a.decision, a.required_controls AS "requiredControls", a.review_notes AS "reviewNotes", a.completed_at AS "completedAt"`;

export class AssessmentService {
  constructor(private readonly pool: pg.Pool) {}

  framework() { return { questions, controls: Object.values(controls) }; }

  // Scores the answers, records the assessment and moves the system to the resulting tier,
  // status and next review date (90 days for high risk, otherwise a year).
  async assess(actor: RequestActor, aiSystemId: string, input: AssessmentInput): Promise<Assessment> {
    requirePermission(actor, "ai_system:assess");
    const result = evaluate(input.responses);
    return withTransaction(this.pool, async client => {
      const system = await client.query<{ name: string }>(`SELECT name FROM ai_systems WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [aiSystemId, actor.organizationId]);
      if (!system.rows[0]) throw new NotFoundError("AI system not found");
      const inserted = await client.query<{ id: string }>(`INSERT INTO risk_assessments
        (organization_id, ai_system_id, assessor_user_id, responses, score, calculated_tier, decision, required_controls, review_notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [actor.organizationId, aiSystemId, actor.userId, JSON.stringify(input.responses), result.score, result.tier, result.decision, JSON.stringify(result.controls), input.reviewNotes]);
      const status = result.decision === "approved" ? "approved" : result.decision === "prohibited" ? "retired" : "under_review";
      await client.query(`UPDATE ai_systems SET risk_tier = $3, status = $4, next_review_at = current_date + $5::int, updated_at = now()
        WHERE id = $1 AND organization_id = $2`, [aiSystemId, actor.organizationId, result.tier, status, result.score >= 50 ? 90 : 365]);
      await recordAudit(client, actor, "risk_assessment.completed", "ai_system", aiSystemId, { system: system.rows[0].name, score: result.score, tier: result.tier, decision: result.decision });
      const row = await client.query<Assessment>(`SELECT ${selectFields} FROM risk_assessments a LEFT JOIN users u ON u.id = a.assessor_user_id WHERE a.id = $1`, [inserted.rows[0]!.id]);
      return row.rows[0]!;
    });
  }

  async history(actor: RequestActor, aiSystemId: string): Promise<Assessment[]> {
    requirePermission(actor, "ai_system:read");
    const result = await this.pool.query<Assessment>(`SELECT ${selectFields} FROM risk_assessments a LEFT JOIN users u ON u.id = a.assessor_user_id
      WHERE a.ai_system_id = $1 AND a.organization_id = $2 ORDER BY a.completed_at DESC`, [aiSystemId, actor.organizationId]);
    return result.rows;
  }
}
