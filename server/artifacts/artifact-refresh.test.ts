import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createArtifactRefresher } from "./artifact-refresh.ts";
import { createArtifactStore, type ArtifactRun } from "./artifacts.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { ARTIFACT_LIMITS, type Artifact } from "../../shared/artifacts.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) void removeTempDir(dir); });

function setup(answer: (artifact: Artifact) => Promise<ArtifactRun> | ArtifactRun = () => ({ ok: true, value: { n: 1 } })) {
  const dir = mkdtempSync(join(tmpdir(), "omb-artifact-refresh-"));
  dirs.push(dir);
  let clock = 1_000_000;
  const store = createArtifactStore({ file: join(dir, "artifacts.json"), now: () => clock });
  const runs: string[] = [];
  const refresher = createArtifactRefresher({
    store,
    now: () => clock,
    run: async (artifact) => { runs.push(artifact.id); return answer(artifact); },
  });
  const make = (fields: Record<string, unknown> = {}) => {
    const made = store.create("bot-a", "t1", { title: "T", html: "<p>", source: { kind: "tool", tool: "srv__stats" }, interval_seconds: 60, ...fields });
    if (!made.ok) throw new Error(made.error);
    return made.artifact;
  };
  return { store, refresher, runs, make, advance: (ms: number) => { clock += ms; } };
}

describe("artifact refresher", () => {
  it("runs nothing nobody looks at; a watch lease or a favorite makes it due", async () => {
    const { refresher, runs, make, store } = setup();
    const hidden = make();
    const watched = make();
    const favorite = make({ favorite: true });
    refresher.watch([watched.id]);
    await refresher.tick();
    expect(runs.sort()).toEqual([watched.id, favorite.id].sort());
    expect(runs).not.toContain(hidden.id);
    expect(store.get(watched.id)).toMatchObject({ data: { value: { n: 1 } }, refresh: { state: "ok" } });
  });

  it("waits for the interval, and the lease runs out", async () => {
    const { refresher, runs, make, advance } = setup();
    const artifact = make();
    refresher.watch([artifact.id]);
    await refresher.tick();
    advance(30_000);
    await refresher.tick();
    expect(runs).toHaveLength(1);
    advance(31_000);
    await refresher.tick();
    expect(runs).toHaveLength(2);
    // 61 s since the lease: it lapsed at 90 s
    advance(60_000);
    await refresher.tick();
    expect(runs).toHaveLength(2);
  });

  it("pauses after the failure limit and stays paused until Refresh now", async () => {
    let fail = true;
    const { refresher, runs, make, advance, store } = setup(() => fail ? { ok: false, error: "down" } : { ok: true, value: 2 });
    const artifact = make({ favorite: true });
    for (let index = 0; index < ARTIFACT_LIMITS.maxFailures; index += 1) {
      await refresher.tick();
      advance(60_000);
    }
    expect(store.get(artifact.id)?.refresh).toMatchObject({ state: "paused", failures: ARTIFACT_LIMITS.maxFailures, error: "down" });
    await refresher.tick();
    expect(runs).toHaveLength(ARTIFACT_LIMITS.maxFailures);
    fail = false;
    expect(await refresher.refreshNow(artifact.id)).toMatchObject({ refresh: { state: "ok", failures: 0 }, data: { value: 2 } });
  });

  it("a blocked source counts no failure and is checked again on its interval", async () => {
    const { refresher, runs, make, advance, store } = setup(() => ({ ok: false, blocked: true, error: "needs approval" }));
    const artifact = make({ favorite: true });
    await refresher.tick();
    advance(60_000);
    await refresher.tick();
    expect(runs).toHaveLength(2);
    expect(store.get(artifact.id)?.refresh).toMatchObject({ state: "blocked", failures: 0, error: "needs approval" });
  });

  it("runs at most two at once, oldest first, and never the same artifact twice", async () => {
    const gates: Array<() => void> = [];
    const { refresher, runs, make } = setup(() => new Promise<ArtifactRun>((resolve) => { gates.push(() => resolve({ ok: true, value: 1 })); }));
    const ids = [make({ favorite: true }), make({ favorite: true }), make({ favorite: true })].map((artifact) => artifact.id);
    const pass = refresher.tick();
    await Promise.resolve();
    expect(runs).toHaveLength(2);
    void refresher.tick();
    await Promise.resolve();
    expect(runs).toHaveLength(2);
    for (const open of gates) open();
    await pass;
    const last = refresher.tick();
    await Promise.resolve();
    expect(runs).toHaveLength(3);
    expect(new Set(runs)).toEqual(new Set(ids));
    for (const open of gates) open();
    await last;
  });

  it("gives up on a source past its time limit, and records nothing for a deleted artifact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-artifact-refresh-"));
    dirs.push(dir);
    const store = createArtifactStore({ file: join(dir, "artifacts.json") });
    const made = store.create("bot-a", undefined, { title: "T", html: "<p>", source: { kind: "command", command: "sleep 99" }, interval_seconds: 60, favorite: true });
    if (!made.ok) throw new Error("create");
    const slow = createArtifactRefresher({ store, timeoutMs: 20, run: () => new Promise(() => {}) });
    expect((await slow.refreshNow(made.artifact.id))?.refresh).toMatchObject({ state: "error", error: "The source took longer than 30 seconds." });
    let finish: (run: ArtifactRun) => void = () => {};
    const late = createArtifactRefresher({ store, run: () => new Promise((resolve) => { finish = resolve; }) });
    const pending = late.refreshNow(made.artifact.id);
    store.remove(made.artifact.id);
    finish({ ok: true, value: 1 });
    expect(await pending).toBeNull();
  });
});
