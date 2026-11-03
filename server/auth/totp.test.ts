import { describe, expect, it } from "vitest";

import { base32Decode, hotp, parseTotpSeed, totp } from "./totp.ts";

// RFC 6238 appendix B test seeds (ASCII "1234567890" repeated), fake values.
const SHA1_SEED = Buffer.from("12345678901234567890");
const SHA256_SEED = Buffer.from("12345678901234567890123456789012");
const SHA512_SEED = Buffer.from("1234567890123456789012345678901234567890123456789012345678901234");

describe("totp", () => {
  it("matches the RFC 4226 HOTP vectors", () => {
    expect([0, 1, 2, 9].map((counter) => hotp(SHA1_SEED, counter))).toEqual(["755224", "287082", "359152", "520489"]);
  });

  it("matches the RFC 6238 vectors for every algorithm", () => {
    expect(totp({ secret: SHA1_SEED, algorithm: "SHA1", digits: 8, period: 30 }, 59_000)).toBe("94287082");
    expect(totp({ secret: SHA256_SEED, algorithm: "SHA256", digits: 8, period: 30 }, 59_000)).toBe("46119246");
    expect(totp({ secret: SHA512_SEED, algorithm: "SHA512", digits: 8, period: 30 }, 59_000)).toBe("90693936");
    expect(totp({ secret: SHA1_SEED, algorithm: "SHA1", digits: 8, period: 30 }, 1_111_111_109_000)).toBe("07081804");
  });

  it("reads a base32 seed or an otpauth URI and refuses anything else", () => {
    // "GEZDGNBVGY3TQOJQ" is base32 of "1234567890".
    expect(base32Decode("gezd gnbv gy3t qojq")?.toString()).toBe("1234567890");
    const plain = parseTotpSeed("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(plain).toMatchObject({ algorithm: "SHA1", digits: 6, period: 30 });
    const uri = parseTotpSeed("otpauth://totp/Fake:ada@example.test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8&period=60&algorithm=sha256");
    expect(uri).toMatchObject({ algorithm: "SHA256", digits: 8, period: 60 });
    expect(parseTotpSeed("not a seed!")).toBeNull();
    expect(parseTotpSeed("otpauth://hotp/x?secret=GEZDGNBV")).toBeNull();
    expect(parseTotpSeed("otpauth://totp/x?secret=GEZDGNBV&digits=4")).toBeNull();
  });
});
