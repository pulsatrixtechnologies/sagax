// An install of a plugin with hundreds of skills and files used to hold the
// server's event loop for seconds (a skill at a time, each reading and
// writing the whole library index, then two synchronous copies of the tree),
// so the whole app froze on "+". The install now gives the loop back, and
// two installs at once keep every skill.
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallationPlugins } from "./installation-plugins.ts";
import { PluginMarketplaces } from "./plugin-marketplaces.ts";
import { installLibrarySkills, readSkillLibraryIndex } from "../skills/skill-library.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const skillText = (name: string) => `---\nname: ${name}\ndescription: Skill ${name}\n---\n${"Step.\n".repeat(50)}`;

/** timer ticks that ran while `work` was pending: none when it held the loop */
async function ticksDuring(work: () => Promise<unknown>): Promise<number> {
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 1);
  try { await work(); } finally { clearInterval(timer); }
  return ticks;
}

describe("a plugin install does not hold the server", () => {
  it("gives the loop back while hundreds of skills are added, and two installs at once keep every skill", async () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-install-skills-")); roots.push(root);
    const inputs = (prefix: string) => Array.from({ length: 150 }, (_, index) => ({ name: `${prefix}-${index}`, instructions: skillText(`${prefix}-${index}`), source: "catalog", reviewState: "disabled" as const, root }));
    let first: Awaited<ReturnType<typeof installLibrarySkills>> = [];
    let second: Awaited<ReturnType<typeof installLibrarySkills>> = [];
    // Make the install cross multiple time slices even on a fast filesystem.
    // The competing callback still has to run on the real event loop.
    let elapsed = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => ++elapsed);
    let turns = 0;
    const observeTurn = () => { turns++; observer = setImmediate(observeTurn); };
    let observer = setImmediate(observeTurn);
    try {
      [first, second] = await Promise.all([installLibrarySkills(inputs("alpha")), installLibrarySkills(inputs("beta"))]);
    } finally {
      clearImmediate(observer);
      clock.mockRestore();
    }
    expect(turns).toBeGreaterThan(2);
    expect(first.every((result) => !("error" in result))).toBe(true);
    expect(second.every((result) => !("error" in result))).toBe(true);
    expect(Object.keys(readSkillLibraryIndex(root))).toHaveLength(300);
  }, 60_000);

  it("copies a plugin's tree into the organization copy without holding the loop", async () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-install-copy-")); roots.push(root);
    const marketplaces = new PluginMarketplaces({ dataDir: root, policy: () => undefined, gitEnvironment: () => ({}) });
    const raw = marketplaces.pluginDir("catalog", "library");
    mkdirSync(join(raw, ".claude-plugin"), { recursive: true });
    writeFileSync(join(raw, ".claude-plugin/plugin.json"), JSON.stringify({ name: "library" }));
    for (let skill = 0; skill < 200; skill++) {
      const folder = join(raw, "skills", `skill-${skill}`);
      mkdirSync(join(folder, "references"), { recursive: true });
      writeFileSync(join(folder, "SKILL.md"), skillText(`skill-${skill}`));
      writeFileSync(join(folder, "references", "page.md"), "Reference.\n".repeat(100));
    }
    const record = await marketplaces.recordInstall("catalog", "library", { servers: [], skills: [] });
    const plugins = new InstallationPlugins(root, marketplaces);
    const ticks = await ticksDuring(() => plugins.refresh(record));
    expect(ticks).toBeGreaterThan(2);
    expect(existsSync(join(plugins.folder(record.key)!.dir, "skills", "skill-199", "references", "page.md"))).toBe(true);
  }, 60_000);
});
