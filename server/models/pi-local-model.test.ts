import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isPiLocalModel, isPiModelServerModel, isPiServedModel, piLocalKeyRefusalLifted } from "./pi-local-model.ts";

describe("isPiLocalModel (#1422)", () => {
  it("is a pi model on a local host", () => {
    expect(isPiLocalModel("piAgent", "omlx/Some-Model-35B")).toBe(true);
    expect(isPiLocalModel("piAgent", "ollama/llama3")).toBe(true);
    expect(isPiLocalModel("piAgent", "lmstudio/qwen")).toBe(true);
  });

  it("is never a cloud model, another engine or a bare name", () => {
    expect(isPiLocalModel("piAgent", "anthropic/claude-sonnet-5")).toBe(false);
    expect(isPiLocalModel("piAgent", "openai/gpt-5")).toBe(false);
    expect(isPiLocalModel("claudeAgent", "omlx/Some-Model-35B")).toBe(false);
    expect(isPiLocalModel("piAgent", "Some-Model-35B")).toBe(false);
    expect(isPiLocalModel("piAgent", "/omlx")).toBe(false);
    expect(isPiLocalModel(undefined, "omlx/x")).toBe(false);
    expect(isPiLocalModel("piAgent", null)).toBe(false);
  });
});

describe("piLocalKeyRefusalLifted (#1422): the selection judged, never the bot's own", () => {
  it("keeps the missing-key refusal of a cloud candidate on pi, whatever the bot's own model", () => {
    // a bot on omlx/x whose candidate (a viewer's pick, a backup, Auto) is a cloud pi model
    expect(piLocalKeyRefusalLifted("no_credentials", { driverKind: "piAgent", model: "anthropic/claude-sonnet-5" })).toBe(false);
    expect(piLocalKeyRefusalLifted("no_credentials", { driverKind: "piAgent", model: "xai/grok-5" })).toBe(false);
  });

  it("lifts it for a local candidate, whatever the bot's own model", () => {
    expect(piLocalKeyRefusalLifted("no_credentials", { driverKind: "piAgent", model: "omlx/Some-Model-35B" })).toBe(true);
  });

  it("never lifts any other refusal", () => {
    for (const cause of ["payer_disabled", "server_engine_not_allowed", undefined]) {
      expect(piLocalKeyRefusalLifted(cause, { driverKind: "piAgent", model: "omlx/Some-Model-35B" })).toBe(false);
    }
  });

  it("is never fed the bot's own model by the server (source guard)", () => {
    const source = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/piLocalModel\(\{[^}]*bot\.modelSelection/);
    expect(source).not.toMatch(/piLocalKeyRefusalLifted\([^)]*bot\.modelSelection/);
    // each exemption takes the judged model as a parameter
    expect(source).toMatch(/function orgEngineRefusal\([^)]*model: string \| null \| undefined\)/);
    expect(source).toMatch(/async function orgTurnAccess\([^)]*model: string \| null \| undefined\)/);
  });
});

describe("isPiServedModel (#2024)", () => {
  it("is a local host or a Perspicax model server on pi", () => {
    expect(isPiModelServerModel("piAgent", "px-org-acme-models/example-27b")).toBe(true);
    expect(isPiModelServerModel("piAgent", "px-own-acme/m")).toBe(true);
    expect(isPiModelServerModel("piAgent", "px-other/m")).toBe(false);
    expect(isPiModelServerModel("codex", "px-org-acme/m")).toBe(false);
    expect(isPiServedModel("piAgent", "omlx/Some-Model")).toBe(true);
    expect(isPiServedModel("piAgent", "px-org-acme/m")).toBe(true);
    expect(isPiServedModel("piAgent", "openai/gpt-5")).toBe(false);
  });
});
