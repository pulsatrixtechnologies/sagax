// #4082: a bot's turn whose commands run in the person's environment reads a
// plugin's skill text naming the plugin's paths there, whatever the engine:
// workspace_read (and the whole skills an engine without files receives,
// which read through it) and the native skill links of file engines.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";
import { USER_SANDBOX_MCP_NAME } from "../sandbox/user-sandbox-routing.ts";
import { prepareTurnSkillLinks } from "../skills/turn-skill-links.ts";
import { readWorkspaceText } from "../workspace/workspace-files.ts";
import { createTurnPluginFolders } from "./turnPluginFolders.ts";

const root = mkdtempSync(join(tmpdir(), "sagax-turn-plugin-folders-"));
afterAll(() => removeTempDir(root));

const installed = join(root, "installed", "helper");
mkdirSync(join(installed, "skills", "tidy", "scripts"), { recursive: true });
writeFileSync(join(installed, "skills", "tidy", "SKILL.md"), "---\nname: tidy\n---\nRun `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/x.py --state $CLAUDE_PLUGIN_DATA/state.json`.\n");
writeFileSync(join(installed, "skills", "tidy", "scripts", "x.py"), "print('ok')\n");

const bot = { id: "bot-1" };
function host(workplace?: { botId: string; ownEnvironmentServers?: Set<string> }) {
  const turnWorkplaces = new Map(workplace ? [["thread-1", workplace]] : []);
  return {
    DATA_DIR: join(root, "data"),
    turnWorkplaces,
    scopedPluginFolders: () => [{ name: "helper", dir: installed, scope: "organization" }],
  };
}

describe("turnPluginFolders (#4082)", () => {
  it("serves workspace_read of a plugin skill with the environment's paths on an environment turn", () => {
    const folders = createTurnPluginFolders(() => host({ botId: bot.id, ownEnvironmentServers: new Set([USER_SANDBOX_MCP_NAME]) }));
    const plugins = folders(bot, "ada", "thread-1");
    const read = readWorkspaceText(bot.id, "/workspace/sagax-plugins/helper/skills/tidy/SKILL.md", 0, plugins);
    expect(read.text).toContain("python3 /workspace/sagax-plugins/helper/scripts/x.py --state /workspace/sagax-plugin-data/helper/state.json");
    expect(read.text).not.toContain("CLAUDE_PLUGIN");
    // the rest of the plugin is served as installed
    expect(readWorkspaceText(bot.id, "plugins/helper/skills/tidy/scripts/x.py", 0, plugins).text).toBe("print('ok')\n");
    // the installed folder is never changed
    expect(readFileSync(join(installed, "skills", "tidy", "SKILL.md"), "utf8")).toContain("${CLAUDE_PLUGIN_ROOT}");
  });

  it("links a file engine's native skill to the rewritten copy on an environment turn", () => {
    const folders = createTurnPluginFolders(() => host({ botId: bot.id, ownEnvironmentServers: new Set([USER_SANDBOX_MCP_NAME]) }));
    const workspace = join(root, "task");
    mkdirSync(workspace, { recursive: true });
    prepareTurnSkillLinks({
      driverKind: "codex", workspace, stateRoot: join(root, "links"), skills: [],
      rows: [{ name: "tidy", kind: "skill", scope: "organization", enabled: true, path: "plugins/helper/skills/tidy/SKILL.md" } as never],
      plugins: folders(bot, "ada", "thread-1"),
    });
    expect(readFileSync(join(workspace, ".agents", "skills", "tidy", "SKILL.md"), "utf8")).toContain("/workspace/sagax-plugins/helper/scripts/x.py");
  });

  it("keeps the installed folder when the turn's commands do not run in the environment", () => {
    for (const workplace of [undefined, { botId: bot.id }, { botId: "other-bot", ownEnvironmentServers: new Set([USER_SANDBOX_MCP_NAME]) }]) {
      const plugins = createTurnPluginFolders(() => host(workplace))(bot, "ada", "thread-1");
      expect(plugins[0].dir).toBe(installed);
    }
  });
});
