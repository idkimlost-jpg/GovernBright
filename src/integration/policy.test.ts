import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../domain/authorization.js";
import { ConflictError } from "../domain/errors.js";
import { createHarness, databaseUrl, type Harness } from "./helpers.js";

describe.skipIf(!databaseUrl)("PostgreSQL integration: AI policy sign-off", () => {
  let h: Harness;
  beforeAll(() => { h = createHarness(); });
  afterAll(() => h.close());
  const request = { toolName: "ChatGPT", businessPurpose: "Drafting", dataDescription: "" };

  it("requires acceptance of the current version before tool requests", async () => {
    const a = await h.organization("Policy");
    const member = await h.addMember(a.owner, "contributor");
    expect((await h.services.policies.current(member.actor)).policy).toBeNull();
    await h.services.toolRequests.create(member.actor, request);

    await expect(h.services.policies.publish(member.actor, { title: "AI use", body: "Do not paste customer data." })).rejects.toBeInstanceOf(ForbiddenError);
    const v1 = await h.services.policies.publish(a.owner, { title: "AI use", body: "Do not paste customer data." });
    expect(v1.version).toBe(1);
    await expect(h.services.toolRequests.create(member.actor, request)).rejects.toMatchObject({ statusCode: 409, code: "policy_acceptance_required" });
    await h.services.policies.accept(member.actor, v1.id);
    await h.services.toolRequests.create(member.actor, request);

    const v2 = await h.services.policies.publish(a.owner, { title: "AI use v2", body: "Also label AI-generated content." });
    expect(v2.version).toBe(2);
    await expect(h.services.policies.accept(member.actor, v1.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(h.services.toolRequests.create(member.actor, request)).rejects.toMatchObject({ code: "policy_acceptance_required" });

    const status = await h.services.policies.status(a.owner);
    expect(status.policy?.version).toBe(2);
    expect(status.members.find(m => m.userId === member.actor.userId)?.acceptedAt).toBeNull();
    await h.services.policies.accept(member.actor, v2.id);
    expect((await h.services.policies.current(member.actor)).acceptedAt).not.toBeNull();
    expect((await h.services.policies.history(a.owner)).map(p => p.version)).toEqual([2, 1]);
  });

  it("keeps versions per organization", async () => {
    const a = await h.organization("Policy A"), b = await h.organization("Policy B");
    await h.services.policies.publish(a.owner, { title: "A policy", body: "Organization A rules." });
    expect((await h.services.policies.publish(b.owner, { title: "B policy", body: "Organization B rules." })).version).toBe(1);
    expect((await h.services.policies.current(b.owner)).policy?.title).toBe("B policy");
  });
});
