// #3619: a plugin folder's digest is computed when the folder changes, not
// at every turn, and never by holding the event loop for a large folder.
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";
import { manifestDigest, notePluginFolderChanged, PluginFolderDigests, pluginFolderDigests } from "./sandbox-plugin-digests.ts";
import { pluginDigest } from "./sandbox-plugins.ts";
import { workspaceManifestSliced } from "./sandbox-workspace-copy.ts";

const root = mkdtempSync(join(tmpdir(), "sagax-plugin-digest-"));
afterAll(() => removeTempDir(root));

let count = 0;
function folder(files: number): string {
  const dir = join(root, `plugin-${++count}`);
  for (let index = 0; index < files; index += 1) {
    const sub = join(dir, `d${index % 7}`);
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, `f${index}.txt`), `content ${index}\n`.repeat(20));
  }
  return dir;
}

function counting() {
  const counter = { reads: 0 };
  const digests = new PluginFolderDigests({ compute: async (dir) => { counter.reads += 1; return manifestDigest(await workspaceManifestSliced(dir)); } });
  return { counter, digests };
}

describe("plugin folder digests (#3619)", () => {
  it("gives the digest the environments' markers already hold", async () => {
    const dir = folder(30);
    expect(await pluginFolderDigests.digest(dir)).toBe(pluginDigest(dir));
  });

  it("reads an unchanged folder's files once, and again after any change", async () => {
    const { counter, digests } = counting();
    const dir = folder(12);
    const first = await digests.digest(dir);
    expect(await digests.digest(dir)).toBe(first);
    expect(counter.reads).toBe(1);

    // a file rewritten, one added, one removed, the folder swapped: each is seen
    writeFileSync(join(dir, "d0", "f0.txt"), "changed\n");
    const second = await digests.digest(dir);
    expect(second).not.toBe(first);
    expect(second).toBe(pluginDigest(dir));
    writeFileSync(join(dir, "d1", "added.txt"), "added\n");
    expect(await digests.digest(dir)).toBe(pluginDigest(dir));
    rmSync(join(dir, "d1", "added.txt"));
    expect(await digests.digest(dir)).toBe(second);
    const swapped = folder(3);
    rmSync(dir, { recursive: true });
    renameSync(swapped, dir);
    expect(await digests.digest(dir)).toBe(pluginDigest(dir));
    expect(counter.reads).toBe(5);
  });

  it("a writer's note drops the remembered digest of the folder, inside it and around it", async () => {
    const dir = folder(4);
    const reads = { count: 0 };
    const digests = new PluginFolderDigests({ compute: async (path) => { reads.count += 1; return manifestDigest(await workspaceManifestSliced(path)); } });
    await digests.digest(dir);
    digests.forget(join(dir, "d0"));
    await digests.digest(dir);
    digests.forget(root);
    await digests.digest(dir);
    expect(reads.count).toBe(3);
    // the server's own store, through the writers' call
    await pluginFolderDigests.digest(dir);
    expect(pluginFolderDigests.size).toBeGreaterThan(0);
    notePluginFolderChanged(dir);
    const before = pluginFolderDigests.size;
    await pluginFolderDigests.digest(dir);
    expect(pluginFolderDigests.size).toBe(before + 1);
  });

  it("a write during a computation is never remembered as the folder's digest", async () => {
    const dir = folder(4);
    let hold!: () => void;
    const gate = new Promise<void>((resolve) => { hold = resolve; });
    let reads = 0;
    const digests = new PluginFolderDigests({
      compute: async (path) => { reads += 1; const digest = manifestDigest(await workspaceManifestSliced(path)); if (reads === 1) await gate; return digest; },
    });
    const running = digests.digest(dir);
    await new Promise((resolve) => setTimeout(resolve, 20));
    digests.forget(dir);
    hold();
    await running;
    await digests.digest(dir);
    expect(reads).toBe(2);
  });

  it("gives the event loop back while it reads a large folder", async () => {
    const dir = folder(400);
    let turns = 0;
    let running = true;
    const spin = () => { if (!running) return; turns += 1; setImmediate(spin); };
    setImmediate(spin);
    const manifest = await workspaceManifestSliced(dir, 0);
    running = false;
    expect(manifest.files).toHaveLength(400);
    expect(turns).toBeGreaterThan(100);
  });
});
