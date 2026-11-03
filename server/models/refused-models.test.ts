import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RefusedModelsStore } from "./refused-models.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("#1696 refused conversation models", () => {
  it("keeps a refused model out after a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "refused-models-"));
    dirs.push(dir);
    const file = join(dir, "refused-models.json");
    const first = new RefusedModelsStore({ file, now: () => 1_000 });
    first.remember("openai", "gpt-6.1-terra");
    first.remember("openai", "gpt-6.1-terra");
    expect([...first.refused("openai")]).toEqual(["gpt-6.1-terra"]);
    expect(first.refused("claude").size).toBe(0);

    const again = new RefusedModelsStore({ file });
    expect([...again.refused("openai")]).toEqual(["gpt-6.1-terra"]);
  });

  it("stays in memory when no file is set", () => {
    const store = new RefusedModelsStore({ file: null });
    store.remember("openai", "gpt-bad");
    expect(store.refused("openai").has("gpt-bad")).toBe(true);
  });
});
