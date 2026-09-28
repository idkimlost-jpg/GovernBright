import { describe, expect, it } from "vitest";
import { assertPublicUrl, isBlockedAddress } from "./network.js";

describe("outbound destination checks", () => {
  it("blocks internal, metadata and mapped addresses", () => {
    for (const address of ["10.1.2.3", "172.20.0.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "140.82.112.3", "2606:4700::1111"]) expect(isBlockedAddress(address), address).toBe(false);
  });

  it("rejects private targets and plain http, allowing local http only when asked", async () => {
    await expect(assertPublicUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow(/internal/);
    await expect(assertPublicUrl("https://[::1]/scim")).rejects.toThrow(/internal/);
    await expect(assertPublicUrl("https://localhost/scim")).rejects.toThrow(/internal/);
    await expect(assertPublicUrl("http://8.8.8.8/")).rejects.toThrow(/https/);
    await expect(assertPublicUrl("http://127.0.0.1:4000/")).rejects.toThrow();
    await expect(assertPublicUrl("http://127.0.0.1:4000/", { allowLoopback: true })).resolves.toBeUndefined();
    await expect(assertPublicUrl("https://8.8.8.8/")).resolves.toBeUndefined();
  });
});
