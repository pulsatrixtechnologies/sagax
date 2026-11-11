// #3513: a bot that carries the organization's Flow plugin holds the skill a
// watch names, so the watch's domain is offered. Fixture: a plugin laid out
// the way the organization's Flow plugin is (entry skills in `skills/`, the
// product skills in `library/<product>/<domain>/skills/`).
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { pluginTurnInventory } from "../turns/plugin-turn.ts";
import { FlowWatchLoop, WatchMemory, type FlowHelper, type FlowWatchLoopDeps } from "./flow-watches.ts";
import { heldSkillNames, librarySkillNames } from "./held-skills.ts";
import { ProactiveBudget, ProactiveEngine } from "./proactive.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function skill(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: "${name} procedure."\n---\n# ${name}\n`);
}

/** A Flow plugin folder: one entry skill, two library skills. */
function flowPlugin(): string {
  const root = mkdtempSync(join(tmpdir(), "held-skills-"));
  roots.push(root);
  const dir = join(root, "flow-plugin");
  skill(join(dir, "skills", "using-flow"), "using-flow");
  skill(join(dir, "library", "connectwise", "dispatch", "skills", "dispatching-tickets"), "dispatching-tickets");
  skill(join(dir, "library", "global", "skills", "verifying-before-done"), "verifying-before-done");
  // a folder without SKILL.md is not a skill
  mkdirSync(join(dir, "library", "connectwise", "dispatch", "skills", "notes"), { recursive: true });
  return dir;
}

/** The rows of a turn's Skills index for this plugin (the inventory a turn reads). */
function turnRows(dir: string) {
  return pluginTurnInventory([dir], { pathForDir: () => "plugins/flow-plugin" }).files.map((file) => ({ kind: file.kind, name: file.name, enabled: true }));
}

const WATCH = {
  id: "new-tickets", skill: "dispatching-tickets", products: ["connectwise"], domain: "dispatch", summary: "New tickets wait for dispatch.",
  observe: { tool: "cw_psa_service_query", args: { resource: "tickets" } }, when: "length(items) > `0`", cadence: "15m",
  propose: { skill: "dispatching-tickets" }, kind: "write", prompt: "Use dispatching-tickets on the new tickets.", tools: [],
};

function loop(skills: (botId: string, person: string) => ReadonlySet<string>): FlowWatchLoop {
  const helper: FlowHelper = {
    root: "/plugins/flow-plugin",
    proactive: async () => JSON.stringify({ watches: [WATCH], domains: { dispatch: { label: { fr: "Répartition", en: "Dispatch" } } } }),
    reference: async () => JSON.stringify({ topic: "team", body: "" }),
  };
  const deps: FlowWatchLoopDeps = {
    choices: () => [],
    carrier: () => ({ ok: true }),
    skills,
    owner: () => "person-1",
    helper: () => helper,
    session: async (_person, _bot, fn) => fn({
      tools: new Set(), readOnly: new Set(), call: async () => ({ ok: false, error: "unused" }),
      apis: async () => [{ id: "connectwise-psa", name: "ConnectWise PSA" }],
      holdsProfile: async () => true,
    }),
    timeZone: () => "America/New_York",
    engine: new ProactiveEngine({ bot: () => undefined, coveredByRules: () => false, budget: new ProactiveBudget({ minIntervalMs: 0, maxPerWindow: 1, windowMs: 1 }) }),
    offer: () => undefined,
    log: () => undefined,
    pause: () => undefined,
    memory: new WatchMemory(),
  };
  return new FlowWatchLoop(deps);
}

describe("#3513: the skills a bot holds, as a watch names them", () => {
  it("a turn's Skills index lists the Flow plugin's entry skills only: the cause", () => {
    const dir = flowPlugin();
    expect(turnRows(dir).map((row) => row.name)).toEqual(["using-flow"]);
  });

  it("a bot carrying the Flow plugin holds every skill of its library", () => {
    const dir = flowPlugin();
    expect(librarySkillNames(dir)).toEqual(["dispatching-tickets", "verifying-before-done"]);
    const held = heldSkillNames(turnRows(dir), [dir]);
    expect([...held].sort()).toEqual(["dispatching-tickets", "using-flow", "verifying-before-done"]);
  });

  it("a disabled skill of the index is not held; a plugin the bot does not carry adds nothing", () => {
    const dir = flowPlugin();
    expect(heldSkillNames([{ kind: "skill", name: "mine", enabled: false }], []).size).toBe(0);
    expect(heldSkillNames([{ kind: "command", name: "cmd", enabled: true }], [join(dir, "absent")]).size).toBe(0);
  });

  it("a symlinked folder of the library is never followed", () => {
    const dir = flowPlugin();
    const outside = mkdtempSync(join(tmpdir(), "held-skills-out-"));
    roots.push(outside);
    skill(join(outside, "skills", "foreign"), "foreign");
    symlinkSync(outside, join(dir, "library", "linked"));
    expect(librarySkillNames(dir)).not.toContain("foreign");
  });

  it("the watch's domain is offered on a bot that carries the Flow plugin, for a person with the product", async () => {
    const dir = flowPlugin();
    const listing = await loop(() => heldSkillNames(turnRows(dir), [dir])).offered("person-1", "b1");
    expect(listing).toMatchObject({ ok: true });
    if (!listing.ok) throw new Error("not listed");
    expect(listing.domains).toEqual([expect.objectContaining({ domain: "dispatch", eligible: true, watches: [expect.objectContaining({ id: "new-tickets", runs: true })] })]);
  });
});
