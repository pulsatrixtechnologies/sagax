import { describe, expect, it, vi } from "vitest";
import { validateShapeAvatarDef } from "../shared/shape-avatar-def.ts";
import {
  describeShapeAvatarDef,
  generateShapeAvatarDef,
  generateShapeAvatarDefWithModel,
  lookWithShapeAvatarDef,
  matchObjectShapePreset,
  parseShapeAvatarModelText,
  runGenerateShapeAvatar,
  runGenerateShapeAvatarAsync,
  SHAPE_AVATAR_PROMPT_MARKER,
  shapeAvatarGenerationPrompt,
} from "./shape-avatar.ts";

describe("matchObjectShapePreset", () => {
  it("maps object words onto our own presets", () => {
    expect(matchObjectShapePreset("a coffee mug please")).toBe("cup");
    expect(matchObjectShapePreset("game controller")).toBe("pad");
    expect(matchObjectShapePreset("little light bulb")).toBe("bulb");
    expect(matchObjectShapePreset("speech bubble")).toBe("say");
    expect(matchObjectShapePreset("office plant")).toBe("sprout");
    expect(matchObjectShapePreset("soda can")).toBe("tin");
    expect(matchObjectShapePreset("thick book")).toBe("tome");
    expect(matchObjectShapePreset("space rocket")).toBe("ship");
  });

  it("is stable for the same free text", () => {
    expect(matchObjectShapePreset("friendly blob")).toBe(matchObjectShapePreset("friendly blob"));
  });
});

describe("generateShapeAvatarDef", () => {
  it("returns a validated definition with a slug id", () => {
    const def = generateShapeAvatarDef("make me a mug");
    expect(validateShapeAvatarDef(def).ok).toBe(true);
    expect(def.id).toBe("cup");
    expect(def.schemaVersion).toBe(1);
    expect(def.id).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});

describe("runGenerateShapeAvatar", () => {
  it("applies the definition onto the bot look", () => {
    const result = runGenerateShapeAvatar({ direction: "a rocket ship" }, { character: "owl" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.look?.character).toBe("shape");
    expect(result.look?.shape).toBe("ship");
    expect(result.look?.avatarDef?.id).toBe("ship");
    expect(result.summary).toContain("id=ship");
  });

  it("validates a pasted definition before applying", () => {
    const bad = runGenerateShapeAvatar({ definition: { schemaVersion: 1, body: { kind: "path", d: "M0 0" } } }, {});
    expect(bad.ok).toBe(false);
    const good = runGenerateShapeAvatar({
      definition: generateShapeAvatarDef("plant"),
      apply: false,
    }, {});
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.applied).toBe(false);
  });
});

describe("lookWithShapeAvatarDef", () => {
  it("keeps skins and forces the shape character", () => {
    const look = lookWithShapeAvatarDef(
      { character: "shape", shape: "circle", skins: { shape: "neon" } },
      generateShapeAvatarDef("tin can"),
    );
    expect(look.character).toBe("shape");
    expect(look.skins?.shape).toBe("neon");
    expect(look.avatarDef).toBeTruthy();
  });
});

describe("describeShapeAvatarDef", () => {
  it("summarises without dumping the whole path", () => {
    const summary = describeShapeAvatarDef(generateShapeAvatarDef("bulb"));
    expect(summary).toContain("id=bulb");
    expect(summary.length).toBeLessThan(200);
  });
});

describe("generateShapeAvatarDefWithModel (fake engine)", () => {
  it("never needs a real provider: null engine falls back", async () => {
    const out = await generateShapeAvatarDefWithModel("coffee mug", null);
    expect(out.source).toBe("fallback");
    expect(out.def.id).toBe("cup");
  });

  it("accepts a valid model JSON and marks source=model", async () => {
    const def = generateShapeAvatarDef("pad");
    const generateText = vi.fn(async (prompt: string) => {
      expect(prompt).toContain(SHAPE_AVATAR_PROMPT_MARKER);
      expect(shapeAvatarGenerationPrompt("pad")).toContain("Visual direction");
      return `\`\`\`json\n${JSON.stringify(def)}\n\`\`\``;
    });
    const out = await generateShapeAvatarDefWithModel("game pad", { generateText });
    expect(out.source).toBe("model");
    expect(out.def.id).toBe("pad");
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("retries once then falls back on garbage", async () => {
    const generateText = vi.fn(async () => "sorry, no");
    const out = await generateShapeAvatarDefWithModel("space ship", { generateText });
    expect(out.source).toBe("fallback");
    expect(out.def.id).toBe("ship");
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("parseShapeAvatarModelText pulls fenced or bare JSON", () => {
    const def = generateShapeAvatarDef("tome");
    expect(validateShapeAvatarDef(parseShapeAvatarModelText(JSON.stringify(def))).ok).toBe(true);
    expect(validateShapeAvatarDef(parseShapeAvatarModelText(`Here:\n\`\`\`json\n${JSON.stringify(def)}\n\`\`\``)).ok).toBe(true);
    expect(parseShapeAvatarModelText("nope")).toBeNull();
  });

  it("runGenerateShapeAvatarAsync prefers definition and reports source", async () => {
    const def = generateShapeAvatarDef("sprout");
    const ready = await runGenerateShapeAvatarAsync({ definition: def, apply: false }, {});
    expect(ready.ok && ready.source).toBe("definition");
    const generated = await runGenerateShapeAvatarAsync({ direction: "plant", apply: false }, {}, null);
    expect(generated.ok && generated.source).toBe("fallback");
  });
});
