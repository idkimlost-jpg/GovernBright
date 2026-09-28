import type { RequestActor, Role } from "./types.js";

export type Action = "ai_system:read" | "ai_system:create" | "ai_system:approve" | "ai_system:update" | "ai_system:delete" | "audit:read" | "member:manage";

const grants: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(["ai_system:read", "ai_system:create", "ai_system:approve", "ai_system:update", "ai_system:delete", "audit:read", "member:manage"]),
  admin: new Set(["ai_system:read", "ai_system:create", "ai_system:approve", "ai_system:update", "ai_system:delete", "audit:read", "member:manage"]),
  contributor: new Set(["ai_system:read", "ai_system:create", "ai_system:update"]),
  reviewer: new Set(["ai_system:read", "audit:read"]),
  read_only: new Set(["ai_system:read"])
};

export class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor() { super("You do not have permission to perform this action"); }
}

export function requirePermission(actor: RequestActor, action: Action): void {
  if (!grants[actor.role].has(action)) throw new ForbiddenError();
}

export function requireSameOrganization(actor: RequestActor, organizationId: string): void {
  if (actor.organizationId !== organizationId) throw new ForbiddenError();
}

