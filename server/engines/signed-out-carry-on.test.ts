// #3315: a signed-out engine's turns start on a backup the person chose, for
// that turn only; the conversation keeps its own model.
import { describe, expect, it } from "vitest";
import { signedOutCarryOn } from "./signed-out-carry-on.ts";

const claude = { instanceId: "claude", model: "opus" };
const codex = { instanceId: "codex", model: "gpt" };
const grok = { instanceId: "grok", model: "grok-4" };

describe("signed-out carry-on", () => {
  it("runs the turn on the first chosen backup that may take it", () => {
    const picked = signedOutCarryOn({
      selection: claude, backups: [codex, grok], held: (id) => id === "claude", usable: (backup) => backup.instanceId === "grok" ? { ...backup, effort: "high" } : null,
    });
    expect(picked).toEqual({ instanceId: "grok", model: "grok-4", effort: "high" });
  });

  it("leaves a turn whose engine is signed in where it is", () => {
    expect(signedOutCarryOn({ selection: claude, backups: [codex], held: () => false, usable: (backup) => backup })).toBeNull();
  });

  it("never carries on with the signed-out engine itself or another one signed out", () => {
    expect(signedOutCarryOn({
      selection: claude, backups: [{ instanceId: "claude", model: "sonnet" }, codex], held: () => true, usable: (backup) => backup,
    })).toBeNull();
  });

  it("tries the engine as usual when no chosen backup can take the turn, and leaves Auto to its own pick", () => {
    expect(signedOutCarryOn({ selection: claude, backups: [], held: () => true, usable: (backup) => backup })).toBeNull();
    expect(signedOutCarryOn({ selection: { ...claude, auto: true }, backups: [codex], held: (id) => id === "claude", usable: (backup) => backup })).toBeNull();
  });
});
