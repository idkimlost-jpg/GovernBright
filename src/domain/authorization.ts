import type { RequestActor, Role } from "./types.js";

export type Action = "ai_system:read" | "ai_system:create" | "ai_system:approve" | "ai_system:update" | "ai_system:delete" | "audit:read" | "member:manage"
  | "tool_request:create" | "tool_request:decide";

const grants: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(["ai_system:read", "ai_system:create", "ai_system:approve", "ai_system:update", "ai_system:delete", "audit:read", "member:manage", "tool_request:create", "tool_request:decide"]),
  admin: new Set(["ai_system:read", "ai_system:create", "ai_system:approve", "ai_system:update", "ai_system:delete", "audit:read", "member:manage", "tool_request:create", "tool_request:decide"]),
  contributor: new Set(["ai_system:read", "ai_system:create", "ai_system:update", "tool_request:create"]),
  reviewer: new Set(["ai_system:read", "audit:read", "tool_request:create"]),
  read_only: new Set(["ai_system:read", "tool_request:create"])
};

export class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor() { super("You do not have permission to perform this action"); }
}

export function can(actor: RequestActor, action: Action): boolean {
  return grants[actor.role].has(action);
}

export function requirePermission(actor: RequestActor, action: Action): void {
  if (!can(actor, action)) throw new ForbiddenError();
}

export function requireSameOrganization(actor: RequestActor, organizationId: string): void {
  if (actor.organizationId !== organizationId) throw new ForbiddenError();
}

