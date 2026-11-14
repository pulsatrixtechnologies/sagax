// A pasted open-bot-avatar definition as a bot's shape (#4160): validated with
// the engine's validateAvatar and stored on the bot's look (mascotLook.avatarDef).
import { describe, expect, it } from "vitest";
import { ENGINE_AVATAR_REASONS, engineAvatarReason, isEngineAvatarDef, parseEngineAvatar } from "./engine-avatar-def";
import { botMascotLook, completeMascotLook, mascotLookSchema } from "./mascot-look";
import { parseBotProfilePatch } from "../server/bots/bot-profile";

const kite = {
  version: 1,
  id: "kite",
  name: "Kite",
  body: { path: "M50 10L86 50L50 90L14 50Z" },
  eyes: { x: 50, y: 48, spacing: 14, scale: 1 },
};

describe("parseEngineAvatar", () => {
  it("takes a pasted engine definition, as text, and returns the engine's normalized value", () => {
    const result = parseEngineAvatar(JSON.stringify(kite, null, 2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.def.id).toBe("kite");
    expect(result.def.name).toBe("Kite");
    expect(result.def.body.path).toMatch(/^M/);
    expect(isEngineAvatarDef(result.def)).toBe(true);
  });

  it("refuses what the engine refuses, sorted into reasons a person can read, never the engine's raw text", () => {
    const parse = (value: unknown) => parseEngineAvatar(typeof value === "string" ? value : JSON.stringify(value));
    expect(parse({ ...kite, eyes: { ...kite.eyes, scale: 9, spacing: 14 } })).toMatchObject({ ok: false, reasons: expect.arrayContaining(["eyesSize"]) });
    expect(parse({ ...kite, eyes: { ...kite.eyes, x: 80, y: 20 } })).toEqual({ ok: false, reasons: ["eyesOutside"] });
    expect(parse({ ...kite, body: { path: "M0 0L100 0L100 100Z" } })).toMatchObject({ ok: false, reasons: expect.arrayContaining(["outside"]) });
    expect(parse({ ...kite, body: { path: "M45 45L55 45L55 55Z" } })).toMatchObject({ ok: false, reasons: expect.arrayContaining(["small"]) });
    expect(parse({ ...kite, body: { path: "Q nonsense" } })).toEqual({ ok: false, reasons: ["path"] });
    expect(parse({ ...kite, id: "Not A Slug", extra: 1 })).toEqual({ ok: false, reasons: ["fields"] });
    expect(parse("not json")).toEqual({ ok: false, reasons: ["json"] });
    expect(parse("")).toEqual({ ok: false, reasons: ["json"] });
    expect(parse("[1]")).toEqual({ ok: false, reasons: ["json"] });
  });

  it("sorts every error text the engine can give into a reason", () => {
    expect(engineAvatarReason("eyes.spacing 14 out of range 63..40 for scale 9")).toBe("eyesSize");
    expect(engineAvatarReason("body fill area 120 is too thin to carry eyes; must be at least 600 units²")).toBe("small");
    expect(engineAvatarReason("version must be 1")).toBe("fields");
    expect(ENGINE_AVATAR_REASONS).toContain(engineAvatarReason("anything new"));
  });

  it("is not the older portable format", () => {
    expect(isEngineAvatarDef({ schemaVersion: 1, body: { kind: "path", d: "M0 0Z" }, eyes: {} })).toBe(false);
  });
});

describe("a pasted shape on the bot's look", () => {
  it("is kept by the look's schema and by the bot profile patch", () => {
    const look = { character: "shape", shape: "circle", avatarDef: kite };
    expect(mascotLookSchema.safeParse(look).success).toBe(true);
    expect(completeMascotLook(look).avatarDef).toMatchObject({ id: "kite", body: { path: expect.any(String) } });
    const patch = parseBotProfilePatch({ mascotLook: look });
    expect(patch.ok && patch.patch.mascotLook?.avatarDef).toMatchObject({ id: "kite" });
  });

  it("an invalid definition is refused by the schema, and a stored one that does not validate drops alone, not the whole look", () => {
    const bad = { character: "shape", shape: "star", avatarDef: { ...kite, eyes: { ...kite.eyes, scale: 9 } } };
    expect(mascotLookSchema.safeParse(bad).success).toBe(false);
    expect(botMascotLook(bad)).toEqual({ character: "shape", shape: "star" });
  });
});
