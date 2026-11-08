// A bot's look and persona for the Perspicax console (server/org/org-admin-look.ts):
// the character as the app resolves it, the picture only when it shows, the
// avatar file read without following a link, never a path on the wire.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { botLook, botPersona, avatarVersion, PERSONA_DESCRIPTION_MAX, readBotAvatar } from "./org-admin-look.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { OBJECT_SHAPE_BY_ID } from "../../shared/shape-avatar-presets.ts";

const FILE = "123e4567-e89b-12d3-a456-426614174000.webp";
const exists = (name: string) => name === FILE;

describe("a bot's look", () => {
  it("is the owl in the bot's color when the owner chose nothing", () => {
    expect(botLook({ name: "Atlas", color: "blue" }, exists)).toEqual({
      kind: "default", character: "owl", family: "classics", color: "blue", colorHex: "#377FE6", skin: "none", shape: null, avatarDef: null, expression: null, image: null,
    });
  });

  it("carries the shape's own drawing so a console draws the bot list's mascot (#2784)", () => {
    const avatarDef = { ...OBJECT_SHAPE_BY_ID.sprout, id: "my-own-mascot", name: "My own" };
    expect(botLook({ name: "A", color: "green", mascotLook: { character: "shape", shape: "circle", avatarDef } }, exists)).toMatchObject({ character: "shape", avatarDef });
    expect(botLook({ name: "A", color: "green", mascotLook: { character: "shape", shape: "sprout" } }, exists)).toMatchObject({ shape: "sprout", avatarDef: null });
    expect(botLook({ name: "A", color: "green", mascotLook: { character: "shiba", avatarDef } }, exists)).toMatchObject({ avatarDef: null });
  });

  it("names the character, its family, skin and shape as stored", () => {
    expect(botLook({ name: "A", color: "tomato", mascotLook: { character: "shape", shape: "star", skins: { shape: "nebula" } } }, exists)).toMatchObject({
      // star is a shape of its own since the full shape set (#1513, 2026-10-28)
      kind: "mascot", character: "shape", family: "shapes", color: "tomato", colorHex: "#E8483F", skin: "galaxy", shape: "star",
    });
    expect(botLook({ name: "A", color: "green", mascotLook: { character: "shiba", skins: { shiba: "sesame" } } }, exists)).toMatchObject({ kind: "mascot", family: "animals", skin: "sesame", shape: null });
    expect(botLook({ name: "A", color: "green", mascotLook: { character: "trombi" } }, exists)).toMatchObject({ kind: "mascot", family: "classics", skin: "classic" });
    // the owl's skin is the bot's mascotSkin; a skin alone is a choice
    expect(botLook({ name: "A", color: "green", mascotSkin: "galaxy", mascotExpression: "happy" }, exists)).toMatchObject({ kind: "mascot", character: "owl", skin: "galaxy", expression: "happy" });
    // an unknown color has no value; a junk look is the owl
    expect(botLook({ name: "A", color: "#123456", mascotLook: { character: "dragon" } }, exists)).toMatchObject({ kind: "default", character: "owl", colorHex: null });
  });

  it("is the picture only when its crop shows it and its file is there", () => {
    const picture = { name: "A", color: "green", avatarUrl: `/api/attachments/${FILE}`, avatarCrop: "rounded", avatarZoom: 2.226, avatarFocusX: 0.2 };
    const look = botLook(picture, exists);
    expect(look).toMatchObject({ kind: "image", character: "owl", image: { crop: "rounded", zoom: 2.23, focusX: 0.2, focusY: 0.5, version: avatarVersion(FILE), type: "image/webp" } });
    expect(JSON.stringify(look)).not.toContain(FILE);
    expect(botLook({ ...picture, avatarCrop: "mascot" }, exists).kind).toBe("default");
    expect(botLook(picture, () => false).kind).toBe("default");
    expect(botLook({ ...picture, avatarUrl: "https://tracker.example/pixel.png" }, () => true).kind).toBe("default");
  });
});

describe("a bot's persona", () => {
  it("is the name, the role and a short description", () => {
    expect(botPersona({ name: "Atlas", title: " Sales assistant ", description: "Prepares the digest." })).toEqual({ displayName: "Atlas", title: "Sales assistant", description: "Prepares the digest." });
    expect(botPersona({ name: "Atlas", title: "", description: "" })).toEqual({ displayName: "Atlas", title: null, description: null });
    const long = botPersona({ name: "A", description: "x".repeat(4000) });
    expect(long.description).toHaveLength(PERSONA_DESCRIPTION_MAX);
    expect(long.descriptionTruncated).toBe(true);
  });
});

describe("the avatar file", () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-admin-look-"));
  afterAll(() => removeTempDir(dir));
  const bot = (name: string, crop = "circle") => ({ name: "A", color: "green", avatarUrl: `/api/attachments/${name}`, avatarCrop: crop });

  it("reads the picture with its type and version", () => {
    writeFileSync(join(dir, FILE), Buffer.from("RIFFwebp"));
    expect(readBotAvatar(bot(FILE), dir)).toEqual({ bytes: Buffer.from("RIFFwebp"), type: "image/webp", version: avatarVersion(FILE) });
  });

  it("has none for a mascot crop, a missing file, a link or a folder; too large past the cap", () => {
    expect(readBotAvatar(bot(FILE, "mascot"), dir)).toBeNull();
    expect(readBotAvatar(bot("aaaa-bbbb.png"), dir)).toBeNull();
    writeFileSync(join(dir, "outside.png"), "secret");
    symlinkSync(join(dir, "outside.png"), join(dir, "link-1.png"));
    expect(readBotAvatar(bot("link-1.png"), dir)).toBeNull();
    mkdirSync(join(dir, "folder-1.gif"));
    expect(readBotAvatar(bot("folder-1.gif"), dir)).toBeNull();
    writeFileSync(join(dir, "big-1.jpg"), Buffer.alloc(32));
    expect(readBotAvatar(bot("big-1.jpg"), dir, 16)).toBe("too_large");
    expect(readBotAvatar({ name: "A", color: "green" }, dir)).toBeNull();
  });
});
