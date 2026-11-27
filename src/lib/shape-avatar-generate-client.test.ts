import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({
  api: vi.fn(async () => ({ def: { version: 1, id: "cup", name: "Cup", body: { path: "M0 0Z" }, eyes: { x: 50, y: 50, spacing: 17, scale: 1 } }, source: "fallback" })),
}));

import { api } from "@/state/store";
import { generateBotShapeAvatar } from "./shape-avatar-generate-client";

describe("generateBotShapeAvatar (#5369)", () => {
  it("POSTs the direction and returns the definition as JSON text the picker Import path accepts", async () => {
    const text = await generateBotShapeAvatar("bot-1", "a coffee mug");
    expect(api).toHaveBeenCalledWith("/api/bots/bot-1/shape-avatar/generate", {
      method: "POST",
      body: JSON.stringify({ direction: "a coffee mug" }),
    });
    expect(JSON.parse(text)).toMatchObject({ id: "cup", version: 1 });
  });
});
