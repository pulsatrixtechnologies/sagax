import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelSelection } from "../../shared/wire.ts";
import { LimitFailoverStore } from "../usage/limit-failover.ts";
import { createLimitFailoverHost } from "../usage/limit-failover-host.ts";
import { routineReadinessTarget } from "../routines/routine-readiness-target.ts";
import { pluginTurnInventory } from "../turns/plugin-turn.ts";
import type { DiscoveredSkill } from "./skill-discovery.ts";
import { prepareTurnSkillLinks, syncTurnSkillLinks } from "./turn-skill-links.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "turn-skills-"));
  roots.push(root);
  const workspace = join(root, "task");
  mkdirSync(workspace);
  const stateRoot = join(root, "state");
  const plugins = ["flow-pack", "tenant-pack", "personal-plugin", "bot-plugin"].map((name) => ({ name, dir: join(root, name) }));
  const scopes = ["organization", "organization", "person", "bot"] as const;
  const texts = new Map<string, string>();
  for (const [index, plugin] of plugins.entries()) {
    const name = ["using-px-flow", "tenant-review", "personal-review", "bot-review"][index]!;
    const folder = join(plugin.dir, "skills", name);
    mkdirSync(folder, { recursive: true });
    const text = `---\nname: ${name}\ndescription: Review the fixture\n---\nRead references/check.md before the pass.\n`;
    writeFileSync(join(folder, "SKILL.md"), text);
    mkdirSync(join(folder, "references"));
    writeFileSync(join(folder, "references/check.md"), name);
    texts.set(name, text);
  }
  const rows: DiscoveredSkill[] = plugins.flatMap((plugin, index) => pluginTurnInventory([plugin.dir], () => `plugins/${plugin.name}`).files.map((file) => ({
    ...file, id: `${scopes[index]}:${plugin.name}:${file.name}`, scope: scopes[index]!, source: plugin.name, enabled: true,
  })));
  return { root, workspace, stateRoot, plugins, rows, texts };
}

describe("turn skill materialization", () => {
  it.each(["codex", "grokAgent"])("prepares org Flow and plugin skills before a routine failover runs on %s (#1987)", async (driverKind) => {
    const f = fixture();
    const primary = { instanceId: "primary", model: "primary-model" };
    const backup = { instanceId: "backup", model: "backup-model" };
    const bot = { id: "bot", modelSelection: primary };
    let selection: ModelSelection = primary;
    let ran = false;
    const failover = createLimitFailoverHost({
      store: new LimitFailoverStore({ file: null, now: () => 1_000 }), now: () => 1_000, enabled: () => true,
      engineName: (id) => id,
      engine: (id) => ({ instanceId: id, driverKind: id === "primary" ? "claudeAgent" : driverKind }),
      candidates: async () => [{ instanceId: "backup", driverKind, models: [backup.model] }],
      preferred: () => [backup], config: () => undefined, payer: () => "person",
      threadSelection: () => selection, busy: () => false,
      switchThread: (_bot, _thread, to) => { selection = to; return null; },
      note: () => {}, replaceFailure: () => {}, request: () => undefined, resend: async () => false,
      rerunRoutine: () => {
        // Readiness and dispatch keep the bot on Claude but use its thread's backup.
        const target = routineReadinessTarget({ botId: bot.id, threadId: "thread" }, {
          bot: (_id, thread) => thread ? { ...bot, modelSelection: selection } : bot,
          pick: () => undefined,
        })!;
        expect(target.modelSelection).toEqual(backup);
        const instance = target.modelSelection.instanceId === "backup" ? driverKind : "claudeAgent";
        prepareTurnSkillLinks({ ...f, driverKind: instance, skills: [] });
        for (const [name, text] of f.texts) {
          const native = join(f.workspace, instance === "codex" ? ".agents/skills" : ".grok/skills", name);
          expect(readFileSync(join(native, "SKILL.md"), "utf8")).toBe(text);
          expect(readFileSync(join(native, "references/check.md"), "utf8")).toBe(name);
        }
        ran = true;
        return true;
      },
    });
    failover.noteDispatch("thread", { botId: bot.id, engine: { instanceId: "primary", driverKind: "claudeAgent" }, selection: primary, payer: "person", at: 1_000 });
    try {
      expect(failover.turnFailed({ threadId: "thread", turnId: "turn", cause: "Usage limit reached. Try again in 2 hours.", routineRun: { id: "run", routineId: "routine" } })).toBe(true);
      await failover.idle();
      expect(ran).toBe(true);
      expect(bot.modelSelection).toEqual(primary);
    } finally { failover.stop(); }
  });

  it("keeps scope precedence and removes revoked links without replacing user files", () => {
    const f = fixture();
    const file = join(f.plugins[0]!.dir, "skills/using-px-flow/SKILL.md");
    syncTurnSkillLinks(f.workspace, f.stateRoot, [{ name: "using-px-flow", file }]);
    const custom = join(f.workspace, ".agents/skills/custom");
    mkdirSync(custom);
    writeFileSync(join(custom, "SKILL.md"), "Owned by the person");
    const other = join(f.plugins[3]!.dir, "skills/bot-review/SKILL.md");
    prepareTurnSkillLinks({ ...f, driverKind: "codex", skills: [], rows: [
      { ...f.rows[3]!, name: "using-px-flow" }, f.rows[0]!,
    ] });
    expect(readFileSync(join(f.workspace, ".agents/skills/using-px-flow/SKILL.md"), "utf8")).toBe(f.texts.get("using-px-flow"));
    syncTurnSkillLinks(f.workspace, f.stateRoot, [{ name: "custom", file: other }]);
    expect(existsSync(join(f.workspace, ".agents/skills/using-px-flow"))).toBe(false);
    expect(readFileSync(join(custom, "SKILL.md"), "utf8")).toBe("Owned by the person");
  });

  it("updates owned targets and never follows a replaced native directory", () => {
    const f = fixture();
    const first = join(f.plugins[0]!.dir, "skills/using-px-flow/SKILL.md");
    const second = join(f.plugins[1]!.dir, "skills/tenant-review/SKILL.md");
    syncTurnSkillLinks(f.workspace, f.stateRoot, [{ name: "entry", file: first }]);
    syncTurnSkillLinks(f.workspace, f.stateRoot, [{ name: "entry", file: second }]);
    expect(readFileSync(join(f.workspace, ".agents/skills/entry/SKILL.md"), "utf8")).toBe(f.texts.get("tenant-review"));
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    rmSync(join(f.workspace, ".agents"), { recursive: true });
    symlinkSync(outside, join(f.workspace, ".agents"), process.platform === "win32" ? "junction" : "dir");
    syncTurnSkillLinks(f.workspace, f.stateRoot, []);
    expect(existsSync(join(outside, "skills"))).toBe(false);
  });

  it("uses Auto's actual selection for readiness and leaves API delivery in the prompt", () => {
    const f = fixture();
    const auto = { instanceId: "auto", model: "auto" };
    const backup = { instanceId: "backup", model: "backup-model" };
    const target = routineReadinessTarget({ botId: "bot" }, { bot: () => ({ modelSelection: auto }), pick: () => backup });
    expect(target?.modelSelection).toEqual(backup);
    prepareTurnSkillLinks({ ...f, driverKind: "grok", skills: [] });
    expect(existsSync(join(f.workspace, ".agents"))).toBe(false);
  });
});
