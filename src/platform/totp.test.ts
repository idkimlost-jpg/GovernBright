import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, verifyTotp } from "./totp.js";

// RFC 6238 Appendix B test secret ("12345678901234567890").
const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("round-trips base32", () => {
    const bytes = Buffer.from("governbright-secret");
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it("matches the RFC 6238 SHA-1 test vectors", () => {
    expect(hotp(rfcSecret, Math.floor(59 / 30))).toBe("287082");
    expect(hotp(rfcSecret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(hotp(rfcSecret, Math.floor(1234567890 / 30))).toBe("005924");
  });

  it("accepts one step of drift and rejects older codes", () => {
    const now = 1234567890_000;
    expect(verifyTotp(rfcSecret, "005924", now)).toBe(Math.floor(1234567890 / 30));
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, Math.floor(1234567890 / 30) - 1), now)).not.toBeNull();
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, Math.floor(1234567890 / 30) - 2), now)).toBeNull();
    expect(verifyTotp(rfcSecret, "12345", now)).toBeNull();
  });
});
