import { describe, expect, it } from "vitest";
import { isPendingSignInRequest, signInWaits } from "./sign-in-request.ts";

describe("signInWaits (#3305)", () => {
  it("an open card waits; done, cancelled, superseded and answered in the chat do not", () => {
    expect(signInWaits({})).toBe(true);
    expect(signInWaits({ done: true })).toBe(false);
    expect(signInWaits({ cancelled: true })).toBe(false);
    expect(signInWaits({ superseded: true })).toBe(false);
    expect(signInWaits({ answeredInChat: true })).toBe(false);
  });

  it("a card answered in the chat is not superseded again by a newer request for the same site", () => {
    const card = { kind: "signin", signIn: { site: "example.com", answeredInChat: true } };
    expect(isPendingSignInRequest(card, "example.com", "bot", false)).toBe(false);
    expect(isPendingSignInRequest({ kind: "signin", signIn: { site: "example.com" } }, "example.com", "bot", false)).toBe(true);
  });
});
