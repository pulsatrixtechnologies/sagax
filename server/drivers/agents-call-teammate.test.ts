// delegate_bot and ask_bot send one idempotency key per call and retry a
// dropped connection once with it (server: idempotencyKeyOf, enqueueExternal).
import { describe, expect, it, vi } from "vitest";

import type { HarnessClient } from "./agents-client.ts";
import { sendTeammateRequest } from "./agents-call.ts";

describe("sendTeammateRequest", () => {
  it("retries a dropped connection once with the same idempotency key", async () => {
    const api = vi.fn<HarnessClient["api"]>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ queued: true, taskId: "t-1" });
    const result = await sendTeammateRequest(api, "/api/internal/delegate-bot", { toBotId: "peer", message: "Do it" });
    expect(result).toEqual({ queued: true, taskId: "t-1" });
    expect(api).toHaveBeenCalledTimes(2);
    const keys = api.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).idempotencyKey);
    expect(keys[0]).toMatch(/^[\w-]{8,}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(api.mock.calls[1]![1]?.headers).toMatchObject({ "idempotency-key": keys[0] });
  });

  it("never retries a refusal", async () => {
    const api = vi.fn<HarnessClient["api"]>().mockRejectedValue(new Error("no such bot"));
    await expect(sendTeammateRequest(api, "/api/internal/ask-bot", { toBotId: "x", message: "Hi" })).rejects.toThrow("no such bot");
    expect(api).toHaveBeenCalledTimes(1);
  });
});
