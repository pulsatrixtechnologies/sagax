import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ARTIFACT_VERSION_CAP, parseVersionList } from "./artifact-versions.ts";
import { createArtifactStore } from "./artifacts.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) removeTempDir(dir); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-artifact-versions-"));
  dirs.push(dir);
  const file = join(dir, "artifacts.json");
  let clock = 1_000;
  const open = () => createArtifactStore({ file, now: () => clock });
  return { file, open, tick: (ms = 1) => { clock += ms; } };
}

const widget = { title: "Board", html: "<p>one</p>" };

describe("artifact version history", () => {
  it("keeps a document when it changes, and ignores flags and refresh results", () => {
    const { open, tick } = setup();
    const store = open();
    const made = store.create("bot-a", "t1", { ...widget, source: { kind: "command", command: "date" }, interval_seconds: 30 });
    if (!made.ok) throw new Error("create");
    const id = made.artifact.id;
    expect(store.versions(id)).toEqual([]);
    tick();
    store.setFlags(id, { favorite: true });
    store.recordRun(id, { ok: true, value: { n: 1 } });
    expect(store.versions(id)).toEqual([]);
    tick();
    const renamed = store.update("bot-a", id, { title: "Board 2", html: "<p>two</p>" });
    expect(renamed.ok).toBe(true);
    expect(store.versions(id)).toMatchObject([{ title: "Board", html: "<p>one</p>" }]);
    expect(store.update("bot-b", id, { title: "nope" })).toMatchObject({ ok: false, status: 404 });
    expect(store.versions(id)).toHaveLength(1);
  });

  it("restores in one file replace and keeps the displaced document", () => {
    const { file, open, tick } = setup();
    const store = open();
    const made = store.create("bot-a", undefined, widget);
    if (!made.ok) throw new Error("create");
    const id = made.artifact.id;
    tick();
    store.update("bot-a", id, { html: "<p>two</p>" });
    tick();
    const restored = store.restore("bot-a", id, 1);
    expect(restored).toMatchObject({ ok: true, artifact: { html: "<p>one</p>", title: "Board" } });
    if (!restored.ok) return;
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as { artifacts: { html: string }[]; history: Record<string, { html: string }[]> };
    expect(onDisk.artifacts.map((item) => item.html)).toEqual(["<p>one</p>"]);
    expect(onDisk.history[id]?.map((item) => item.html).sort()).toEqual(["<p>one</p>", "<p>two</p>"]);
    const again = open();
    expect(again.get(id)?.html).toBe("<p>one</p>");
    expect(again.versions(id).map((item) => item.html).sort()).toEqual(["<p>one</p>", "<p>two</p>"]);
    expect(again.restore("bot-b", id, 1)).toMatchObject({ ok: false, status: 404 });
    expect(again.get(id)?.html).toBe("<p>one</p>");
    expect(again.restore("bot-a", id, 1).ok && again.get(id)?.rev).toBe(restored.artifact.rev);
  });

  it("drops the oldest document past the cap, and drops history when the artifact is deleted", () => {
    const { open, tick } = setup();
    const store = open();
    const made = store.create("bot-a", undefined, widget);
    if (!made.ok) throw new Error("create");
    const id = made.artifact.id;
    for (let index = 0; index < ARTIFACT_VERSION_CAP + 2; index += 1) {
      tick();
      store.update("bot-a", id, { title: `Board ${index}` });
    }
    const versions = store.versions(id);
    expect(versions).toHaveLength(ARTIFACT_VERSION_CAP);
    expect(versions[0]?.title).toBe("Board 1");
    expect(store.remove(id, "bot-a")).toBe(true);
    expect(store.versions(id)).toEqual([]);
    expect(parseVersionList([{ rev: 1, at: 1, title: "ok", html: "<p>" }, { rev: "no" }])).toHaveLength(1);
  });
});
