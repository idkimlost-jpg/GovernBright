import { describe, expect, it, vi } from "vitest";
import { ToolRequestService, toolKeyFor } from "./tool-requests.js";
import type { RequestActor, Role } from "../domain/types.js";

const actor = (role: Role): RequestActor => ({ userId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", correlationId: "33333333-3333-4333-8333-333333333333", role });

describe("tool requests", () => {
  it("normalizes tool keys and only treats real ChatGPT names as ChatGPT", () => {
    expect(toolKeyFor("ChatGPT")).toBe("chatgpt");
    expect(toolKeyFor("ChatGPT Enterprise")).toBe("chatgpt");
    expect(toolKeyFor("Not ChatGPT")).toBe("not-chatgpt");
    expect(toolKeyFor("  GitHub Copilot! ")).toBe("github-copilot");
  });

  it("limits non-deciders to their own requests", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await new ToolRequestService({ query } as never).list(actor("contributor"));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("r.requester_user_id = $2"), [actor("contributor").organizationId, actor("contributor").userId]);
  });

  it("shows deciders every request in their organization", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await new ToolRequestService({ query } as never).list(actor("admin"));
    expect(query).toHaveBeenCalledWith(expect.not.stringContaining("requester_user_id = $2"), [actor("admin").organizationId]);
  });
});
