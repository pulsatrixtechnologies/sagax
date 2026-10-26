import { describe, expect, it, vi } from "vitest";
import { autoSelectionReady, createAutoFirstBot } from "./first-bot";

describe("autoSelectionReady", () => {
  it("is true only when both an engine and a model are resolved", () => {
    expect(autoSelectionReady({ instanceId: "claude", model: "claude-sonnet-5", auto: true })).toBe(true);
    expect(autoSelectionReady({ instanceId: "", model: "" })).toBe(false);
    expect(autoSelectionReady(undefined)).toBe(false);
  });
});

describe("createAutoFirstBot", () => {
  it("creates a bot with the Auto engine and model from bot-defaults, without weakening approval", async () => {
    const created = { id: "bot_1", name: "Bot" };
    const request = vi.fn(async (path: string) => {
      if (path === "/api/bot-defaults") {
        return {
          modelSelection: { instanceId: "claude", model: "claude-sonnet-5", auto: true },
          approvalMode: "ask",
        };
      }
      return { bot: created };
    }) as unknown as typeof import("@/state/store").api;

    const bot = await createAutoFirstBot(request);
    expect(bot).toBe(created);

    // reads the same Auto defaults the New bot dialog opens on
    expect(request).toHaveBeenNthCalledWith(1, "/api/bot-defaults");
    // posts them to the same create endpoint the dialog uses
    const [, init] = (request as unknown as ReturnType<typeof vi.fn>).mock.calls[1]!;
    expect(init).toMatchObject({ method: "POST" });
    const body = JSON.parse(init.body as string);
    // engine Auto, model Auto
    expect(body.modelSelection).toEqual({ instanceId: "claude", model: "claude-sonnet-5", auto: true });
    // approval is left to the server's default (Approve for me); never sent as Full/Auto
    expect(body).not.toHaveProperty("approvalMode");
  });

  it("lets the server pick when no engine is connected yet, posting no empty selection", async () => {
    const request = vi.fn(async (path: string) => {
      if (path === "/api/bot-defaults") return { modelSelection: { instanceId: "", model: "" } };
      return { bot: { id: "bot_2" } };
    }) as unknown as typeof import("@/state/store").api;

    await createAutoFirstBot(request);
    const [, init] = (request as unknown as ReturnType<typeof vi.fn>).mock.calls[1]!;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({});
  });
});
