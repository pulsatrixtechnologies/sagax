import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { NO_ENGINE_MESSAGE, engineProblem, namesEngine } from "./bot-engine.ts";
import { Store } from "./store.ts";

describe("a bot's engine", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("names an engine only with a non-blank instance id", () => {
    expect(namesEngine({ instanceId: "claude" })).toBe(true);
    expect(namesEngine({ instanceId: "" })).toBe(false);
    expect(namesEngine({ instanceId: "  " })).toBe(false);
    expect(namesEngine(undefined)).toBe(false);
  });

  it("a bot created with an empty engine gets the default, never an empty id", () => {
    const store = new Store(() => ({ instanceId: "claude", model: "m" }));
    for (const requested of [{ instanceId: "", model: "" }, { instanceId: " ", model: "x" }, { instanceId: "", model: "x", auto: true as const }]) {
      expect(store.createBot({ name: `B${requested.model}${requested.instanceId.length}`, modelSelection: requested }, { seedMessages: false }).modelSelection.instanceId).toBe("claude");
    }
    expect(store.createBot({ name: "Kept", modelSelection: { instanceId: "codex", model: "c" } }, { seedMessages: false }).modelSelection.instanceId).toBe("codex");
  });

  it("explains a missing or removed engine in plain words", () => {
    expect(engineProblem({ instanceId: "" }, () => true)).toBe(NO_ENGINE_MESSAGE);
    expect(engineProblem({ instanceId: "gone" }, () => false)).toContain("plus disponible");
    expect(engineProblem({ instanceId: "claude" }, () => true)).toBeUndefined();
    expect(NO_ENGINE_MESSAGE).toBe("Ce bot n'a pas de moteur : choisis-en un dans Modifier le bot > Modèle");
  });
});
