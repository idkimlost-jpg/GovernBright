import { describe, expect, it } from "vitest";
import { ForbiddenError, requirePermission, requireSameOrganization } from "./authorization.js";
import type { RequestActor, Role } from "./types.js";

const actor = (role: Role): RequestActor => ({
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  correlationId: "33333333-3333-4333-8333-333333333333",
  role
});

describe("authorization", () => {
  it("allows contributors to create AI systems", () => expect(() => requirePermission(actor("contributor"), "ai_system:create")).not.toThrow());
  it("blocks read-only mutation", () => expect(() => requirePermission(actor("read_only"), "ai_system:create")).toThrow(ForbiddenError));
  it("blocks cross-tenant access", () => expect(() => requireSameOrganization(actor("owner"), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toThrow(ForbiddenError));
});

