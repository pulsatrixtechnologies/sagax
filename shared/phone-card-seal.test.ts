import { describe, expect, it } from "vitest";

import {
  CARD_SEAL_INFO,
  cardSealAAD,
  createCardScanKey,
  isCardSealPublicKey,
  isSealedCard,
  openSealedCard,
  sealCardForTest,
  cardScanMatchCode,
  cardSealKeyId,
  fromBase64Url,
  toBase64Url,
} from "./phone-card-seal.ts";

describe("card scan sealed for the form (JC 2026-10-21: the server never sees the number)", () => {
  it("seals on the phone side and opens only in the form that made the key", async () => {
    const key = await createCardScanKey();
    expect(isCardSealPublicKey(key.publicKey)).toBe(true);
    const sealed = await sealCardForTest(key.publicKey, "req-1", { number: "4111 1111 1111 1111", expMonth: 9, expYear: 2029, holder: "ANN", cvc: "123" });
    expect(isSealedCard(sealed)).toBe(true);
    // what crosses the server carries no digit of the number in clear
    expect(JSON.stringify(sealed)).not.toContain("4111");
    await expect(openSealedCard(key, "req-1", sealed)).resolves.toEqual({ number: "4111111111111111", expMonth: 9, expYear: 2029, holder: "ANN" });
  });

  it("refuses an envelope moved to another request or another key, or tampered", async () => {
    const key = await createCardScanKey();
    const other = await createCardScanKey();
    const sealed = await sealCardForTest(key.publicKey, "req-1", { number: "4111111111111111" });
    await expect(openSealedCard(key, "req-2", sealed)).rejects.toThrow();
    await expect(openSealedCard(other, "req-1", sealed)).rejects.toThrow();
    const flipped = { ...sealed, ciphertext: sealed.ciphertext.slice(0, -2) + (sealed.ciphertext.endsWith("A") ? "BB" : "AA") };
    await expect(openSealedCard(key, "req-1", flipped)).rejects.toThrow();
  });

  it("refuses a card number that is not one", async () => {
    const key = await createCardScanKey();
    const sealed = await sealCardForTest(key.publicKey, "req-1", { number: "4111111111111112" });
    await expect(openSealedCard(key, "req-1", sealed)).rejects.toThrow(/card number/);
  });

  it("binds the request, the key and a six digit code the person compares on both screens", async () => {
    // the iOS side computes the same (PhoneCardSealTests.testMatchesTheDesktop)
    const fixed = "BI2XxkLkDjK8RYguiDPEwsWPmG2DGFkqlRSg0sVasL-HyW1-N_RIvm6cVQGadXeUWyolisP8qszBjBy_vjx_XPo";
    expect(await cardSealKeyId(fixed)).toBe("aIOcqutt7r9OXgV4z50O1A");
    expect(await cardScanMatchCode(fixed)).toBe("288033");
    expect(new TextDecoder().decode(cardSealAAD("req-1", "abcdefghijklmnopqrstuv"))).toBe("sagax-phone-card-scan-v1\nreq-1\nabcdefghijklmnopqrstuv");
    expect(CARD_SEAL_INFO).toBe("Sagax phone card scan v1");
    expect(isCardSealPublicKey("AAAA")).toBe(false);
  });

  it("opens what the iPhone sealed (CryptoKit, PhoneCardSealTests): the two sides agree", async () => {
    const publicKey = "BI2XxkLkDjK8RYguiDPEwsWPmG2DGFkqlRSg0sVasL-HyW1-N_RIvm6cVQGadXeUWyolisP8qszBjBy_vjx_XPo";
    const point = fromBase64Url(publicKey)!;
    const jwk = { kty: "EC", crv: "P-256", x: toBase64Url(point.slice(1, 33)), y: toBase64Url(point.slice(33)), d: "KAM8s70VpviMD-zzoLeQybAjPCiPR1HGpN8kkOfjYvM", ext: true };
    const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    // sealed by ios/Tests/CompanionCoreTests/PhoneCardSealTests.swift (PRINT_CARD_SEAL_FIXTURE=1), request "req-1"
    const sealed = { encapsulatedKey: "BMmDj6874L2khPTTnDDBEFN2t4YFBKFHA8ZK4WPKGs5_wzgQZ0BnPNJlo9dDOxKSuy_vidVgXwQyszs4sM8QmPU", ciphertext: "sPjpFfSkb_mTo0sKZiw9GkUM37ziXVzaV81LzF-4Z_A_NqxcN8H_acJ_5rHD7kXyej_YdeKkNYAfLmBxGhFnWrI876LOSpIrhn2JX0fuXNKH9h5x8IJj7A" };
    await expect(openSealedCard({ publicKey, privateKey }, "req-1", sealed)).resolves.toEqual({ number: "4111111111111111", expMonth: 9, expYear: 2029, holder: "ANN" });
  });
});
