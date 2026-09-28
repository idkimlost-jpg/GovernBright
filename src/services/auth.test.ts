import { describe, expect, it, vi } from "vitest";
import { AuthService, AuthenticationError, hashPassword, verifyPassword } from "./auth.js";

describe("password authentication", () => {
  it("hashes passwords with a unique salt and verifies the correct value", async () => {
    const first = await hashPassword("a secure example password");
    const second = await hashPassword("a secure example password");
    expect(first).not.toBe(second);
    await expect(verifyPassword("a secure example password", first)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", first)).resolves.toBe(false);
  });

  it("rejects an unknown session before authorization", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new AuthService({ query } as never, 12);
    await expect(service.resolve("unknown", "33333333-3333-4333-8333-333333333333")).rejects.toBeInstanceOf(AuthenticationError);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("m.active = true"), expect.any(Array));
  });
});
