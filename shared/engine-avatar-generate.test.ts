import { describe, expect, it, vi } from "vitest";
import { parseEngineAvatar } from "./engine-avatar-def";
import {
  ENGINE_AVATAR_PROMPT_MARKER,
  generateEngineAvatarDef,
  generateEngineAvatarDefWithModel,
  matchEngineAvatarFallback,
} from "./engine-avatar-generate";

describe("generateEngineAvatarDef (open-bot-avatar format, #5450)", () => {
  it.each([
    ["un chat", "cat"],
    ["a coffee cup", "mug"],
    ["une fusée", "rocket"],
    ["a soft cloud", "cloud"],
    ["un petit robot", "robot"],
  ] as const)("maps %s to a definition Import accepts (id %s)", (direction, id) => {
    const def = generateEngineAvatarDef(direction);
    expect(def.id).toBe(id);
    expect(parseEngineAvatar(JSON.stringify(def)).ok).toBe(true);
  });

  it("never returns the older portable schemaVersion format", () => {
    const def = generateEngineAvatarDef("a rocket");
    expect(def).toMatchObject({ version: 1, body: { path: expect.stringMatching(/^M/) } });
    expect(def).not.toHaveProperty("schemaVersion");
  });
});

describe("generateEngineAvatarDefWithModel", () => {
  it("falls back when no engine is wired", async () => {
    const out = await generateEngineAvatarDefWithModel("coffee mug", null);
    expect(out.source).toBe("fallback");
    expect(out.def.id).toBe("mug");
    expect(parseEngineAvatar(JSON.stringify(out.def)).ok).toBe(true);
  });

  it("uses the model answer when it validates as an engine definition", async () => {
    const modelDef = matchEngineAvatarFallback("cat");
    const generateText = vi.fn(async (prompt: string) => {
      expect(prompt).toContain(ENGINE_AVATAR_PROMPT_MARKER);
      return JSON.stringify(modelDef);
    });
    const out = await generateEngineAvatarDefWithModel("a friendly cat", { generateText });
    expect(out.source).toBe("model");
    expect(out.def.id).toBe("cat");
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("retries once on invalid model text then falls back", async () => {
    const generateText = vi.fn(async () => "not json at all");
    const out = await generateEngineAvatarDefWithModel("friendly rocket", { generateText });
    expect(out.source).toBe("fallback");
    expect(out.def.id).toBe("rocket");
    expect(generateText).toHaveBeenCalledTimes(2);
  });
});
