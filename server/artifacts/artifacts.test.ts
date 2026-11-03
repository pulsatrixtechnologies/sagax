import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createArtifactStore } from "./artifacts.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { ARTIFACT_LIMITS, summarizeArtifact, type ArtifactsFrame } from "../../shared/artifacts.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) removeTempDir(dir); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "omb-artifacts-"));
  dirs.push(dir);
  const file = join(dir, "artifacts.json");
  let clock = 1_000;
  const frames: ArtifactsFrame[] = [];
  const open = () => createArtifactStore({ file, now: () => clock, onChange: (frame) => frames.push(frame) });
  return { file, frames, open, tick: (ms = 1) => { clock += ms; } };
}

const widget = { title: "Open tickets", html: "<div id=n></div>" };

describe("artifact store", () => {
  it("creates an artifact for its bot, saves it 0600 and says so live", () => {
    const { file, frames, open } = setup();
    const store = open();
    const made = store.create("bot-a", "t1", { ...widget, source: { kind: "tool", tool: "cw_psa_query", args: { resource: "tickets" } }, interval_seconds: 60 });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.artifact).toMatchObject({ botId: "bot-a", threadId: "t1", title: "Open tickets", favorite: false, popped: false, rev: 1, intervalSeconds: 60, refresh: { state: "idle", failures: 0 } });
    expect(made.artifact.id).toMatch(/^art_/);
    // Windows has no Unix mode bits (Node reports 0o666)
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(frames).toEqual([{ kind: "artifacts", botId: "bot-a", artifactId: made.artifact.id }]);
    // survives a restart
    expect(open().get(made.artifact.id)).toEqual(made.artifact);
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1);
  });

  it("refuses a bad title, an empty widget, an interval without a source and too many artifacts", () => {
    const { open } = setup();
    const store = open();
    expect(store.create("b", undefined, { html: "<p>" })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("title") });
    expect(store.create("b", undefined, { title: "x", html: "  " })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("html") });
    expect(store.create("b", undefined, { ...widget, interval_seconds: 60 })).toMatchObject({ ok: false, status: 400, error: "interval_seconds needs a source to re-run." });
    expect(store.create("b", undefined, { ...widget, source: { kind: "tool", tool: "x" }, interval_seconds: 5 })).toMatchObject({ ok: false, error: expect.stringContaining("interval_seconds") });
    expect(store.create("b", undefined, { ...widget, source: { kind: "shell" } })).toMatchObject({ ok: false, error: "source.kind: tool or command." });
    for (let index = 0; index < ARTIFACT_LIMITS.perBot; index += 1) expect(store.create("b", undefined, widget).ok).toBe(true);
    expect(store.create("b", undefined, widget)).toMatchObject({ ok: false, status: 409 });
    expect(store.create("other", undefined, widget).ok).toBe(true);
  });

  it("lets a bot change only its own artifacts, and clears a source with null", () => {
    const { open, tick } = setup();
    const store = open();
    const made = store.create("bot-a", undefined, { ...widget, source: { kind: "command", command: "date" }, interval_seconds: 30 });
    if (!made.ok) throw new Error("create");
    const id = made.artifact.id;
    expect(store.update("bot-b", id, { title: "Mine now" })).toMatchObject({ ok: false, status: 404 });
    tick();
    const updated = store.update("bot-a", id, { title: "Renamed", favorite: true, popped: true, bounds: { x: 10, y: 20, width: 50, height: 9000 } });
    expect(updated).toMatchObject({ ok: true, artifact: { title: "Renamed", favorite: true, popped: true, rev: 2, bounds: { x: 10, y: 20, width: ARTIFACT_LIMITS.minWidth, height: ARTIFACT_LIMITS.maxSide } } });
    const cleared = store.update("bot-a", id, { source: null });
    expect(cleared.ok && cleared.artifact.source).toBeUndefined();
    expect(cleared.ok && cleared.artifact.intervalSeconds).toBeUndefined();
    expect(store.remove(id, "bot-b")).toBe(false);
    expect(store.remove(id, "bot-a")).toBe(true);
    expect(store.get(id)).toBeNull();
  });

  it("the person changes favorite and popped, nothing else", () => {
    const { open } = setup();
    const store = open();
    const made = store.create("bot-a", undefined, widget);
    if (!made.ok) throw new Error("create");
    expect(store.setFlags(made.artifact.id, {})).toMatchObject({ ok: false, status: 400 });
    expect(store.setFlags(made.artifact.id, { favorite: true, title: "no" } as never)).toMatchObject({ ok: true, artifact: { favorite: true, title: "Open tickets" } });
    expect(store.setFlags("art_missing00", { popped: true })).toMatchObject({ ok: false, status: 404 });
  });

  it("records runs: data on success, counted failures, a pause after the limit, blocked at once", () => {
    const { open, tick } = setup();
    const store = open();
    const made = store.create("bot-a", undefined, { ...widget, source: { kind: "tool", tool: "t", args: {} }, interval_seconds: 30 });
    if (!made.ok) throw new Error("create");
    const id = made.artifact.id;
    tick(5);
    expect(store.recordRun(id, { ok: true, value: { open: 3 } })).toMatchObject({ data: { at: 1_005, value: { open: 3 } }, refresh: { state: "ok", failures: 0, lastOkAt: 1_005 } });
    for (let index = 1; index < ARTIFACT_LIMITS.maxFailures; index += 1) {
      expect(store.recordRun(id, { ok: false, error: "boom\nwith token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" })?.refresh).toMatchObject({ state: "error", failures: index, lastOkAt: 1_005 });
    }
    const paused = store.recordRun(id, { ok: false, error: "boom" });
    expect(paused?.refresh).toMatchObject({ state: "paused", failures: ARTIFACT_LIMITS.maxFailures });
    expect(paused?.data?.value).toEqual({ open: 3 });
    expect(store.resume(id)?.refresh).toMatchObject({ state: "idle", failures: 0 });
    expect(store.recordRun(id, { ok: false, error: "needs approval", blocked: true })?.refresh.state).toBe("blocked");
    expect(store.recordRun(id, { ok: true, value: "x".repeat(ARTIFACT_LIMITS.data + 10) })?.refresh.state).toBe("error");
  });

  it("scrubs a failure before it is kept", () => {
    const { open } = setup();
    const store = open();
    const made = store.create("bot-a", undefined, { ...widget, source: { kind: "tool", tool: "t" }, interval_seconds: 30 });
    if (!made.ok) throw new Error("create");
    const error = store.recordRun(made.artifact.id, { ok: false, error: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEF" })?.refresh.error ?? "";
    expect(error).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789ABCDEF");
  });

  it("forgets a deleted bot's artifacts, and a summary leaves the document and data out", () => {
    const { open } = setup();
    const store = open();
    const made = store.create("bot-a", undefined, widget);
    store.create("bot-b", undefined, widget);
    if (!made.ok) throw new Error("create");
    store.recordRun(made.artifact.id, { ok: true, value: 1 });
    const summary = summarizeArtifact(store.get(made.artifact.id)!);
    expect(summary).not.toHaveProperty("html");
    expect(summary).not.toHaveProperty("data");
    expect(summary.dataAt).toEqual(expect.any(Number));
    expect(store.removeBot("bot-a")).toBe(1);
    expect(store.all().map((artifact) => artifact.botId)).toEqual(["bot-b"]);
  });
});
