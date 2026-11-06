// Every source file over 1,000 lines is listed here with its line count, and
// a count may only go down: a PR that grows one of these files, or adds a new
// file over 1,000 lines, fails here. Lower a number when you shrink the file;
// remove the line when it drops under 1,000. The split program
// (server/host/README.md) moves server/index.ts into modules of under 1,500
// lines; nothing new may exceed HARD_CAP, and the files listed above the cap
// are the ones that program takes apart. Tests, fixtures, goldens and
// vendored code are not counted.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const HARD_CAP = 2000;
const LISTED_FROM = 1000;

const LINES: Record<string, number> = {
  "server/index.ts": 50342,
  "electron/main.mjs": 5964,
  "server/routines/routines.ts": 4951,
  "server/store.ts": 4096,
  "src/components/Sidebar.tsx": 2775,
  "src/state/store/model.ts": 2697,
  "server/config.ts": 2650,
  "server/perspicax/perspicax-mcp.ts": 2290,
  "server/routines/routine-requests.ts": 2233,
  "server/messages/message-db.ts": 2088,
  "server/encryption/content-at-rest.ts": 1973,
  "server/skills/skills.ts": 1922,
  "server/vault/credential-vault.ts": 1908,
  "shared/wire.ts": 1903,
  "server/workspace-backup.ts": 1804,
  "server/org/org-member-routes.ts": 1739,
  "src/components/ChatMarkdown.tsx": 1723,
  "server/perspicax/perspicax-link.ts": 1714,
  "server/browser/browser-runtime.ts": 1709,
  "src/lib/voice-mode/call.ts": 1698,
  "server/agent-api.ts": 1688,
  "shared/settings-actions.ts": 1668,
  "src/components/CursorAvatar.tsx": 1607,
  "server/triggers/webhooks.ts": 1599,
  "server/computer/vps-computer.ts": 1572,
  "server/auth/request-auth.ts": 1536,
  "src/components/LocalComputerSection.tsx": 1502,
  "scripts/mcp-server.ts": 1494,
  "server/computer/container-computer.ts": 1493,
  "server/computer/boat.ts": 1490,
  "shared/custom-rules.ts": 1442,
  "electron/floating-bot-window.mjs": 1395,
  "server/mcp/mcp-oauth.ts": 1363,
  "server/drivers/pi.ts": 1360,
  "server/drivers/acp/grok.ts": 1354,
  "server/routes/published-pages.ts": 1350,
  "server/cli.ts": 1347,
  "server/data/tools.ts": 1260,
  "server/runtime/runtime.ts": 1252,
  "server/usage/plan-usage.ts": 1244,
  "src/lib/composer-attachments.ts": 1221,
  "server/bots/bot-zip.ts": 1216,
  "server/voice/voice-mode.ts": 1203,
  "electron/updater-coordinator.node-test.mjs": 1181,
  "server/attachments/attachments.ts": 1180,
  "server/auth/oidc-rp.ts": 1178,
  "src/components/SettingsPrimitives.tsx": 1161,
  "shared/widget.ts": 1124,
  "server/bots/bot-plugins.ts": 1115,
  "server/routes/internal-environments-handlers.ts": 1111,
  "server/org/org-library.ts": 1099,
  "src/components/RoutineCalendarPage.tsx": 1099,
  "server/usage/limit-failover-host.ts": 1092,
  "src/components/ogre-moves.ts": 1086,
  "src/components/SidebarProfileMenu.tsx": 1084,
  "server/auth/idp-session.ts": 1075,
  "src/components/bot-profile/BotProfilePage.tsx": 1068,
  "server/auth/sessions.ts": 1043,
  "server/drivers/claude.ts": 1031,
  "server/drivers/pi-mcp-extension.ts": 1029,
  "server/workspace/workspace.ts": 1017,
  "src/components/floating-bots/MascotLookEditor.tsx": 1004,
  "shared/package-format.ts": 1002,
};

function sourceFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "server", "shared", "src", "scripts", "evals", "electron", "companion"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").filter((file) => /\.(ts|tsx|mjs|cjs)$/.test(file))
    .filter((file) => !file.includes(".test.") && !file.includes("/testing/") && !file.includes("goldens") && !file.startsWith("electron/vendor/"));
}

const count = (file: string) => readFileSync(new URL(file, ROOT), "utf8").split("\n").length - 1;

describe("source files stay a readable size", () => {
  it("no listed file grows, and no file over 1,000 lines goes unlisted", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const file of sourceFiles()) {
      const lines = count(file);
      const pinned = LINES[file];
      if (pinned !== undefined) {
        seen.add(file);
        if (lines > pinned) problems.push(`${file} grew to ${lines} lines (listed at ${pinned}): move code out, do not add here`);
        if (lines < LISTED_FROM) problems.push(`${file} is ${lines} lines: remove its line from LINES`);
        else if (lines < pinned) problems.push(`${file} is ${lines} lines: lower its number to ${lines}`);
      } else if (lines > LISTED_FROM) {
        problems.push(lines > HARD_CAP
          ? `${file} is ${lines} lines, over the ${HARD_CAP}-line cap: split it`
          : `${file} is ${lines} lines: a new file over ${LISTED_FROM} lines needs a line here and a reason in the PR`);
      }
    }
    for (const file of Object.keys(LINES)) if (!seen.has(file)) problems.push(`${file} is gone: remove its line from LINES`);
    expect(problems, "See server/host/README.md").toEqual([]);
  });
});
