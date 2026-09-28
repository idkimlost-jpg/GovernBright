import { describe, expect, it, vi } from "vitest";
import { AiSystemService } from "./ai-systems.js";
import type { RequestActor } from "../domain/types.js";

const actor: RequestActor = { userId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", correlationId: "33333333-3333-4333-8333-333333333333", role: "owner" };

describe("AiSystemService tenancy", () => {
  it("always scopes list queries to the actor organization", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new AiSystemService({ query } as never);
    await service.list(actor);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("organization_id = $1"), [actor.organizationId]);
  });

  it("uses id and organization together for object lookup", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new AiSystemService({ query } as never);
    const objectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await service.get(actor, objectId);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("id = $1 AND organization_id = $2"), [objectId, actor.organizationId]);
  });
});

