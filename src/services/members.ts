import type pg from "pg";
import { z } from "zod";
import { ForbiddenError, requirePermission } from "../domain/authorization.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import { roles, type Member, type RequestActor } from "../domain/types.js";
import { withTransaction } from "../db/transaction.js";
import { recordAudit } from "./audit.js";
import { hashPassword } from "./auth.js";

export const memberInput = z.object({
  email: z.email().max(320).transform(v => v.toLowerCase()),
  displayName: z.string().trim().min(2).max(200),
  role: z.enum(roles),
  // Initial password for a new account; ignored when the email already has an account.
  password: z.string().min(12).max(256)
});
export type MemberInput = z.infer<typeof memberInput>;

export const memberUpdate = z.object({
  role: z.enum(roles).optional(),
  active: z.boolean().optional()
}).refine(v => v.role !== undefined || v.active !== undefined, "Provide a role or active flag");
export type MemberUpdate = z.infer<typeof memberUpdate>;

const selectFields = `u.id AS "userId", u.email, u.display_name AS "displayName", m.role, m.active, m.created_at AS "joinedAt"`;

export class MemberService {
  constructor(private readonly pool: pg.Pool) {}

  async list(actor: RequestActor): Promise<Member[]> {
    requirePermission(actor, "member:manage");
    const result = await this.pool.query<Member>(`SELECT ${selectFields}
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1 ORDER BY lower(u.email)`, [actor.organizationId]);
    return result.rows;
  }

  async add(actor: RequestActor, input: MemberInput): Promise<Member> {
    requirePermission(actor, "member:manage");
    if (input.role === "owner" && actor.role !== "owner") throw new ForbiddenError();
    const passwordHash = await hashPassword(input.password);
    const added = withTransaction(this.pool, async client => {
      const existing = await client.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = $1`, [input.email]);
      let userId = existing.rows[0]?.id;
      if (!userId) {
        const created = await client.query<{ id: string }>(`INSERT INTO users (external_subject, email, display_name, password_hash)
          VALUES ($1,$2,$3,$4) RETURNING id`, [`local:${input.email}`, input.email, input.displayName, passwordHash]);
        userId = created.rows[0]!.id;
      }
      const membership = await client.query(`INSERT INTO memberships (organization_id, user_id, role)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [actor.organizationId, userId, input.role]);
      if (!membership.rowCount) throw new ConflictError("This person is already a member of your organization");
      await recordAudit(client, actor, "member.added", "user", userId, { email: input.email, role: input.role, newAccount: !existing.rowCount });
      return this.fetch(client, actor.organizationId, userId);
    });
    // Two admins adding the same new email at once collide on the unique email index.
    return added.catch(error => {
      if ((error as { code?: string }).code === "23505") throw new ConflictError("An account with this email was just created; try again");
      throw error;
    });
  }

  async update(actor: RequestActor, userId: string, input: MemberUpdate): Promise<Member> {
    requirePermission(actor, "member:manage");
    if (userId === actor.userId) throw Object.assign(new Error("You cannot change your own membership"), { statusCode: 400 });
    return withTransaction(this.pool, async client => {
      const current = await client.query<{ role: string }>(`SELECT role FROM memberships
        WHERE organization_id = $1 AND user_id = $2 FOR UPDATE`, [actor.organizationId, userId]);
      if (!current.rows[0]) throw new NotFoundError("Member not found");
      // Only owners may manage owners or grant ownership. The acting owner cannot change
      // themselves, so an organization always keeps at least one active owner.
      if ((current.rows[0].role === "owner" || input.role === "owner") && actor.role !== "owner") throw new ForbiddenError();
      await client.query(`UPDATE memberships SET role = COALESCE($3, role), active = COALESCE($4, active)
        WHERE organization_id = $1 AND user_id = $2`, [actor.organizationId, userId, input.role ?? null, input.active ?? null]);
      if (input.active === false) await client.query(`DELETE FROM sessions WHERE organization_id = $1 AND user_id = $2`, [actor.organizationId, userId]);
      await recordAudit(client, actor, "member.updated", "user", userId, { previousRole: current.rows[0].role, ...input });
      return this.fetch(client, actor.organizationId, userId);
    });
  }

  private async fetch(client: pg.PoolClient, organizationId: string, userId: string): Promise<Member> {
    const result = await client.query<Member>(`SELECT ${selectFields}
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1 AND m.user_id = $2`, [organizationId, userId]);
    return result.rows[0]!;
  }
}
