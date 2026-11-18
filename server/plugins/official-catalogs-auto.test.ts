// Outside an organization every official catalog is added on its own, in the
// background; a failure retries later and shows per catalog; a removed one is
// not added again.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OFFICIAL_CATALOGS } from "../../shared/skill-catalogs.ts";
import { OFFICIAL_AUTO_RETRY_MS, startOfficialCatalogsAuto } from "./official-catalogs-auto.ts";
import { PluginMarketplaces } from "./plugin-marketplaces.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sagax-official-auto-")); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

const quiet = () => {};

describe("startOfficialCatalogsAuto", () => {
  it("adds every missing official catalog once, and none inside an organization", async () => {
    const have = new Set<string>();
    const added: string[] = [];
    const run = (enabled: boolean) => startOfficialCatalogsAuto({
      enabled: () => enabled, sources: () => have, dismissed: () => [], log: quiet,
      add: async (catalog) => { added.push(catalog.id); have.add(catalog.source.toLowerCase()); },
    });
    const org = run(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(added).toEqual([]);
    org.stop();
    const solo = run(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(added).toEqual(OFFICIAL_CATALOGS.map((catalog) => catalog.id));
    await solo.run();
    expect(added).toHaveLength(OFFICIAL_CATALOGS.length);
    solo.stop();
  });

  it("adds only the new catalog of a later version and skips a removed one", async () => {
    const [first, second, ...rest] = OFFICIAL_CATALOGS;
    const have = new Set([first!.source.toLowerCase()]);
    const added: string[] = [];
    const auto = startOfficialCatalogsAuto({
      enabled: () => true, sources: () => have, dismissed: () => [second!.id], log: quiet,
      add: async (catalog) => { added.push(catalog.id); },
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(added).toEqual(rest.map((catalog) => catalog.id));
    auto.stop();
  });

  it("keeps a failure on its catalog and retries later", async () => {
    const have = new Set<string>();
    let fail = true;
    const auto = startOfficialCatalogsAuto({
      enabled: () => true, sources: () => have, dismissed: () => [], log: quiet,
      add: async (catalog) => {
        if (catalog.id === "openclaw" && fail) throw new Error("offline");
        have.add(catalog.source.toLowerCase());
      },
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(auto.errors()).toEqual({ openclaw: "offline" });
    fail = false;
    await vi.advanceTimersByTimeAsync(OFFICIAL_AUTO_RETRY_MS + 1);
    expect(auto.errors()).toEqual({});
    expect(have.has("openclaw/openclaw")).toBe(true);
    auto.stop();
  });
});

describe("removing an official catalog", () => {
  it("is remembered so the automatic add does not bring it back", async () => {
    const markets = new PluginMarketplaces({
      dataDir: join(dir, "data"), gitEnvironment: () => ({}), policy: () => undefined, now: () => 1_000,
      git: async (args) => {
        const into = args.at(-1)!;
        const repo = join(dir, "repo");
        mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
        writeFileSync(join(repo, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "claude-plugins-official", owner: { name: "x" }, plugins: [] }));
        cpSync(repo, into, { recursive: true });
      },
    });
    await markets.add({ source: "anthropics/claude-plugins-official" }, undefined);
    expect(markets.sources().has("anthropics/claude-plugins-official")).toBe(true);
    await markets.remove("claude-plugins-official");
    expect(markets.dismissedOfficial()).toEqual(["claude-plugins-official"]);
    expect(markets.sources().size).toBe(0);
  });
});
