import { describe, expect, it, vi } from "vitest";

import { createCardScanKey, sealCardForTest, type CardScanKey } from "../../shared/phone-card-seal";
import { runCardScan, type CardScanOutcome } from "./phone-card-scan";

describe("runCardScan", () => {
  it("sends only the form's public key, shows its code, and opens the phone's envelope here", async () => {
    const key = await createCardScanKey();
    const sealed = await sealCardForTest(key.publicKey, "r1", { number: "4111111111111111", expMonth: 9, expYear: 2029, cvc: "123" });
    const answers: CardScanOutcome[] = [{ status: "pending", requestId: "r1" }, { status: "done", sealed }];
    const deps = {
      start: vi.fn(async (_publicKey: string) => ({ requestId: "r1", expiresAt: 0 })),
      wait: vi.fn(async () => answers.shift()!),
      cancel: vi.fn(async () => undefined),
      key: async (): Promise<CardScanKey> => key,
    };
    const onCode = vi.fn();
    await expect(runCardScan(new AbortController().signal, onCode, deps)).resolves.toEqual({ status: "done", card: { number: "4111111111111111", expMonth: 9, expYear: 2029 } });
    expect(deps.start).toHaveBeenCalledWith(key.publicKey);
    expect(onCode.mock.calls[0]![0]).toMatch(/^\d{6}$/);
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it("an envelope sealed for another key is refused", async () => {
    const key = await createCardScanKey();
    const other = await createCardScanKey();
    const sealed = await sealCardForTest(other.publicKey, "r1", { number: "4111111111111111" });
    const deps = { start: async () => ({ requestId: "r1", expiresAt: 0 }), wait: async (): Promise<CardScanOutcome> => ({ status: "done", sealed }), cancel: async () => undefined, key: async () => key };
    await expect(runCardScan(new AbortController().signal, () => {}, deps)).resolves.toEqual({ status: "failed", error: "The card could not be read." });
  });

  it("cancels the request on the phone when the form gives up", async () => {
    const controller = new AbortController();
    const deps = {
      start: vi.fn(async () => ({ requestId: "r2", expiresAt: 0 })),
      wait: vi.fn(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
      cancel: vi.fn(async () => undefined),
    };
    await expect(runCardScan(controller.signal, () => {}, deps)).resolves.toEqual({ status: "cancelled" });
    expect(deps.cancel).toHaveBeenCalledWith("r2");
  });
});
