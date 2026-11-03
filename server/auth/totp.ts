// One-time codes for the credential vault (RFC 4226 HOTP, RFC 6238 TOTP).
// The seed stays in the vault; a code is computed at fill time, typed into
// the bound page by the browser runtime and never returned to a bot.
import { createHmac } from "node:crypto";

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface TotpParams {
  secret: Buffer;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, spaces, dashes and padding ignored, case-insensitive.
 * Null on any other character, or on an empty result. */
export function base32Decode(input: string): Buffer | null {
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  if (!clean) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return out.length ? Buffer.from(out) : null;
}

/** A seed as people paste it: a base32 secret or an otpauth://totp/ URI.
 * Null when it is neither, so a typo is refused at save time rather than
 * producing wrong codes at fill time. */
export function parseTotpSeed(raw: string): TotpParams | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^otpauth:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.hostname.toLowerCase() !== "totp") return null;
    const secret = base32Decode(url.searchParams.get("secret") ?? "");
    if (!secret) return null;
    const algorithm = (url.searchParams.get("algorithm") ?? "SHA1").toUpperCase();
    if (algorithm !== "SHA1" && algorithm !== "SHA256" && algorithm !== "SHA512") return null;
    const digits = Number(url.searchParams.get("digits") ?? 6);
    const period = Number(url.searchParams.get("period") ?? 30);
    if (!Number.isInteger(digits) || digits < 6 || digits > 8) return null;
    if (!Number.isInteger(period) || period < 10 || period > 300) return null;
    return { secret, algorithm, digits, period };
  }
  const secret = base32Decode(text);
  return secret ? { secret, algorithm: "SHA1", digits: 6, period: 30 } : null;
}

export function hotp(secret: Buffer, counter: number, digits = 6, algorithm: TotpAlgorithm = "SHA1"): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm.toLowerCase(), secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totp(params: TotpParams, nowMs: number = Date.now()): string {
  return hotp(params.secret, Math.floor(nowMs / 1000 / params.period), params.digits, params.algorithm);
}
