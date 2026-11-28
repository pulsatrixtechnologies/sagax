import { describe, expect, it, vi } from "vitest";
import { parseEngineAvatar } from "../../shared/engine-avatar-def";

vi.mock("@/state/store", () => ({
  api: vi.fn(async () => ({
    def: {
      version: 1,
      id: "mug",
      name: "Mug",
      body: { path: "M22 20H62C67 20 70 23 70 28V72C70 80 64 86 56 86H28C20 86 14 80 14 72V28C14 23 17 20 22 20ZM68 36C80 34 87 42 87 53C87 64 80 72 68 70ZM69 45L69 61C75.5 62 79 58.5 79 53C79 47.5 76 44 69 45Z" },
      eyes: { x: 42, y: 49, spacing: 16, scale: 1.15 },
    },
    source: "fallback",
  })),
}));

import { api } from "@/state/store";
import { generateBotShapeAvatar } from "./shape-avatar-generate-client";

describe("generateBotShapeAvatar (#5369, #5450)", () => {
  it("POSTs the direction and returns engine-format JSON the picker Import path accepts", async () => {
    const text = await generateBotShapeAvatar("bot-1", "a coffee mug");
    expect(api).toHaveBeenCalledWith("/api/bots/bot-1/shape-avatar/generate", {
      method: "POST",
      body: JSON.stringify({ direction: "a coffee mug" }),
    });
    expect(JSON.parse(text)).toMatchObject({ id: "mug", version: 1 });
    expect(parseEngineAvatar(text).ok).toBe(true);
  });
});
