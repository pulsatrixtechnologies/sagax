// #3643: the first listing of the plugin marketplaces after a start read
// and hashed every installed plugin's folder in one synchronous stretch
// (1.5 s on a server). The offered revisions are now read in slices, ahead
// of the listing, and keep the exact value stored with each installed plugin.
import * as fs from "node:fs";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", { spy: true });

import { readMarketplaceManifest } from "../bots/bot-plugins.ts";
import { notePluginFolderChanged } from "../sandbox/sandbox-plugin-digests.ts";
import { readFolderSliced, SLICE_BYTES, SLICE_FILES } from "../sandbox/sandbox-workspace-copy.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { PluginMarketplaces, pluginRevision } from "./plugin-marketplaces.ts";

/** The revision digest as main computed it before #3643, kept verbatim: the
 * value stored with every installed plugin. */
function folderDigest(root: string): string {
  const hash = createHash("sha256");
  let files = 0;
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git" || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path, relative);
      else if (entry.isFile() && ++files <= 5000) hash.update(`${relative}\0`).update(readFileSync(path)).update("\0");
    }
  };
  walk(root, "");
  return hash.digest("hex");
}

const root = mkdtempSync(join(tmpdir(), "sagax-plugin-revisions-"));
afterAll(() => removeTempDir(root));
let count = 0;
const fresh = (name: string) => join(root, `${name}-${++count}`);

function write(dir: string, files: Record<string, string | Buffer>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

/** Every open or whole read of a file under a generated plugin folder. */
function pluginReads(): number {
  const paths = [...vi.mocked(fs.openSync).mock.calls, ...vi.mocked(fs.readFileSync).mock.calls].map(([path]) => String(path));
  return paths.filter((path) => path.includes(`${sep}plugins${sep}tool-`)).length;
}

/** The plugin files read between two turns of the event loop's check phase,
 * at most: one slice, and what the slice before it had left (a read that
 * starts in the I/O phase between them spends it). */
function watchLoop() {
  let running = true;
  let last = pluginReads();
  let longest = 0;
  let turns = 0;
  const tick = () => {
    const now = pluginReads();
    longest = Math.max(longest, now - last);
    last = now;
    turns += 1;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  return { stop: () => { running = false; tick(); return { longest, turns }; } };
}

const MARKETS = ["a", "b", "c", "d"];
const PLUGINS = 10;
const FILES = 100;

/** 4 marketplaces, 40 plugins, 4,000 files. */
function generatedSources(): string {
  const base = fresh("sources");
  for (const market of MARKETS) {
    const repo = join(base, market);
    const plugins = Array.from({ length: PLUGINS }, (_, index) => ({ name: `tool-${index}`, source: `./plugins/tool-${index}`, version: "1.0.0" }));
    write(repo, { ".claude-plugin/marketplace.json": JSON.stringify({ name: `market-${market}`, owner: { name: "Owner" }, plugins }) });
    for (let plugin = 0; plugin < PLUGINS; plugin += 1) {
      const files: Record<string, string> = {};
      for (let file = 0; file < FILES; file += 1) files[`plugins/tool-${plugin}/part-${file % 5}/file-${file}.md`] = `${market} ${plugin} ${file}\n`.repeat(40);
      write(repo, files);
    }
  }
  return base;
}

function store(dataDir: string, sources: string): PluginMarketplaces {
  return new PluginMarketplaces({
    dataDir,
    gitEnvironment: () => ({}),
    policy: () => undefined,
    now: () => 1_000,
    git: async (args) => { cpSync(join(sources, args.at(-2)!.replace(/^.*\/market-(\w)\.git$/, "$1")), args.at(-1)!, { recursive: true }); },
  });
}

/** A server whose plugins were all installed by an earlier run, as it starts. */
async function startedServer() {
  const sources = generatedSources();
  const dataDir = fresh("data");
  const before = store(dataDir, sources);
  for (const market of MARKETS) await before.add({ source: `acme/market-${market}` }, undefined);
  const expected = new Map<string, string>();
  for (const market of MARKETS) {
    for (const entry of readMarketplaceManifest(before.repoPath(`market-${market}`)).plugins) {
      const revision = `sha256:${folderDigest(join(before.repoPath(`market-${market}`), entry.source.kind === "path" ? entry.source.path : ""))}`;
      expected.set(`${entry.name}@market-${market}`, revision);
      before.recordInstall(`market-${market}`, entry.name, { version: "1.0.0", revision, servers: [], skills: [] });
    }
  }
  // the reads each Add started are over; then a new process: nothing of
  // the folders is remembered
  await before.warmRevisions();
  notePluginFolderChanged(dataDir);
  return { markets: store(dataDir, sources), expected, sources };
}

describe("marketplace plugin revisions (#3643)", () => {
  it("keep the value main stored: .git, links, locale order and the 5,000 file cap", async () => {
    const odd = fresh("odd");
    write(odd, {
      "B.md": "upper", "a.md": "lower", "_under.md": "under", "é.md": "accent", "e.md": "plain", "10.md": "ten", "9.md": "nine", "Z/z.md": "zed",
      ".git/HEAD": "ref: main", ".git/objects/x": "object", "nested/.git": "gitdir: elsewhere", "nested/keep.md": "kept",
    });
    symlinkSync(join(odd, "a.md"), join(odd, "link.md"));
    symlinkSync(join(odd, "Z"), join(odd, "dir-link"));
    const many = fresh("many");
    const files: Record<string, string> = {};
    for (let index = 0; index < 5_050; index += 1) files[`${["Beta", "alpha", "_x"][index % 3]}/f-${index}.txt`] = `file ${index}\n`;
    write(many, files);
    for (const dir of [odd, many]) {
      expect((await readFolderSliced(dir)).revision).toBe(folderDigest(dir));
    }
    // through a marketplace, as stored with an installed plugin
    const repo = fresh("repo");
    cpSync(odd, join(repo, "plugins", "odd"), { recursive: true, verbatimSymlinks: true });
    const entry = { name: "odd", source: { kind: "path" as const, path: "./plugins/odd" } };
    expect(await pluginRevision(repo, entry as Parameters<typeof pluginRevision>[1])).toBe(`sha256:${folderDigest(join(repo, "plugins", "odd"))}`);
  }, 60_000);

  it("a listing right after a start never reads more than a slice of files between two turns of the loop, and every revision is right", async () => {
    const { markets, expected } = await startedServer();
    const readsBefore = pluginReads();
    const loop = watchLoop();
    const warming = markets.warmRevisions();
    const listing = await markets.list();
    await warming;
    const { longest } = loop.stop();
    expect(longest).toBeLessThanOrEqual(2 * SLICE_FILES);
    expect(listing.flatMap((market) => market.plugins)).toHaveLength(MARKETS.length * PLUGINS);
    for (const market of listing) {
      for (const plugin of market.plugins) {
        expect(plugin).toMatchObject({ installed: true });
        expect(plugin).not.toHaveProperty("updateAvailable");
      }
    }
    for (const [key, revision] of expected) {
      const [plugin, market] = key.split("@") as [string, string];
      const entry = readMarketplaceManifest(markets.repoPath(market)).plugins.find((candidate) => candidate.name === plugin)!;
      expect(await markets.revisionOf(market, entry)).toBe(revision);
    }
    // each file was read once, though the warm-up and the listing both asked
    expect(pluginReads() - readsBefore).toBe(MARKETS.length * PLUGINS * FILES);
  }, 120_000);

  it("a listing asked while the revisions are worked out waits and answers once, complete", async () => {
    const { markets } = await startedServer();
    const warming = markets.warmRevisions();
    const answers: Array<Awaited<ReturnType<PluginMarketplaces["list"]>>> = [];
    const asked = markets.list().then((listing) => { answers.push(listing); });
    await new Promise((resolve) => setImmediate(resolve));
    expect(answers).toEqual([]);
    await asked;
    await warming;
    expect(answers).toHaveLength(1);
    expect(answers[0]!.flatMap((market) => market.plugins).every((plugin) => plugin.installed && !("updateAvailable" in plugin))).toBe(true);
  }, 120_000);

  it("a replaced clone gives new revisions without a restart", async () => {
    const { markets, sources } = await startedServer();
    await markets.warmRevisions();
    write(join(sources, "a"), { "plugins/tool-3/part-0/file-0.md": "changed\n" });
    await markets.refresh("market-a", undefined);
    const listing = await markets.list();
    const updated = listing.flatMap((market) => market.plugins.filter((plugin) => plugin.updateAvailable).map((plugin) => `${plugin.name}@${market.name}`));
    expect(updated).toEqual(["tool-3@market-a"]);
    const entry = readMarketplaceManifest(markets.repoPath("market-a")).plugins.find((candidate) => candidate.name === "tool-3")!;
    expect(await markets.revisionOf("market-a", entry)).toBe(`sha256:${folderDigest(join(markets.repoPath("market-a"), "plugins", "tool-3"))}`);
  }, 120_000);

  it("gives the loop back while it hashes a single 64 MB file", async () => {
    const dir = fresh("large");
    const size = 64 * 1024 * 1024;
    write(dir, { "plugins/tool-large/blob.bin": Buffer.alloc(size, 7) });
    const loop = watchLoop();
    const read = await readFolderSliced(join(dir, "plugins", "tool-large"));
    const { turns } = loop.stop();
    expect(turns).toBeGreaterThanOrEqual(size / SLICE_BYTES - 1);
    expect(read.revision).toBe(folderDigest(join(dir, "plugins", "tool-large")));
  }, 60_000);
});
